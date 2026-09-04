#!/usr/bin/env bash
# scripts/doctor.sh — diagnóstico completo e SÓ LEITURA do Motoclub.
#
# Não muda nada no sistema. É o que você roda quando "algo parece
# errado": cada linha que reprova diz também o que fazer a respeito, em
# português.
#
# Saída: 0 se está tudo certo, 3 se algo precisa de atenção (compatível
# com o contrato compartilhado do backend, que reserva 3 para "verificação
# falhou").
#
# Uso:
#   scripts/doctor.sh              roda todas as checagens
#   scripts/doctor.sh --dry-run    só lista as checagens e o comando que
#                                  cada uma rodaria, sem executar nada
#                                  (existe para poder revisar/testar o
#                                  script num ambiente sem systemd de verdade)
#
# As mesmas variáveis de ambiente de teste do install.sh são aceitas aqui
# (MOTOCLUB_HOME_DIR, MOTOCLUB_ENV_FILE, BAR_DB_PATH, BAR_BACKUP_DIR,
# MOTOCLUB_SYSTEMD_USER_DIR, MOTOCLUB_NODE_INSTALL_ROOT,
# MOTOCLUB_LOGIND_DROPIN_DIR), para poder apontar o diagnóstico para um
# ambiente de teste em vez da máquina real.
set -uo pipefail
# (sem -e aqui de propósito: cada checagem precisa poder falhar sem
# derrubar as checagens seguintes — o diagnóstico quer ver tudo de uma vez)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<'EOF'
Uso: doctor.sh [--dry-run]

Diagnóstico só-leitura do Motoclub: Node, segredos, banco, serviço,
timer de backup, fuso horário, energia, backups e pendrive. Nunca muda
nada no sistema.

  --dry-run   lista as checagens e o comando de cada uma, sem rodar nada
EOF
      exit 0
      ;;
    *)
      echo "argumento desconhecido: $arg" >&2
      exit 2
      ;;
  esac
done

HOME_DIR="${MOTOCLUB_HOME_DIR:-$HOME/motoclub}"
CONFIG_DIR="${MOTOCLUB_CONFIG_DIR:-$HOME/.config/motoclub}"
ENV_FILE="${MOTOCLUB_ENV_FILE:-$CONFIG_DIR/env}"
SYSTEMD_USER_DIR="${MOTOCLUB_SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"
NODE_INSTALL_ROOT="${MOTOCLUB_NODE_INSTALL_ROOT:-/opt}"
NODE_LINK="$NODE_INSTALL_ROOT/node"
LOGIND_DROPIN_DIR="${MOTOCLUB_LOGIND_DROPIN_DIR:-/etc/systemd/logind.conf.d}"

SERVICE_UNIT="motoclub.service"
BACKUP_SERVICE_UNIT="motoclub-backup.service"
BACKUP_TIMER_UNIT="motoclub-backup.timer"
NODE_MAJOR_REQUIRED=22

# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/lib/version.sh"

find_node() {
  if [ -x "$NODE_LINK/bin/node" ]; then
    echo "$NODE_LINK/bin/node"
  elif command -v node >/dev/null 2>&1; then
    command -v node
  fi
}
NODE_BIN="$(find_node)"

# Lê uma variável de dentro do arquivo de env SEM interpretá-lo como shell
# script (nunca `source`): valores como BAR_PIN_HASH contêm "$" de verdade
# (formato scrypt$salt$hash), e um `source` os trataria como expansão de
# variável, corrompendo o valor em silêncio. O arquivo é um EnvironmentFile
# de systemd (KEY=value literal), não um script — lemos assim: extração de
# texto puro, sem nenhuma interpretação.
read_env_var() {
  local var="$1"
  local value=""
  if [ -f "$ENV_FILE" ]; then
    # "|| true": não achar a variável é normal, não um erro.
    value="$(grep -E "^${var}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)" || true
  fi
  printf '%s' "$value"
}

DB_PATH="$(read_env_var BAR_DB_PATH)"
DB_PATH="${DB_PATH:-${BAR_DB_PATH:-$HOME/.local/share/motoclub/bar.sqlite3}}"
BACKUP_DIR="$(read_env_var BAR_BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-${BAR_BACKUP_DIR:-$HOME/Backups/motoclub}}"
BAR_PORT_EFFECTIVE="$(read_env_var BAR_PORT)"
BAR_PORT_EFFECTIVE="${BAR_PORT_EFFECTIVE:-8787}"
BAR_HOST_EFFECTIVE="$(read_env_var BAR_HOST)"
BAR_HOST_EFFECTIVE="${BAR_HOST_EFFECTIVE:-127.0.0.1}"
USB_PATH="$(read_env_var BAR_BACKUP_USB_PATH)"

# --- saída -------------------------------------------------------------------

FAILS=0
WARNS=0

section() { echo; echo "== $* =="; }
pass() { echo "  OK       $*"; }
problem() {
  echo "  FALHOU   $1" >&2
  if [ -n "${2:-}" ]; then
    echo "           o que fazer: $2" >&2
  fi
  FAILS=$((FAILS + 1))
}
soft_warn() {
  echo "  ATENCAO  $1"
  if [ -n "${2:-}" ]; then
    echo "           $2"
  fi
  WARNS=$((WARNS + 1))
}
skip() {
  echo "  ?        $1"
}

plan() { echo "  [dry-run] checagem: $1"; echo "            rodaria: $2"; }

# --- 1. Node ------------------------------------------------------------------

check_node() {
  section "Node"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "Node presente e na versão exigida" "$NODE_LINK/bin/node --version"
    return 0
  fi

  if [ ! -x "$NODE_LINK/bin/node" ]; then
    problem "Node não encontrado em $NODE_LINK/bin/node" \
      "rode 'scripts/install.sh' para instalar o Node."
    return 0
  fi

  local version
  version="$("$NODE_LINK/bin/node" --version 2>/dev/null || true)"
  if node_version_ok "$version" "$NODE_MAJOR_REQUIRED"; then
    pass "Node $version em $NODE_LINK/bin/node (>= $NODE_MAJOR_REQUIRED)"
  else
    problem "Node em $NODE_LINK é $version, mais antigo que o exigido (>= $NODE_MAJOR_REQUIRED)" \
      "rode 'scripts/install.sh' de novo para atualizar o Node."
  fi
}

# --- 2. Arquivo de segredos -----------------------------------------------------

check_env_file() {
  section "Arquivo de segredos ($ENV_FILE)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "arquivo existe, permissão 600, tem BAR_PIN_HASH e BAR_SESSION_SECRET" "stat + grep em $ENV_FILE"
    return 0
  fi

  if [ ! -f "$ENV_FILE" ]; then
    problem "arquivo de segredos não existe em $ENV_FILE" \
      "rode 'scripts/install.sh' para criá-lo (ele vai pedir o PIN do bar)."
    return 0
  fi
  pass "arquivo existe"

  local perms
  perms="$(stat -c%a "$ENV_FILE" 2>/dev/null || echo '?')"
  if [ "$perms" = "600" ]; then
    pass "permissão 600 (só o dono lê)"
  else
    problem "permissão de $ENV_FILE é $perms, deveria ser 600" \
      "rode: chmod 600 '$ENV_FILE'"
  fi

  local pin_hash session_secret
  pin_hash="$(read_env_var BAR_PIN_HASH)"
  session_secret="$(read_env_var BAR_SESSION_SECRET)"

  if [ -n "$pin_hash" ]; then
    if [[ "$pin_hash" =~ ^scrypt\$[0-9a-fA-F]+\$[0-9a-fA-F]+$ ]]; then
      pass "BAR_PIN_HASH presente e no formato esperado (scrypt\$salt\$hash)"
    else
      problem "BAR_PIN_HASH presente mas não está no formato scrypt\$salt\$hash" \
        "apague '$ENV_FILE' e rode 'scripts/install.sh' de novo para recriar os segredos."
    fi
  else
    problem "BAR_PIN_HASH ausente em $ENV_FILE" \
      "apague '$ENV_FILE' e rode 'scripts/install.sh' de novo para recriar os segredos."
  fi

  if [ -n "$session_secret" ]; then
    pass "BAR_SESSION_SECRET presente"
  else
    problem "BAR_SESSION_SECRET ausente em $ENV_FILE" \
      "apague '$ENV_FILE' e rode 'scripts/install.sh' de novo para recriar os segredos."
  fi
}

# --- 3. Banco de dados ----------------------------------------------------------

check_database() {
  section "Banco de dados ($DB_PATH)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "arquivo existe e PRAGMA integrity_check = ok" "node scripts/lib/sqlite-check.mjs $DB_PATH"
    return 0
  fi

  if [ ! -f "$DB_PATH" ]; then
    problem "banco não encontrado em $DB_PATH" \
      "se o serviço nunca rodou ainda, inicie-o com 'systemctl --user start $SERVICE_UNIT'; se já rodou e o arquivo sumiu, restaure com 'scripts/restore.sh'."
    return 0
  fi
  pass "arquivo existe"

  if [ -z "$NODE_BIN" ]; then
    skip "não dá para checar a integridade sem Node — resolva a checagem de Node acima primeiro"
    return 0
  fi

  local result
  result="$("$NODE_BIN" --no-warnings "$SCRIPT_DIR/lib/sqlite-check.mjs" "$DB_PATH" 2>/dev/null)"
  if [ "$result" = "ok" ]; then
    pass "PRAGMA integrity_check = ok"
  else
    problem "PRAGMA integrity_check falhou: $result" \
      "pare o serviço e restaure o backup mais recente com 'scripts/restore.sh' — não continue usando um banco corrompido."
  fi
}

# --- 4. Serviço ------------------------------------------------------------------

# O servidor (escrito à parte, no contrato compartilhado) falha o boot com
# código de saída classificado e mensagem acionável no journal:
#   1 = erro genérico (inclui recusar escutar fora de 127.0.0.1)
#   2 = pré-requisito OU configuração ausente/incompleta — na prática o caso
#       mais comum é BAR_PIN_HASH/BAR_SESSION_SECRET faltando no arquivo de
#       segredos, NÃO "Node desatualizado" (esse é só um dos pré-requisitos
#       possíveis; a checagem "Arquivo de segredos" acima já cobre o outro)
#   3 = ambiente errado depois de já configurado: fuso horário,
#       PRAGMA foreign_keys, ou integrity_check do banco
# O código classifica o tipo de problema; a mensagem do journal é o que de
# fato explica — por isso este diagnóstico nunca adivinha só pelo número,
# sempre mostra as últimas linhas do journal junto.
diagnose_service_failure() {
  local active="$1"
  local exit_code
  exit_code="$(systemctl --user show "$SERVICE_UNIT" --property=ExecMainStatus --value 2>/dev/null || true)"

  local hint
  case "$exit_code" in
    1)
      hint="código de saída 1 (erro genérico — inclui o servidor recusar escutar fora de 127.0.0.1, se BAR_HOST em '$ENV_FILE' estiver errado)."
      ;;
    2)
      hint="código de saída 2 (pré-requisito ou configuração ausente/incompleta). O mais comum: BAR_PIN_HASH ou BAR_SESSION_SECRET faltando em '$ENV_FILE' — veja a seção 'Arquivo de segredos' acima. Se estiver tudo lá, confira também a versão do Node."
      ;;
    3)
      hint="código de saída 3 (ambiente errado depois de configurado: fuso horário, foreign_keys ou integrity_check do banco) — veja as seções 'Fuso horário' e 'Banco de dados' acima."
      ;;
    *)
      hint="código de saída '${exit_code:-desconhecido}' (não classificado)."
      ;;
  esac
  hint="$hint A mensagem exata está no journal (abaixo) ou em 'journalctl --user -u $SERVICE_UNIT -n 20'."

  problem "$SERVICE_UNIT não está ativo (estado: ${active:-desconhecido})" "$hint"

  if command -v journalctl >/dev/null 2>&1; then
    local tail
    tail="$(journalctl --user -u "$SERVICE_UNIT" -n 20 --no-pager 2>/dev/null || true)"
    if [ -n "$tail" ]; then
      echo "           últimas linhas do journal:" >&2
      echo "$tail" | sed 's/^/             /' >&2
    fi
  fi
}

check_service() {
  section "Serviço ($SERVICE_UNIT)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "habilitado, ativo e respondendo em http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/" \
      "systemctl --user is-enabled/is-active/show $SERVICE_UNIT + journalctl --user -u $SERVICE_UNIT -n 20 + curl"
    return 0
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    skip "systemctl não encontrado — não dá para checar o serviço automaticamente neste ambiente"
    return 0
  fi

  local enabled active
  enabled="$(systemctl --user is-enabled "$SERVICE_UNIT" 2>/dev/null || true)"
  active="$(systemctl --user is-active "$SERVICE_UNIT" 2>/dev/null || true)"

  if [ "$enabled" = "enabled" ]; then
    pass "habilitado (sobe sozinho)"
  else
    problem "$SERVICE_UNIT não está habilitado (estado: ${enabled:-desconhecido})" \
      "rode: systemctl --user enable --now $SERVICE_UNIT"
  fi

  if [ "$active" = "active" ]; then
    pass "ativo"
  else
    diagnose_service_failure "$active"
    return 0
  fi

  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 3 -o /dev/null "http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/"; then
      pass "respondendo em http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/"
    else
      problem "não respondeu em http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/" \
        "confira 'journalctl --user -u $SERVICE_UNIT' e se BAR_PORT/BAR_HOST em $ENV_FILE batem com o esperado."
    fi
  else
    skip "curl não encontrado — não dá para confirmar se o serviço responde"
  fi
}

# --- 5. Linger -------------------------------------------------------------------

check_linger() {
  section "Linger (subir sem login gráfico)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "linger habilitado para o usuário atual" "loginctl show-user \$USER --property=Linger"
    return 0
  fi

  if ! command -v loginctl >/dev/null 2>&1; then
    skip "loginctl não encontrado — não dá para checar o linger automaticamente"
    return 0
  fi

  local linger
  linger="$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || true)"
  if [ "$linger" = "yes" ]; then
    pass "linger habilitado — o serviço sobe mesmo sem ninguém logar na tela"
  else
    problem "linger não está habilitado (estado: ${linger:-desconhecido})" \
      "rode: sudo loginctl enable-linger $(id -un)  — sem isso, o serviço só sobe depois de um login gráfico."
  fi
}

# --- 6. Timer de backup ------------------------------------------------------------

check_backup_timer() {
  section "Timer de backup ($BACKUP_TIMER_UNIT)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "timer ativo e a última execução do backup teve sucesso" \
      "systemctl --user is-active $BACKUP_TIMER_UNIT + systemctl --user show $BACKUP_SERVICE_UNIT -p Result,LastTriggerUSec"
    return 0
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    skip "systemctl não encontrado — não dá para checar o timer automaticamente"
    return 0
  fi

  local timer_active
  timer_active="$(systemctl --user is-active "$BACKUP_TIMER_UNIT" 2>/dev/null || true)"
  if [ "$timer_active" = "active" ]; then
    pass "timer ativo (aguardando o próximo disparo às 04:00)"
  else
    problem "$BACKUP_TIMER_UNIT não está ativo (estado: ${timer_active:-desconhecido})" \
      "rode: systemctl --user enable --now $BACKUP_TIMER_UNIT"
  fi

  local last_trigger
  last_trigger="$(systemctl --user show "$BACKUP_TIMER_UNIT" --property=LastTriggerUSec --value 2>/dev/null || true)"
  if [ -z "$last_trigger" ] || [ "$last_trigger" = "0" ]; then
    soft_warn "o backup ainda não rodou nenhuma vez" \
      "normal logo após a instalação; roda sozinho às 04:00, ou rode agora com 'systemctl --user start $BACKUP_SERVICE_UNIT'."
    return 0
  fi

  local result
  result="$(systemctl --user show "$BACKUP_SERVICE_UNIT" --property=Result --value 2>/dev/null || true)"
  if [ "$result" = "success" ]; then
    pass "a última execução do backup teve sucesso"
  else
    problem "a última execução de $BACKUP_SERVICE_UNIT terminou com resultado '$result', não 'success'" \
      "rode: journalctl --user -u $BACKUP_SERVICE_UNIT -n 50  para ver o motivo."
  fi
}

# --- 7. Fuso horário --------------------------------------------------------------

check_timezone() {
  section "Fuso horário"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "fuso é America/Sao_Paulo" "timedatectl show --property=Timezone --value"
    return 0
  fi

  if ! command -v timedatectl >/dev/null 2>&1; then
    skip "timedatectl não encontrado — não dá para checar o fuso automaticamente"
    return 0
  fi

  local tz
  tz="$(timedatectl show --property=Timezone --value 2>/dev/null || true)"
  if [ "$tz" = "America/Sao_Paulo" ]; then
    pass "America/Sao_Paulo"
  else
    problem "fuso horário é '${tz:-desconhecido}', deveria ser America/Sao_Paulo" \
      "rode: sudo timedatectl set-timezone America/Sao_Paulo  — sem isso, o fechamento do mês pode atribuir lançamentos ao mês errado."
  fi
}

# --- 8. Energia (sono e tampa) ------------------------------------------------------

check_power() {
  section "Energia (sono e tampa fechada)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "logind.conf.d com HandleLidSwitch=ignore/IdleAction=ignore, e XFCE sem suspender/apagar tela" \
      "grep em $LOGIND_DROPIN_DIR + xfconf-query -c xfce4-power-manager"
    return 0
  fi

  local logind_ok=0
  if grep -h -E '^\s*HandleLidSwitch\s*=\s*ignore' "$LOGIND_DROPIN_DIR"/*.conf /etc/systemd/logind.conf 2>/dev/null | grep -q .; then
    logind_ok=1
  fi
  if [ "$logind_ok" -eq 1 ]; then
    pass "logind: HandleLidSwitch=ignore configurado"
  else
    problem "logind não tem HandleLidSwitch=ignore configurado em $LOGIND_DROPIN_DIR nem em /etc/systemd/logind.conf" \
      "rode 'scripts/install.sh' de novo, ou crie manualmente $LOGIND_DROPIN_DIR/motoclub.conf com [Login] / HandleLidSwitch=ignore / IdleAction=ignore, e reinicie."
  fi

  if ! command -v xfconf-query >/dev/null 2>&1; then
    skip "xfconf-query não encontrado (sessão não é XFCE, ou o pacote não está instalado) — confira manualmente o Gerenciador de Energia"
    return 0
  fi

  local lid_ac
  lid_ac="$(xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/lid-action-on-ac 2>/dev/null || true)"
  if [ "$lid_ac" = "0" ]; then
    pass "XFCE: tampa fechada com notebook na tomada = nada fazer"
  else
    problem "XFCE: ação da tampa com notebook na tomada não está em 'nada fazer' (valor lido: '${lid_ac:-vazio}')" \
      "abra Configurações > Gerenciador de Energia > Geral e ajuste 'Ao fechar a tampa' para 'Nada fazer', ou rode 'scripts/install.sh' de novo."
  fi
}

# --- 9. Backups locais --------------------------------------------------------------

check_backups() {
  section "Backups locais ($BACKUP_DIR)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "existe um backup recente (menos de 36h)" "find $BACKUP_DIR -name 'bar-*.sqlite3' -newermt '-36 hours'"
    return 0
  fi

  if [ ! -d "$BACKUP_DIR" ]; then
    problem "diretório de backups não existe: $BACKUP_DIR" \
      "rode 'scripts/install.sh' (ele cria o diretório) e depois 'systemctl --user start $BACKUP_SERVICE_UNIT'."
    return 0
  fi

  local newest
  newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'bar-*.sqlite3' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
  if [ -z "$newest" ]; then
    problem "nenhum backup encontrado em $BACKUP_DIR" \
      "rode: systemctl --user start $BACKUP_SERVICE_UNIT"
    return 0
  fi

  local age_seconds now mtime
  now="$(date +%s)"
  mtime="$(stat -c%Y "$newest" 2>/dev/null || echo 0)"
  age_seconds=$((now - mtime))
  if [ "$age_seconds" -le $((36 * 3600)) ]; then
    pass "backup mais recente: $(basename "$newest") (há $((age_seconds / 3600))h)"
  else
    problem "o backup mais recente ($(basename "$newest")) tem $((age_seconds / 3600))h — mais que as 36h esperadas" \
      "confira o timer com 'systemctl --user status $BACKUP_TIMER_UNIT' e rode 'journalctl --user -u $BACKUP_SERVICE_UNIT' para ver se está falhando."
  fi
}

# --- 10. Pendrive --------------------------------------------------------------------

check_usb() {
  section "Pendrive de backup"
  if [ -z "$USB_PATH" ]; then
    soft_warn "nenhum pendrive configurado (BAR_BACKUP_USB_PATH não está em $ENV_FILE)" \
      "os backups existem só no HD interno. Rode 'scripts/install.sh' de novo para configurar um pendrive."
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    plan "pendrive montado e gravável em $USB_PATH" "test -d + test -w + escrita de teste em $USB_PATH"
    return 0
  fi

  if [ ! -d "$USB_PATH" ]; then
    problem "pendrive configurado em $USB_PATH, mas o caminho não existe (não está montado?)" \
      "conecte e monte o pendrive no caminho configurado, ou rode 'scripts/install.sh' de novo para atualizar o caminho."
    return 0
  fi

  local probe="$USB_PATH/.motoclub-doctor-probe"
  if ( : > "$probe" ) 2>/dev/null; then
    rm -f "$probe"
    pass "pendrive montado e gravável em $USB_PATH"
  else
    problem "pendrive em $USB_PATH existe mas não é gravável" \
      "confira permissões e se o pendrive não está montado como somente-leitura."
  fi
}

# --- main --------------------------------------------------------------------------

echo "Diagnóstico do Motoclub"
echo "Checkout: $HOME_DIR"

check_node
check_env_file
check_database
check_service
check_linger
check_backup_timer
check_timezone
check_power
check_backups
check_usb

echo
echo "== Resumo =="
if [ "$DRY_RUN" -eq 1 ]; then
  echo "modo --dry-run: nenhuma checagem real foi executada."
  exit 0
fi

if [ "$FAILS" -eq 0 ]; then
  if [ "$WARNS" -gt 0 ]; then
    echo "Tudo certo, com $WARNS aviso(s) acima (não bloqueiam, mas vale olhar)."
  else
    echo "Tudo certo."
  fi
  exit 0
else
  echo "$FAILS problema(s) encontrado(s) — veja 'o que fazer' em cada linha marcada FALHOU acima."
  exit 3
fi
