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
# node:sqlite só existe a partir do Node 22.5 — major>=22 sozinho não
# basta (ver find_node abaixo).
NODE_MIN_VERSION="22.5.0"

# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/lib/version.sh"
# shellcheck source=lib/env-file.sh
source "$SCRIPT_DIR/lib/env-file.sh"
# shellcheck source=lib/xfce-power-props.sh
source "$SCRIPT_DIR/lib/xfce-power-props.sh"

# Só aceita um Node que realmente tenha node:sqlite (>= 22.5). Um node do
# PATH mais antigo que isso não deve ser usado para checar o banco — na
# melhor hipótese ele nem tem o módulo (e o processo morre com um erro
# feio); na pior, dá um resultado que parece "corrompido" sem ser: o
# ambiente é que está errado, não o banco.
find_node() {
  local candidate=""
  if [ -x "$NODE_LINK/bin/node" ]; then
    candidate="$NODE_LINK/bin/node"
  elif command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
  fi
  [ -z "$candidate" ] && return 0

  local candidate_version
  candidate_version="$("$candidate" --version 2>/dev/null || true)"
  if node_version_ge "$candidate_version" "$NODE_MIN_VERSION"; then
    echo "$candidate"
  fi
  # Se a versão não serve, ecoa nada — quem chama (check_database) já
  # trata NODE_BIN vazio como "não dá para checar", em vez de arriscar um
  # falso "corrompido".
}
NODE_BIN="$(find_node)"

# Lê uma variável de dentro do arquivo de env SEM interpretá-lo como shell
# script (nunca `source`): valores como BAR_PIN_HASH contêm "$" de verdade
# (formato scrypt$salt$hash), e um `source` os trataria como expansão de
# variável, corrompendo o valor em silêncio. O arquivo é um EnvironmentFile
# de systemd (KEY=value literal), não um script — lemos assim: extração de
# texto puro, sem nenhuma interpretação.
read_env_var() {
  # Delega para lib/env-file.sh, que é também quem o install.sh e o
  # restore.sh usam. Importa aqui em particular porque check_env_file()
  # valida BAR_PIN_HASH contra ^scrypt$hex$hex$: sem tirar as aspas
  # envolventes, um arquivo de segredos novo (que grava os valores entre
  # aspas simples) seria julgado "formato inválido", e a orientação
  # impressa manda apagar o arquivo e reinstalar — ou seja, rotacionaria
  # um PIN que está funcionando.
  env_file_var "$ENV_FILE" "$1"
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
# Tudo no MESMO stream (stdout) — nunca stderr aqui. O valor deste comando
# É a sua saída: "doctor.sh > diagnostico.txt" precisa capturar as linhas
# FALHOU tanto quanto as OK, senão o arquivo fica só com o lado bonito.
problem() {
  echo "  FALHOU   $1"
  if [ -n "${2:-}" ]; then
    echo "           o que fazer: $2"
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
      "rode '$SCRIPT_DIR/install.sh' para instalar o Node."
    return 0
  fi

  local version
  version="$("$NODE_LINK/bin/node" --version 2>/dev/null || true)"
  if node_version_ge "$version" "$NODE_MIN_VERSION"; then
    pass "Node $version em $NODE_LINK/bin/node (>= $NODE_MIN_VERSION)"
  else
    problem "Node em $NODE_LINK é $version, mais antigo que o exigido (>= $NODE_MIN_VERSION; node:sqlite só existe a partir daí)" \
      "rode '$SCRIPT_DIR/install.sh' de novo para atualizar o Node."
  fi
}

# --- 1b. Artefatos de build -----------------------------------------------------

# O login (servido em "/" sem cookie) é uma página estática embutida no
# próprio servidor — ela responde 200 sem nunca ler dist/. Por isso "curl /"
# não prova que o front-end existe: um `git pull` na branch errada, um
# `git clean -xdf`, ou um artefato não commitado passam por essa checagem
# em silêncio, e o app vira tela branca depois de autenticar. Checamos os
# artefatos diretamente, como install.sh já faz.
check_artifacts() {
  section "Artefatos de build ($HOME_DIR)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "dist/index.html e server/dist/server.mjs existem, e qual build está instalado" \
      "test -f $HOME_DIR/dist/index.html && test -f $HOME_DIR/server/dist/server.mjs && cat $HOME_DIR/producao-info.json"
    return 0
  fi

  if [ ! -f "$HOME_DIR/dist/index.html" ] || [ ! -f "$HOME_DIR/server/dist/server.mjs" ]; then
    problem "não encontrei $HOME_DIR/dist/index.html e/ou $HOME_DIR/server/dist/server.mjs" \
      "o build (front-end e servidor) é feito na máquina de desenvolvimento e chega aqui só por 'git pull' na branch de produção — confira se '$HOME_DIR' é o checkout certo e se você deu esse pull antes de continuar."
    return 0
  fi
  pass "dist/index.html e server/dist/server.mjs presentes"

  # Qual build está instalado. Sem isto, depois de um 'git pull &&
  # systemctl --user restart motoclub' não há como saber se a versão nova
  # entrou de fato — e "atualizei mas o problema continua" é
  # indistinguível de "o pull não pegou".
  local info="$HOME_DIR/producao-info.json"
  if [ ! -f "$info" ]; then
    soft_warn "não achei $info — não dá para dizer qual build está instalado" \
      "esperado num checkout da branch de produção; se este é um checkout de código-fonte, o serviço pode estar rodando um bundle compilado à mão."
    return 0
  fi

  # Um jq de uma linha em bash: nada de dependência nova só para ler três
  # campos de um JSON que nós mesmos geramos.
  local commit data
  commit="$(sed -nE 's/.*"sourceCommit"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$info" | head -1)"
  data="$(sed -nE 's/.*"builtAt"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$info" | head -1)"

  if [ -z "$commit" ]; then
    soft_warn "$info existe mas não tem sourceCommit legível" \
      "o arquivo é gerado por scripts/publish-producao.sh na máquina de desenvolvimento; se foi editado à mão, refaça a publicação."
    return 0
  fi

  pass "build instalado: ${commit:0:9} (compilado em ${data:-data desconhecida})"

  # O bundle é mais novo que o commit? Se alguém compilou na máquina
  # errada, o artefato e o código deixam de corresponder — e é o
  # artefato que roda.
  if [ -n "$(find "$HOME_DIR/server/dist/server.mjs" -newer "$info" 2>/dev/null)" ]; then
    soft_warn "server/dist/server.mjs é mais novo que $info" \
      "sinal de bundle compilado localmente por cima do publicado; o que roda é o bundle, não o commit informado acima. Um 'git checkout -- server/dist' ou um pull novo devolve o artefato publicado."
  fi
}

# --- 2. Arquivo de segredos -----------------------------------------------------

check_update_path() {
  section "Caminho de atualização (git)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "git instalado e $HOME_DIR é um checkout da branch de produção" \
      "command -v git && git -C $HOME_DIR rev-parse --abbrev-ref HEAD"
    return 0
  fi

  # Medido no alvo: o Linux Mint 22.3 XFCE **não** traz git instalado.
  # Isso importa mais do que parece — este script e o install.sh dizem ao
  # operador "dê git pull na branch de produção" como o jeito de
  # atualizar. Sem git, essa orientação é impossível de seguir, e a
  # pessoa descobre isso justamente quando precisa de uma correção.
  if ! command -v git >/dev/null 2>&1; then
    problem "git não está instalado — não há como atualizar este sistema" \
      "rode: sudo apt-get install -y git   (o Mint não traz git por padrão; sem ele, 'git pull' não existe e a única forma de atualizar seria copiar arquivos à mão)"
    return 0
  fi
  pass "git $(git --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) instalado"

  if ! git -C "$HOME_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    problem "$HOME_DIR não é um checkout git" \
      "os artefatos chegam por 'git pull' na branch de produção; se esta pasta foi copiada à mão, refaça com: git clone --branch producao <url> '$HOME_DIR'"
    return 0
  fi

  local branch remoto
  # `symbolic-ref --short HEAD` e não `rev-parse --abbrev-ref HEAD`: o
  # segundo devolve a string literal "HEAD" tanto para HEAD desanexado
  # quanto para branch sem commit, e aí a mensagem sairia dizendo que a
  # branch se chama "HEAD". O symbolic-ref falha nesses casos, o que é a
  # informação que queremos: sem branch, `git pull` não tem o que puxar.
  remoto="$(git -C "$HOME_DIR" config --get remote.origin.url 2>/dev/null)"
  if ! branch="$(git -C "$HOME_DIR" symbolic-ref --short HEAD 2>/dev/null)"; then
    problem "o checkout não está em nenhuma branch (HEAD desanexado)" \
      "'git pull' não funciona assim. Volte para a branch de produção com: git -C '$HOME_DIR' checkout producao"
    return 0
  fi

  if [ "$branch" = "producao" ]; then
    pass "checkout na branch 'producao' (origem: ${remoto:-desconhecida})"
  else
    soft_warn "o checkout está na branch '$branch', não em 'producao'" \
      "só a branch 'producao' carrega dist/ e server/dist/server.mjs commitados; nas outras o 'git pull' traz código-fonte sem artefato, e este notebook não compila. Troque com: git -C '$HOME_DIR' checkout producao"
  fi
}

check_env_file() {
  section "Arquivo de segredos ($ENV_FILE)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "arquivo existe, permissão 600, tem BAR_PIN_HASH e BAR_SESSION_SECRET" "stat + grep em $ENV_FILE"
    return 0
  fi

  if [ ! -f "$ENV_FILE" ]; then
    problem "arquivo de segredos não existe em $ENV_FILE" \
      "rode '$SCRIPT_DIR/install.sh' para criá-lo (ele vai pedir o PIN do bar)."
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
        "apague '$ENV_FILE' e rode '$SCRIPT_DIR/install.sh' de novo para recriar os segredos (ele já reinicia o serviço no fim, então o valor novo passa a valer sem passo extra)."
    fi
  else
    problem "BAR_PIN_HASH ausente em $ENV_FILE" \
      "apague '$ENV_FILE' e rode '$SCRIPT_DIR/install.sh' de novo para recriar os segredos (ele já reinicia o serviço no fim, então o valor novo passa a valer sem passo extra)."
  fi

  if [ -n "$session_secret" ]; then
    pass "BAR_SESSION_SECRET presente"
  else
    problem "BAR_SESSION_SECRET ausente em $ENV_FILE" \
      "apague '$ENV_FILE' e rode '$SCRIPT_DIR/install.sh' de novo para recriar os segredos (ele já reinicia o serviço no fim, então o valor novo passa a valer sem passo extra)."
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
      "se o serviço nunca rodou ainda, inicie-o com 'systemctl --user start $SERVICE_UNIT'; se já rodou e o arquivo sumiu, restaure com '$SCRIPT_DIR/restore.sh'."
    return 0
  fi
  pass "arquivo existe"

  if [ -z "$NODE_BIN" ]; then
    skip "não dá para checar a integridade sem Node — resolva a checagem de Node acima primeiro"
    return 0
  fi

  # sqlite-check.mjs sai 0=ok, 1=corrompido, 2=não deu para verificar (ver
  # o arquivo em si). O exit code, não o texto, é quem decide se a
  # recomendação é "restaure agora" — um "não deu para verificar" não é
  # evidência de corrupção, e recomendar restauração por causa disso
  # manda um leigo mexer no banco (via restore.sh) sem necessidade.
  local result exit_code
  result="$("$NODE_BIN" --no-warnings "$SCRIPT_DIR/lib/sqlite-check.mjs" "$DB_PATH" 2>/dev/null)"
  exit_code=$?
  case "$exit_code" in
    0)
      pass "PRAGMA integrity_check = ok"
      ;;
    2)
      problem "não consegui verificar a integridade do banco: $result" \
        "isto não é, por si só, evidência de corrupção — confira permissões e se o arquivo não mudou nesse meio-tempo antes de considerar restaurar."
      ;;
    *)
      problem "PRAGMA integrity_check falhou: $result" \
        "pare o serviço e restaure o backup mais recente com '$SCRIPT_DIR/restore.sh' — não continue usando um banco corrompido."
      ;;
  esac
}

# --- 3b. Histórico de versões ----------------------------------------------------

# kv_history (escrita pelo servidor a cada gravação, lida/restaurada por
# scripts/history.mjs) é a rede de segurança de "desfazer um toque
# errado". Sem este check, um operador debugando uma noite perdida não
# tem, pelo doctor.sh, como descobrir que essa ferramenta existe.
check_history() {
  section "Histórico de versões (kv_history)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "tabela kv_history existe, quantas versões guarda, data da mais recente" \
      "node scripts/lib/history-status.mjs $DB_PATH"
    return 0
  fi

  if [ ! -f "$DB_PATH" ]; then
    skip "banco não existe ainda — nada para reportar sobre o histórico (veja a seção 'Banco de dados' acima)"
    return 0
  fi
  if [ -z "$NODE_BIN" ]; then
    skip "não dá para checar o histórico sem Node — resolva a checagem de Node acima primeiro"
    return 0
  fi

  local status_line exists count most_recent
  status_line="$("$NODE_BIN" --no-warnings "$SCRIPT_DIR/lib/history-status.mjs" "$DB_PATH" 2>/dev/null)"
  exists="$(echo "$status_line" | grep -oE 'exists=[01]' | cut -d= -f2)"
  count="$(echo "$status_line" | grep -oE 'count=[0-9]+' | cut -d= -f2)"
  most_recent="$(echo "$status_line" | sed -E 's/^.*mostRecent=(.*)$/\1/')"

  if [ "$exists" != "1" ]; then
    soft_warn "tabela kv_history não existe neste banco" \
      "normal só se o banco foi criado antes do recurso de histórico existir; sem ela não há versões antigas para restaurar com '$SCRIPT_DIR/history.mjs'."
    return 0
  fi

  if [ "${count:-0}" -eq 0 ]; then
    soft_warn "kv_history existe mas ainda não tem nenhuma versão guardada" \
      "normal logo após a instalação, antes do primeiro lançamento; toda gravação seguinte passa a registrar uma versão aqui."
  else
    pass "kv_history: $count versão(ões) guardada(s), mais recente em ${most_recent:--}"
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

  # Nomear o arquivo a corrigir não basta: a correção só vale depois de o
  # processo reiniciar (EnvironmentFile só é lido no boot do processo), e
  # com Restart=always + o StartLimitBurst padrão do systemd, uma unidade
  # que falhou rápido demais várias vezes fica em "failed" travada — um
  # "restart" direto nela não faz nada até "reset-failed" limpar esse
  # estado. Sem isso, quem corrigir o env, rodar doctor de novo e ver o
  # mesmo vermelho conclui (errado) que a correção não funcionou.
  local restart_hint="depois de corrigir, rode: systemctl --user restart $SERVICE_UNIT"
  if [ "$active" = "failed" ]; then
    restart_hint="depois de corrigir, rode NESTA ORDEM: 'systemctl --user reset-failed $SERVICE_UNIT' (o systemd para de tentar sozinho depois de falhar rápido demais — sem isso um 'restart' direto pode não fazer nada) e só então 'systemctl --user restart $SERVICE_UNIT'"
  fi
  hint="$hint $restart_hint. A mensagem exata está no journal (abaixo) ou em 'journalctl --user -u $SERVICE_UNIT -n 20'."

  problem "$SERVICE_UNIT não está ativo (estado: ${active:-desconhecido})" "$hint"

  if command -v journalctl >/dev/null 2>&1; then
    local tail
    tail="$(journalctl --user -u "$SERVICE_UNIT" -n 20 --no-pager 2>/dev/null || true)"
    if [ -n "$tail" ]; then
      echo "           últimas linhas do journal:"
      echo "$tail" | sed 's/^/             /'
    fi
  fi
}

check_service() {
  section "Serviço ($SERVICE_UNIT)"
  if [ "$DRY_RUN" -eq 1 ]; then
    plan "habilitado, ativo e respondendo em http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/healthz" \
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
    # "/healthz" e não "/": a raiz sem cookie devolve a página de login
    # embutida no servidor, 200, sem nunca ler dist/ — não prova que o
    # processo (nem os artefatos) estão realmente de pé. "/healthz" é
    # ungated e é só isso que essa checagem quer confirmar; a checagem de
    # artefatos, acima, cobre o dist/ separadamente.
    if curl -fsS --max-time 3 -o /dev/null "http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/healthz"; then
      pass "processo respondendo (/healthz) em http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/"
    else
      problem "/healthz não respondeu em http://$BAR_HOST_EFFECTIVE:$BAR_PORT_EFFECTIVE/" \
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
      "systemctl --user is-active $BACKUP_TIMER_UNIT + journalctl --user -u $BACKUP_SERVICE_UNIT -n 1 + systemctl --user show $BACKUP_SERVICE_UNIT -p Result"
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

  # "Já rodou alguma vez" não pode depender só do LastTriggerUSec do
  # TIMER: um "systemctl start motoclub-backup.service" manual — que é
  # exatamente o que install.sh faz, de propósito, para provar a cadeia de
  # backup já na instalação — não passa pelo timer, e por isso não
  # atualiza esse campo. Sem este ajuste, o doctor diria "o backup ainda
  # não rodou nenhuma vez" segundos depois do próprio instalador ter
  # acabado de dizer "primeiro backup gerado com sucesso" — uma
  # contradição direta na cara de quem acabou de instalar. Em vez disso,
  # perguntamos ao journal se existe qualquer execução registrada (e
  # "Result" — que este ambiente confirmou ser 'success' mesmo para uma
  # unidade que NUNCA rodou — não seria confiável sozinho para decidir isso).
  local has_run=0
  if command -v journalctl >/dev/null 2>&1; then
    if journalctl --user -u "$BACKUP_SERVICE_UNIT" -n 1 --no-pager --quiet 2>/dev/null | grep -q .; then
      has_run=1
    fi
  fi

  if [ "$has_run" -eq 0 ]; then
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
      "rode '$SCRIPT_DIR/install.sh' de novo, ou crie manualmente $LOGIND_DROPIN_DIR/motoclub.conf com [Login] / HandleLidSwitch=ignore / IdleAction=ignore, e reinicie."
  fi

  if ! command -v xfconf-query >/dev/null 2>&1; then
    skip "xfconf-query não encontrado (sessão não é XFCE, ou o pacote não está instalado) — confira manualmente o Gerenciador de Energia"
    return 0
  fi

  # Relê as MESMAS oito propriedades que install.sh escreve (scripts/lib/
  # xfce-power-props.sh é a lista única de verdade) — reler só uma dava
  # falsa sensação de segurança justamente na maior suposição não
  # verificada desta entrega (os nomes de propriedade certos para a versão
  # do xfce4-power-manager do Mint 22).
  local xfce_ok=1
  for entry in "${XFCE_POWER_PROPS[@]}"; do
    split_xfce_prop_entry "$entry"
    local current_value
    current_value="$(xfconf-query -c xfce4-power-manager -p "$PROP" 2>/dev/null || true)"
    if [ "$current_value" != "$PROP_VALUE" ]; then
      xfce_ok=0
      problem "XFCE: $PROP não está em '$PROP_VALUE' (valor lido: '${current_value:-vazio}')" \
        "abra Configurações > Gerenciador de Energia e confira as opções de tampa/tela/suspensão, ou rode '$SCRIPT_DIR/install.sh' de novo."
    fi
  done
  if [ "$xfce_ok" -eq 1 ]; then
    pass "XFCE: as oito propriedades de energia estão como esperado (tela e tampa nunca suspendem)"
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
      "rode '$SCRIPT_DIR/install.sh' (ele cria o diretório) e depois 'systemctl --user start $BACKUP_SERVICE_UNIT'."
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
      "os backups existem só no HD interno. Rode '$SCRIPT_DIR/install.sh' de novo para configurar um pendrive."
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    plan "pendrive montado e gravável em $USB_PATH" "test -d + test -w + escrita de teste em $USB_PATH"
    return 0
  fi

  if [ ! -d "$USB_PATH" ]; then
    problem "pendrive configurado em $USB_PATH, mas o caminho não existe (não está montado?)" \
      "conecte e monte o pendrive no caminho configurado, ou rode '$SCRIPT_DIR/install.sh' de novo para atualizar o caminho."
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
check_artifacts
check_update_path
check_env_file
check_database
check_history
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
