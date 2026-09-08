#!/usr/bin/env bash
# scripts/restore.sh — restauração guiada de um backup do banco do bar.
#
# Filosofia: nada é destruído sem antes ser verificado. O banco atual (e os
# sidecars -wal/-shm que estiverem com ele) é movido para o lado — nunca
# apagado —, e o serviço só volta a subir depois que o arquivo novo já
# está no lugar.
#
# Estrutura pensada para ser testável: a lógica está em funções, e o
# "main" só roda quando o arquivo é EXECUTADO, não quando é `source`ado
# (ver o guard no fim do arquivo) — scripts/test/restore.test.sh usa isso
# para testar swap_database_files() sozinha, sem precisar de systemd de
# verdade nem de interação.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN=0

usage() {
  cat <<'EOF'
Uso: restore.sh [--dry-run]

Restaura o banco do bar a partir de um backup em ~/Backups/motoclub
(ou do pendrive, se configurado). Interativo: lista os backups disponíveis,
pede para escolher um, verifica a integridade ANTES de mexer em qualquer
coisa, e só então para o serviço, troca o banco e sobe de novo.

  --dry-run   mostra o que seria feito, sem executar nada
EOF
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      -h|--help) usage; exit 0 ;;
      *)
        echo "argumento desconhecido: $arg" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
}

# --- localizar Node e as bibliotecas -------------------------------------

# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/lib/version.sh"
# shellcheck source=lib/env-file.sh
source "$SCRIPT_DIR/lib/env-file.sh"

# node:sqlite só existe a partir do Node 22.5 — um node do PATH mais
# antigo que isso não deve ser usado para checar integridade: na melhor
# hipótese ele nem tem o módulo (erro feio, não uma mensagem clara); na
# pior, dá um resultado que parece "corrompido" sem ser — o ambiente é
# que está errado, não o backup.
NODE_MIN_VERSION="22.5.0"

find_node() {
  local candidate=""
  if [ -x /opt/node/bin/node ]; then
    candidate="/opt/node/bin/node"
  elif command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
  fi

  if [ -z "$candidate" ]; then
    echo "ERRO: node não encontrado (nem /opt/node/bin/node, nem no PATH)." >&2
    exit 2
  fi

  local candidate_version
  candidate_version="$("$candidate" --version 2>/dev/null || true)"
  if ! node_version_ge "$candidate_version" "$NODE_MIN_VERSION"; then
    echo "ERRO: $candidate ($candidate_version) é mais antigo que o mínimo para node:sqlite (>= $NODE_MIN_VERSION)." >&2
    echo "Rode $SCRIPT_DIR/install.sh para instalar um Node atual." >&2
    exit 2
  fi
  echo "$candidate"
}

check_integrity() {
  "$NODE_BIN" --no-warnings "$SCRIPT_DIR/lib/sqlite-check.mjs" "$1"
}

# --- config: variáveis de ambiente e valores padrão -----------------------

# Lê uma variável do arquivo de env SEM interpretá-lo como shell script
# (nunca `source` aqui): o arquivo é um EnvironmentFile de systemd
# (KEY=value literal), e valores como BAR_PIN_HASH contêm "$" de verdade
# (formato scrypt$salt$hash) que um `source` trataria como expansão de
# variável, corrompendo o valor em silêncio.
read_env_file_var() {
  # Delega para lib/env-file.sh: havia três cópias quase iguais desta
  # leitura (aqui, no doctor.sh e no install.sh), e foi nessa duplicação
  # que nasceram os bugs de parsing. A implementação compartilhada também
  # tira as aspas envolventes, necessárias para o arquivo de segredos ser
  # lido igual pelo systemd e por quem der `source` nele.
  env_file_var "$1" "$2"
}

resolve_config() {
  ENV_FILE="${MOTOCLUB_ENV_FILE:-$HOME/.config/motoclub/env}"

  # Precedência: valor no arquivo de env > variável já no ambiente > padrão.
  local _env_db_path _env_backup_dir _env_usb_path _env_port _env_host
  _env_db_path="$(read_env_file_var "$ENV_FILE" BAR_DB_PATH)"
  DB_PATH="${_env_db_path:-${BAR_DB_PATH:-$HOME/.local/share/motoclub/bar.sqlite3}}"
  _env_backup_dir="$(read_env_file_var "$ENV_FILE" BAR_BACKUP_DIR)"
  BACKUP_DIR="${_env_backup_dir:-${BAR_BACKUP_DIR:-$HOME/Backups/motoclub}}"
  _env_usb_path="$(read_env_file_var "$ENV_FILE" BAR_BACKUP_USB_PATH)"
  USB_PATH="${_env_usb_path:-${BAR_BACKUP_USB_PATH:-}}"
  SERVICE_NAME="${MOTOCLUB_SERVICE_NAME:-motoclub.service}"
  _env_port="$(read_env_file_var "$ENV_FILE" BAR_PORT)"
  PORT="${_env_port:-${BAR_PORT:-8787}}"
  _env_host="$(read_env_file_var "$ENV_FILE" BAR_HOST)"
  HOST="${_env_host:-${BAR_HOST:-127.0.0.1}}"
}

say() { echo "$@"; }
info() { echo "-> $*"; }
ok() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; }

human_size() {
  local bytes="$1"
  if [ "$bytes" -lt 1024 ]; then
    echo "${bytes} B"
  elif [ "$bytes" -lt $((1024 * 1024)) ]; then
    awk -v b="$bytes" 'BEGIN { printf "%.1f KB", b/1024 }'
  else
    awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b/1024/1024 }'
  fi
}

run_or_echo() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] executaria: $*"
  else
    "$@"
  fi
}

# --- 1. listar backups disponíveis ----------------------------------------

collect_backups() {
  local dir="$1" label_prefix="$2"
  [ -d "$dir" ] || return 0
  local f
  while IFS= read -r -d '' f; do
    local base size date_str
    base="$(basename "$f")"
    size="$(stat -c%s "$f" 2>/dev/null || echo 0)"
    date_str="$(date -r "$f" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "data desconhecida")"
    CANDIDATE_PATHS+=("$f")
    CANDIDATE_LABELS+=("$label_prefix$base — $date_str — $(human_size "$size")")
  done < <(find "$dir" -maxdepth 1 -type f -name 'bar-*.sqlite3' -print0 | sort -z -r)
}

list_available_backups() {
  CANDIDATE_PATHS=()
  CANDIDATE_LABELS=()
  collect_backups "$BACKUP_DIR" ""
  if [ -n "$USB_PATH" ] && [ -d "$USB_PATH" ]; then
    collect_backups "$USB_PATH" "[pendrive] "
  fi

  if [ "${#CANDIDATE_PATHS[@]}" -eq 0 ]; then
    fail "nenhum backup encontrado em $BACKUP_DIR${USB_PATH:+ nem em $USB_PATH}"
    echo "Rode 'systemctl --user start motoclub-backup.service' para gerar um agora, se possível." >&2
    exit 1
  fi

  say "Backups disponíveis:"
  for i in "${!CANDIDATE_LABELS[@]}"; do
    printf '  [%d] %s\n' "$((i + 1))" "${CANDIDATE_LABELS[$i]}"
  done
  say ""
}

# --- 2. escolha do usuário --------------------------------------------------

choose_backup() {
  CHOSEN_INDEX=""
  if [ -n "${MOTOCLUB_RESTORE_CHOICE:-}" ]; then
    # atalho para testes automatizados / uso não interativo
    CHOSEN_INDEX="$MOTOCLUB_RESTORE_CHOICE"
  else
    # Sem "|| ..." aqui, um EOF em stdin (sem terminal interativo) faria o
    # `read` retornar erro e, com `set -e`, matar o script em silêncio —
    # sem nenhuma mensagem. Melhor falhar alto e claro.
    if ! read -r -p "Qual backup restaurar? [1-${#CANDIDATE_PATHS[@]}, ou 'q' para cancelar] " CHOSEN_INDEX; then
      echo
      fail "não consegui ler sua resposta — isto precisa de um terminal interativo (ou defina MOTOCLUB_RESTORE_CHOICE para uso não interativo)."
      exit 2
    fi
  fi

  if [ "$CHOSEN_INDEX" = "q" ] || [ -z "$CHOSEN_INDEX" ]; then
    say "Cancelado. Nada foi alterado."
    exit 0
  fi

  if ! [[ "$CHOSEN_INDEX" =~ ^[0-9]+$ ]] || [ "$CHOSEN_INDEX" -lt 1 ] || [ "$CHOSEN_INDEX" -gt "${#CANDIDATE_PATHS[@]}" ]; then
    fail "escolha inválida: $CHOSEN_INDEX"
    exit 2
  fi

  CHOSEN_PATH="${CANDIDATE_PATHS[$((CHOSEN_INDEX - 1))]}"
  say "Escolhido: ${CANDIDATE_LABELS[$((CHOSEN_INDEX - 1))]}"
  say ""
}

# --- 3. verificar ANTES de tocar em qualquer coisa --------------------------

verify_chosen_backup() {
  info "Verificando integridade do backup escolhido (PRAGMA integrity_check)..."
  local integrity_output integrity_ok
  integrity_output="$(check_integrity "$CHOSEN_PATH")" && integrity_ok=1 || integrity_ok=0
  if [ "$integrity_ok" -ne 1 ] || [ "$integrity_output" != "ok" ]; then
    fail "backup reprovado na verificação de integridade: $integrity_output"
    echo "Nada foi alterado. Escolha outro backup." >&2
    exit 3
  fi
  # "integrity_check = ok" prova que o ARQUIVO não está corrompido — não
  # prova que os dados são os que você espera encontrar (isso só se
  # confere olhando a tela do app depois).
  ok "integrity_check = ok — o arquivo do backup não está corrompido"
  say ""
}

# --- 4. confirmação -----------------------------------------------------------

confirm_restore() {
  if [ "$DRY_RUN" -eq 0 ] && [ -z "${MOTOCLUB_RESTORE_CHOICE:-}" ]; then
    local confirm
    if ! read -r -p "Isso vai PARAR o serviço e SUBSTITUIR o banco atual. Confirma? [s/N] " confirm; then
      echo
      fail "não consegui ler sua resposta — isto precisa de um terminal interativo. Nada foi alterado."
      exit 2
    fi
    case "$confirm" in
      s|S|sim|Sim|SIM) ;;
      *)
        say "Cancelado. Nada foi alterado."
        exit 0
        ;;
    esac
  fi
}

# --- 5. parar o serviço --------------------------------------------------------

stop_service() {
  info "Parando $SERVICE_NAME..."
  run_or_echo systemctl --user stop "$SERVICE_NAME"
}

# --- 6+7+8. trocar os arquivos: mover o atual (com sidecars) para o lado, ------
#            copiar o backup escolhido para o lugar --------------------------

# Move o banco atual — e os sidecars -wal/-shm que existirem com ele —
# para o lado, juntos, preservando tudo. Depois copia o backup escolhido
# para o lugar do banco.
#
# Por que os sidecars vão JUNTO, nunca só apagados: depois de uma parada
# suja (queda de energia, kill por timeout, serviço em crash-loop), o
# -wal pode guardar todo commit desde o último checkpoint — e com
# synchronous=FULL num banco pequeno, o auto-checkpoint pode nunca ter
# disparado. Um `rm -f` nesse -wal destrói justamente os dados mais
# recentes, exatamente o que esta restauração existe para proteger. Só
# quando NÃO havia banco atual (MOVED_ASIDE vazio) é que um sidecar
# encontrado é órfão — sem arquivo principal para mover junto — e aí sim
# `rm -f` é seguro, porque não há nada para preservar com ele.
swap_database_files() {
  local chosen_path="$1"
  local timestamp
  timestamp="$(date '+%Y%m%d-%H%M%S')"
  MOVED_ASIDE=""

  if [ -f "$DB_PATH" ]; then
    MOVED_ASIDE="${DB_PATH}.antes-da-restauracao-${timestamp}"
    info "Movendo banco atual (e os sidecars -wal/-shm, se houver) para ${MOVED_ASIDE}*..."
    run_or_echo mv "$DB_PATH" "$MOVED_ASIDE"
    for suffix in -wal -shm; do
      local sidecar="${DB_PATH}${suffix}"
      if [ -f "$sidecar" ]; then
        info "Movendo $sidecar junto (pode conter commits recentes que ainda não foram para o arquivo principal)..."
        run_or_echo mv "$sidecar" "${MOVED_ASIDE}${suffix}"
      fi
    done
    # Avisar AGORA, não só no resumo final: se algo falhar mais adiante
    # (copiar o backup, subir o serviço) e o script parar por causa de
    # `set -e`, quem está restaurando — na pior hora possível para ficar
    # sem essa informação — ainda vê onde o banco anterior foi parar.
    say "O banco anterior (com os sidecars, se havia) foi preservado em: ${MOVED_ASIDE}*"
  else
    info "Não havia banco atual em $DB_PATH (primeira restauração?)"
    for suffix in -wal -shm; do
      local sidecar="${DB_PATH}${suffix}"
      if [ -f "$sidecar" ]; then
        info "Removendo sidecar órfão $sidecar (sem banco correspondente para mover junto)..."
        run_or_echo rm -f "$sidecar"
      fi
    done
  fi

  info "Copiando backup para $DB_PATH..."
  run_or_echo mkdir -p "$(dirname "$DB_PATH")"
  run_or_echo cp "$chosen_path" "$DB_PATH"
}

# --- 9. subir o serviço de novo ------------------------------------------------

start_service() {
  info "Subindo $SERVICE_NAME..."
  run_or_echo systemctl --user start "$SERVICE_NAME"
}

# --- 10. confirmar que responde -------------------------------------------------

verify_service_answers() {
  ANSWERED=0
  if command -v curl >/dev/null 2>&1; then
    for _ in 1 2 3 4 5; do
      if curl -fsS --max-time 2 "http://$HOST:$PORT/" >/dev/null 2>&1; then
        ANSWERED=1
        break
      fi
      sleep 1
    done
  else
    fail "curl não disponível — não deu para confirmar automaticamente; confira manualmente no navegador."
  fi
}

main() {
  parse_args "$@"
  NODE_BIN="$(find_node)"
  resolve_config

  say "== Restauração do banco do Motoclub =="
  say "Banco atual: $DB_PATH"
  say "Diretório de backups: $BACKUP_DIR"
  [ -n "$USB_PATH" ] && say "Pendrive configurado: $USB_PATH"
  say ""

  declare -a CANDIDATE_PATHS
  declare -a CANDIDATE_LABELS
  list_available_backups
  choose_backup
  verify_chosen_backup
  confirm_restore
  stop_service
  swap_database_files "$CHOSEN_PATH"
  start_service

  if [ "$DRY_RUN" -eq 1 ]; then
    say "[dry-run] verificaria se http://$HOST:$PORT/ responde antes de declarar sucesso"
    say ""
    say "[dry-run] nenhuma alteração real foi feita."
    exit 0
  fi

  info "Conferindo se o serviço responde em http://$HOST:$PORT/ ..."
  verify_service_answers

  say ""
  if [ "$ANSWERED" -eq 1 ]; then
    ok "restauração concluída e o serviço respondeu"
  else
    fail "o serviço não respondeu em http://$HOST:$PORT/ — rode $SCRIPT_DIR/doctor.sh para diagnosticar"
  fi
  if [ -n "$MOVED_ASIDE" ]; then
    say "O banco anterior foi preservado em: $MOVED_ASIDE (e seus sidecars, se havia)"
  fi
  say "Confira na tela do app se as comandas esperadas estão lá."

  # Exit 3 (não 1): o contrato compartilhado reserva 3 para "verificação
  # falhou" — o serviço não responder depois da troca é exatamente isso,
  # não um erro genérico.
  if [ "$ANSWERED" -eq 1 ]; then
    exit 0
  else
    exit 3
  fi
}

# Só roda main quando o arquivo é EXECUTADO, não quando é `source`ado —
# isso é o que deixa scripts/test/restore.test.sh testar
# swap_database_files() sozinha (sem systemd, sem interação) apontando
# DB_PATH para um diretório de teste.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
