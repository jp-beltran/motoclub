#!/usr/bin/env bash
# scripts/restore.sh — restauração guiada de um backup do banco do bar.
#
# Filosofia: nada é destruído sem antes ser verificado. O banco atual é
# movido para o lado (nunca apagado), os arquivos -wal/-shm são removidos
# explicitamente (deixar um WAL velho ao lado de um banco restaurado é o
# jeito clássico de a restauração parecer que funcionou e não funcionar),
# e o serviço só volta a subir depois que o arquivo novo já está no lugar.
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

# --- localizar Node e as bibliotecas -------------------------------------

find_node() {
  if [ -x /opt/node/bin/node ]; then
    echo "/opt/node/bin/node"
  elif command -v node >/dev/null 2>&1; then
    command -v node
  else
    echo "ERRO: node não encontrado (nem /opt/node/bin/node, nem no PATH)." >&2
    exit 2
  fi
}
NODE_BIN="$(find_node)"

check_integrity() {
  "$NODE_BIN" --no-warnings "$SCRIPT_DIR/lib/sqlite-check.mjs" "$1"
}

# --- config: variáveis de ambiente e valores padrão -----------------------

ENV_FILE="${MOTOCLUB_ENV_FILE:-$HOME/.config/motoclub/env}"

# Lê uma variável do arquivo de env SEM interpretá-lo como shell script
# (nunca `source` aqui): o arquivo é um EnvironmentFile de systemd
# (KEY=value literal), e valores como BAR_PIN_HASH contêm "$" de verdade
# (formato scrypt$salt$hash) que um `source` trataria como expansão de
# variável, corrompendo o valor em silêncio.
read_env_file_var() {
  local file="$1" var="$2"
  local value=""
  if [ -f "$file" ]; then
    # "|| true": não achar a variável no arquivo é normal (ela pode não
    # estar lá), não um erro — e este script roda com `set -e`, então um
    # grep sem match aqui derrubaria o script inteiro se deixado propagar.
    value="$(grep -E "^${var}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2-)" || true
  fi
  printf '%s' "$value"
}

# Precedência: valor no arquivo de env > variável já no ambiente > padrão.
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

say "== Restauração do banco do Motoclub =="
say "Banco atual: $DB_PATH"
say "Diretório de backups: $BACKUP_DIR"
[ -n "$USB_PATH" ] && say "Pendrive configurado: $USB_PATH"
say ""

# --- 1. listar backups disponíveis ----------------------------------------

declare -a CANDIDATE_PATHS
declare -a CANDIDATE_LABELS

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

# --- 2. escolha do usuário --------------------------------------------------

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

# --- 3. verificar ANTES de tocar em qualquer coisa --------------------------

info "Verificando integridade do backup escolhido (PRAGMA integrity_check)..."
INTEGRITY_OUTPUT="$(check_integrity "$CHOSEN_PATH")" && INTEGRITY_OK=1 || INTEGRITY_OK=0
if [ "$INTEGRITY_OK" -ne 1 ] || [ "$INTEGRITY_OUTPUT" != "ok" ]; then
  fail "backup reprovado na verificação de integridade: $INTEGRITY_OUTPUT"
  echo "Nada foi alterado. Escolha outro backup." >&2
  exit 3
fi
ok "integrity_check = ok — este backup é seguro para restaurar"
say ""

# --- 4. confirmação -----------------------------------------------------------

if [ "$DRY_RUN" -eq 0 ] && [ -z "${MOTOCLUB_RESTORE_CHOICE:-}" ]; then
  if ! read -r -p "Isso vai PARAR o serviço e SUBSTITUIR o banco atual. Confirma? [s/N] " CONFIRM; then
    echo
    fail "não consegui ler sua resposta — isto precisa de um terminal interativo. Nada foi alterado."
    exit 2
  fi
  case "$CONFIRM" in
    s|S|sim|Sim|SIM) ;;
    *)
      say "Cancelado. Nada foi alterado."
      exit 0
      ;;
  esac
fi

# --- 5. parar o serviço --------------------------------------------------------

info "Parando $SERVICE_NAME..."
run_or_echo systemctl --user stop "$SERVICE_NAME"

# --- 6. mover o banco atual para o lado (nunca apagar) -------------------------

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
MOVED_ASIDE=""
if [ -f "$DB_PATH" ]; then
  MOVED_ASIDE="${DB_PATH}.antes-da-restauracao-${TIMESTAMP}"
  info "Movendo banco atual para $MOVED_ASIDE (não é apagado, por segurança)..."
  run_or_echo mv "$DB_PATH" "$MOVED_ASIDE"
else
  info "Não havia banco atual em $DB_PATH (primeira restauração?)"
fi

# --- 7. remover sidecars -wal/-shm, senão a restauração "funciona" e não funciona --

for suffix in -wal -shm; do
  sidecar="${DB_PATH}${suffix}"
  if [ -f "$sidecar" ]; then
    info "Removendo sidecar antigo $sidecar..."
    run_or_echo rm -f "$sidecar"
  fi
done

# --- 8. copiar o backup para o lugar --------------------------------------------

info "Copiando backup para $DB_PATH..."
run_or_echo mkdir -p "$(dirname "$DB_PATH")"
run_or_echo cp "$CHOSEN_PATH" "$DB_PATH"

# --- 9. subir o serviço de novo ------------------------------------------------

info "Subindo $SERVICE_NAME..."
run_or_echo systemctl --user start "$SERVICE_NAME"

# --- 10. confirmar que responde -------------------------------------------------

if [ "$DRY_RUN" -eq 1 ]; then
  say "[dry-run] verificaria se http://$HOST:$PORT/ responde antes de declarar sucesso"
  say ""
  say "[dry-run] nenhuma alteração real foi feita."
  exit 0
fi

info "Conferindo se o serviço responde em http://$HOST:$PORT/ ..."
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

say ""
if [ "$ANSWERED" -eq 1 ]; then
  ok "restauração concluída e o serviço respondeu"
else
  fail "o serviço não respondeu em http://$HOST:$PORT/ — rode scripts/doctor.sh para diagnosticar"
fi
if [ -n "$MOVED_ASIDE" ]; then
  say "O banco anterior foi preservado em: $MOVED_ASIDE"
fi
say "Confira na tela do app se as comandas esperadas estão lá."

[ "$ANSWERED" -eq 1 ]
