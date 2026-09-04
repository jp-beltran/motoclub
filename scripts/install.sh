#!/usr/bin/env bash
# scripts/install.sh — instalação completa e idempotente do Motoclub no
# Linux Mint 22 XFCE (notebook do bar). Pode ser rodado de novo com
# segurança a qualquer momento: cada passo primeiro confere o que já
# existe e só age no que falta.
#
# O que este script NUNCA faz: compilar nada. `dist/` e
# `server/dist/server.mjs` chegam prontos via `git pull` na branch de
# produção; se não estiverem lá, o script para e explica isso, não tenta
# rodar `npm ci`/`npm run build`.
#
# Uso:
#   scripts/install.sh                 instala de verdade
#   scripts/install.sh --dry-run       só mostra o que faria, sem tocar em nada
#   scripts/install.sh --node-version=v22.14.0
#                                       fixa a versão do Node a instalar
#                                       (por padrão, consulta nodejs.org pela
#                                       LTS mais recente da série 22.x)
#
# Variáveis de ambiente só para desenvolvimento/teste deste script (nunca
# use em produção — mudam onde o instalador olha e escreve):
#   MOTOCLUB_HOME_DIR            checkout do app (padrão: ~/motoclub)
#   MOTOCLUB_CONFIG_DIR          diretório de config (padrão: ~/.config/motoclub)
#   MOTOCLUB_ENV_FILE            arquivo de segredos (padrão: $MOTOCLUB_CONFIG_DIR/env)
#   BAR_DB_PATH                  arquivo do banco (padrão do contrato)
#   BAR_BACKUP_DIR               diretório de backups (padrão: ~/Backups/motoclub)
#   MOTOCLUB_SYSTEMD_USER_DIR    onde copiar as unidades (padrão: ~/.config/systemd/user)
#   MOTOCLUB_NODE_INSTALL_ROOT   onde instalar o Node (padrão: /opt)
#   MOTOCLUB_LOGIND_DROPIN_DIR   onde gravar o drop-in do logind (padrão: /etc/systemd/logind.conf.d)
#   MOTOCLUB_INSTALL_PIN / MOTOCLUB_INSTALL_PIN_CONFIRM
#                                 respostas não-interativas ao prompt de PIN (só testes)
#   MOTOCLUB_INSTALL_USB_PATH    resposta não-interativa ao prompt do pendrive (só testes;
#                                 string vazia = "pular")
#   MOTOCLUB_SKIP_SYSTEMCTL=1    pula as chamadas reais a systemctl/loginctl mesmo fora
#                                 de --dry-run (só para testar a cópia de arquivos sem
#                                 mexer no systemd de verdade — nunca use isso instalando
#                                 para valer)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/version.sh
source "$SCRIPT_DIR/lib/version.sh"

# --- configuração (todas sobrescrevíveis para teste, ver cabeçalho) ---------

HOME_DIR="${MOTOCLUB_HOME_DIR:-$HOME/motoclub}"
CONFIG_DIR="${MOTOCLUB_CONFIG_DIR:-$HOME/.config/motoclub}"
ENV_FILE="${MOTOCLUB_ENV_FILE:-$CONFIG_DIR/env}"
DB_PATH="${BAR_DB_PATH:-$HOME/.local/share/motoclub/bar.sqlite3}"
BACKUP_DIR="${BAR_BACKUP_DIR:-$HOME/Backups/motoclub}"
SYSTEMD_USER_DIR="${MOTOCLUB_SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"
NODE_INSTALL_ROOT="${MOTOCLUB_NODE_INSTALL_ROOT:-/opt}"
NODE_LINK="$NODE_INSTALL_ROOT/node"
LOGIND_DROPIN_DIR="${MOTOCLUB_LOGIND_DROPIN_DIR:-/etc/systemd/logind.conf.d}"

SERVICE_UNIT="motoclub.service"
BACKUP_SERVICE_UNIT="motoclub-backup.service"
BACKUP_TIMER_UNIT="motoclub-backup.timer"

NODE_MAJOR_REQUIRED=22
MIN_GLIBC="2.28"
# Usada só se não der para consultar nodejs.org (ex.: sem internet nesse
# instante). Vale a pena revisar esta constante de vez em quando.
NODE_FALLBACK_VERSION="v22.14.0"

DRY_RUN=0
NODE_VERSION_OVERRIDE=""

usage() {
  cat <<'EOF'
Uso: install.sh [--dry-run] [--node-version=vX.Y.Z]

Instala e configura o Motoclub neste computador: Node, diretórios, segredos
do PIN, fuso horário, serviço systemd, backup automático e as configurações
de energia que impedem o notebook de dormir. Idempotente: pode ser rodado
de novo a qualquer momento.

  --dry-run              mostra o que seria feito, sem alterar nada
  --node-version=vX.Y.Z  força uma versão específica do Node 22 LTS
  -h, --help             mostra esta ajuda
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --node-version=*) NODE_VERSION_OVERRIDE="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "argumento desconhecido: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# --- saída ------------------------------------------------------------------

say() { echo "$@"; }
info() { echo "-> $*"; }
ok() { echo "  OK  $*"; }
warn() { echo "  ATENCAO  $*" >&2; }
fail() { echo "  FALHOU  $*" >&2; }
step() { echo; echo "== $* =="; }

# --- sudo: pedido uma vez só, explicado, no início --------------------------

SUDO_EXPLAINED=0
ensure_sudo() {
  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  if [ "$SUDO_EXPLAINED" -eq 0 ]; then
    say ""
    say "Este instalador precisa de privilégios administrativos (sudo) para três coisas:"
    say "  1) instalar o Node em $NODE_INSTALL_ROOT (fora da sua pasta pessoal)"
    say "  2) ligar o serviço no boot sem precisar fazer login gráfico (loginctl enable-linger)"
    say "  3) impedir que o sistema durma sozinho, num arquivo em /etc (logind.conf.d)"
    say "Vai ser pedido uma vez agora; o resto do instalador não pede sudo de novo."
    SUDO_EXPLAINED=1
  fi
  sudo -v
}

# Roda um comando com sudo só se o diretório-alvo (ou o ancestral mais
# próximo que já existe) não for gravável pelo usuário atual. Evita pedir
# privilégio quando não é preciso, e é o que torna este script testável
# apontando os diretórios para um lugar de teste, gravável sem sudo.
nearest_existing_dir() {
  local d="$1"
  while [ ! -d "$d" ]; do
    d="$(dirname "$d")"
  done
  echo "$d"
}

needs_sudo_for() {
  local nearest
  nearest="$(nearest_existing_dir "$1")"
  [ ! -w "$nearest" ]
}

# --- Fase 1: pré-requisitos (saída 2) ----------------------------------------

check_preconditions() {
  step "Verificando pré-requisitos"

  local arch
  arch="$(uname -m)"
  if [ "$arch" != "x86_64" ]; then
    fail "arquitetura '$arch' não é suportada — este instalador só funciona em x86_64."
    fail "Se esta máquina for de 32 bits, o Node moderno e o Mint 22 não existem para ela; o plano precisa mudar antes de continuar."
    exit 2
  fi
  ok "arquitetura x86_64"

  local glibc_line glibc_version
  glibc_line="$(ldd --version 2>/dev/null | head -1 || true)"
  # "|| true": glibc_line vazia/sem número não é um erro de programação,
  # é um resultado possível que o "if" logo abaixo já trata — sem isso,
  # com `set -e`, um valor sem match abortaria o script em silêncio.
  glibc_version="$(parse_glibc_version "$glibc_line" || true)"
  if [ -z "$glibc_version" ] || ! version_ge "$glibc_version" "$MIN_GLIBC"; then
    fail "glibc '${glibc_version:-desconhecida}' é mais antiga que a mínima exigida ($MIN_GLIBC)."
    fail "Isso normalmente significa que o sistema não é o Mint 22 (ou equivalente Ubuntu 24.04+). Reinstale o Mint 22 antes de continuar."
    exit 2
  fi
  ok "glibc $glibc_version (>= $MIN_GLIBC)"

  if [ "$(id -u)" -eq 0 ]; then
    fail "não rode este instalador como root (nem com sudo direto)."
    fail "O serviço do Motoclub roda como um serviço de USUÁRIO — precisa ser instalado pelo usuário dono do bar. Rode de novo sem sudo; o script pede sudo sozinho quando precisar."
    exit 2
  fi
  ok "não está rodando como root"

  if [ ! -f "$HOME_DIR/dist/index.html" ] || [ ! -f "$HOME_DIR/server/dist/server.mjs" ]; then
    fail "não encontrei $HOME_DIR/dist/index.html e/ou $HOME_DIR/server/dist/server.mjs."
    fail "Isso é esperado: o build (front-end e servidor) é feito na máquina de desenvolvimento e chega aqui só por 'git pull' na branch de produção — este notebook nunca compila nada."
    fail "Confira se '$HOME_DIR' é o checkout certo e se você deu 'git pull' na branch de produção antes de rodar o instalador."
    exit 2
  fi
  ok "artefatos de build encontrados em $HOME_DIR (dist/ e server/dist/server.mjs)"
}

# --- Fase 2: Node -------------------------------------------------------------

current_node_version() {
  if [ -x "$NODE_LINK/bin/node" ]; then
    "$NODE_LINK/bin/node" --version 2>/dev/null || true
  fi
}

resolve_latest_node_version() {
  local shasums
  shasums="$(curl -fsSL --max-time 10 "https://nodejs.org/dist/latest-v${NODE_MAJOR_REQUIRED}.x/SHASUMS256.txt" 2>/dev/null || true)"
  if [ -z "$shasums" ]; then
    return 1
  fi
  echo "$shasums" \
    | grep -oE "node-v${NODE_MAJOR_REQUIRED}\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz" \
    | head -1 \
    | sed -E "s/^node-(v${NODE_MAJOR_REQUIRED}\.[0-9]+\.[0-9]+)-linux-x64\.tar\.xz\$/\1/"
}

ensure_node() {
  step "Node.js"
  local current
  current="$(current_node_version)"
  if node_version_ok "$current" "$NODE_MAJOR_REQUIRED"; then
    ok "Node $current já está pronto em $NODE_LINK/bin/node (>= $NODE_MAJOR_REQUIRED) — nada a fazer"
    return 0
  fi

  if [ -n "$current" ]; then
    info "Node em $NODE_LINK é $current, mais antigo que o exigido (>= $NODE_MAJOR_REQUIRED) — vou instalar uma versão nova ao lado"
  else
    info "Node não encontrado em $NODE_LINK/bin/node — vou instalar"
  fi

  local target_version="$NODE_VERSION_OVERRIDE"
  if [ -z "$target_version" ]; then
    target_version="$(resolve_latest_node_version || true)"
  fi
  if [ -z "$target_version" ]; then
    target_version="$NODE_FALLBACK_VERSION"
    warn "não consegui consultar nodejs.org para achar a versão LTS mais recente da série $NODE_MAJOR_REQUIRED.x."
    warn "Usando a versão fixa neste script ($target_version). Se ela estiver desatualizada, rode de novo com --node-version=vX.Y.Z."
  fi

  local tarball="node-${target_version}-linux-x64.tar.xz"
  local url="https://nodejs.org/dist/${target_version}/${tarball}"
  local shasums_url="https://nodejs.org/dist/${target_version}/SHASUMS256.txt"
  local install_dir="$NODE_INSTALL_ROOT/node-${target_version}"

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] baixaria $url"
    info "[dry-run] baixaria $shasums_url e conferiria o SHA256 do tarball contra a linha correspondente ali dentro"
    info "[dry-run] extrairia em $install_dir"
    info "[dry-run] apontaria o link $NODE_LINK para $install_dir"
    return 0
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp_dir'" RETURN

  info "Baixando $tarball..."
  curl -fsSL -o "$tmp_dir/$tarball" "$url"
  curl -fsSL -o "$tmp_dir/SHASUMS256.txt" "$shasums_url"

  local expected actual
  # "|| true" nos dois: não achar a linha (grep) seria estranho mas é
  # exatamente o que o "if" logo abaixo detecta e explica — sem o "|| true",
  # com `set -e`, isso abortaria o script em silêncio antes da mensagem.
  expected="$(grep " ${tarball}\$" "$tmp_dir/SHASUMS256.txt" | awk '{print $1}')" || true
  if [ -z "$expected" ]; then
    fail "não encontrei o hash de $tarball dentro de SHASUMS256.txt — abortando por segurança, sem instalar nada."
    exit 1
  fi
  actual="$(sha256sum "$tmp_dir/$tarball" | awk '{print $1}')" || true
  if [ "$expected" != "$actual" ]; then
    fail "SHA256 não confere para $tarball (esperado $expected, obtido $actual)."
    fail "O arquivo pode ter sido corrompido no download ou adulterado. Abortando sem instalar nada — rode de novo."
    exit 1
  fi
  ok "SHA256 de $tarball confere com o publicado em SHASUMS256.txt"

  local sudo_prefix=()
  if needs_sudo_for "$NODE_INSTALL_ROOT"; then
    ensure_sudo
    sudo_prefix=(sudo)
  fi

  info "Extraindo em $install_dir..."
  "${sudo_prefix[@]}" mkdir -p "$NODE_INSTALL_ROOT"
  "${sudo_prefix[@]}" tar -xJf "$tmp_dir/$tarball" -C "$NODE_INSTALL_ROOT"
  "${sudo_prefix[@]}" rm -rf "$install_dir"
  "${sudo_prefix[@]}" mv "$NODE_INSTALL_ROOT/node-${target_version}-linux-x64" "$install_dir"
  "${sudo_prefix[@]}" ln -sfn "$install_dir" "$NODE_LINK"
  ok "Node $target_version instalado em $install_dir e linkado em $NODE_LINK"
}

# --- Fase 3: diretórios -------------------------------------------------------

make_dir() {
  local dir="$1" mode="${2:-}"
  if [ -d "$dir" ]; then
    ok "diretório já existe: $dir"
  elif [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] criaria o diretório $dir"
  else
    mkdir -p "$dir"
    ok "criado: $dir"
  fi

  if [ -n "$mode" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      info "[dry-run] ajustaria a permissão de $dir para $mode"
    else
      chmod "$mode" "$dir"
    fi
  fi
}

ensure_directories() {
  step "Diretórios"
  make_dir "$(dirname "$DB_PATH")"
  make_dir "$CONFIG_DIR" 700
  make_dir "$BACKUP_DIR"
}

# --- Fase 4: segredos ----------------------------------------------------------

prompt_usb_path() {
  local path
  if [ -n "${MOTOCLUB_INSTALL_USB_PATH+x}" ]; then
    path="$MOTOCLUB_INSTALL_USB_PATH"
  else
    # Sem terminal interativo, `read` retorna erro em EOF; com `set -e`
    # isso mataria o script em silêncio se não fosse tratado aqui.
    if ! read -r -p "Caminho onde o pendrive de backup fica montado (Enter para pular por agora): " path; then
      warn "não consegui ler a resposta (terminal interativo necessário aqui) — pulando o pendrive por agora."
      path=""
    fi
  fi

  if [ -z "$path" ]; then
    warn "nenhum pendrive configurado — os backups vão existir só no HD interno, que é o disco com mais chance de falhar."
    warn "Rode o instalador de novo quando tiver um pendrive disponível."
    printf ''
    return 0
  fi

  if [ ! -d "$path" ] || [ ! -w "$path" ]; then
    fail "não consegui escrever em '$path' — confira se o pendrive está montado aí. Pulando por enquanto."
    printf ''
    return 0
  fi

  ok "pendrive verificado e gravável em $path"
  printf '%s' "$path"
}

ensure_usb_config_update_only() {
  local existing
  existing="$(grep -E '^BAR_BACKUP_USB_PATH=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  if [ -n "$existing" ]; then
    ok "pendrive de backup já configurado: $existing"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] perguntaria o caminho do pendrive e adicionaria BAR_BACKUP_USB_PATH a $ENV_FILE"
    return 0
  fi

  local usb_path
  usb_path="$(prompt_usb_path)"
  if [ -n "$usb_path" ]; then
    echo "BAR_BACKUP_USB_PATH=$usb_path" >> "$ENV_FILE"
    ok "pendrive registrado em $ENV_FILE"
  fi
}

ensure_secrets() {
  step "Segredos (PIN e sessão)"

  if [ -f "$ENV_FILE" ]; then
    ok "arquivo de segredos já existe em $ENV_FILE — deixando como está."
    ok "(re-rodar o instalador nunca troca um PIN que já funciona; apague o arquivo manualmente se quiser trocar o PIN)"
    ensure_usb_config_update_only
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] pediria o PIN do bar duas vezes, sem eco na tela"
    info "[dry-run] derivaria BAR_PIN_HASH com scripts/lib/scrypt-hash.mjs"
    info "[dry-run] geraria BAR_SESSION_SECRET aleatório (32 bytes) com node:crypto"
    info "[dry-run] perguntaria o caminho do pendrive de backup"
    info "[dry-run] escreveria tudo em $ENV_FILE com permissão 600"
    return 0
  fi

  local pin="" pin_confirm=""
  if [ -n "${MOTOCLUB_INSTALL_PIN:-}" ]; then
    pin="$MOTOCLUB_INSTALL_PIN"
    pin_confirm="${MOTOCLUB_INSTALL_PIN_CONFIRM:-$MOTOCLUB_INSTALL_PIN}"
    if [ "$pin" != "$pin_confirm" ] || [ "${#pin}" -lt 4 ]; then
      fail "PIN de teste inválido (MOTOCLUB_INSTALL_PIN/_CONFIRM)"
      exit 1
    fi
  else
    while true; do
      # Sem terminal interativo, `read` retorna erro em EOF; com `set -e`
      # isso mataria o script em silêncio se não fosse tratado aqui.
      if ! read -r -s -p "Cadastre o PIN do bar (mínimo 4 dígitos): " pin; then
        echo
        fail "não consegui ler o PIN — isto precisa de um terminal interativo."
        exit 1
      fi
      echo
      if ! read -r -s -p "Confirme o PIN: " pin_confirm; then
        echo
        fail "não consegui ler a confirmação do PIN — isto precisa de um terminal interativo."
        exit 1
      fi
      echo
      if [ "$pin" != "$pin_confirm" ]; then
        fail "os PINs digitados são diferentes — tente de novo."
        continue
      fi
      if [ "${#pin}" -lt 4 ]; then
        fail "PIN muito curto (mínimo 4 dígitos) — tente de novo."
        continue
      fi
      break
    done
  fi

  local pin_hash session_secret
  pin_hash="$(printf '%s' "$pin" | "$NODE_LINK/bin/node" --no-warnings "$SCRIPT_DIR/lib/scrypt-hash.mjs" hash)"
  session_secret="$("$NODE_LINK/bin/node" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  pin=""
  pin_confirm=""

  local usb_path
  usb_path="$(prompt_usb_path)"

  {
    echo "BAR_PIN_HASH=$pin_hash"
    echo "BAR_SESSION_SECRET=$session_secret"
    if [ -n "$usb_path" ]; then
      echo "BAR_BACKUP_USB_PATH=$usb_path"
    fi
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "segredos gerados e gravados em $ENV_FILE (permissão 600)"
}

# --- Fase 5: fuso horário -------------------------------------------------------

ensure_timezone() {
  step "Fuso horário"
  local current=""
  if command -v timedatectl >/dev/null 2>&1; then
    current="$(timedatectl show --property=Timezone --value 2>/dev/null || true)"
  fi

  if [ "$current" = "America/Sao_Paulo" ]; then
    ok "fuso horário já é America/Sao_Paulo"
    return 0
  fi

  info "fuso horário atual: ${current:-desconhecido}. Precisa ser America/Sao_Paulo:"
  info "o fechamento do mês usa hora local, e um fuso errado aqui atribui lançamentos ao mês errado, sem avisar."

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] rodaria: sudo timedatectl set-timezone America/Sao_Paulo"
    return 0
  fi

  if ! command -v timedatectl >/dev/null 2>&1; then
    fail "timedatectl não encontrado — ajuste o fuso manualmente (Configurações > Data e Hora) para America/Sao_Paulo."
    return 0
  fi

  ensure_sudo
  sudo timedatectl set-timezone America/Sao_Paulo
  ok "fuso horário ajustado para America/Sao_Paulo"
}

# --- Fase 6: unidades systemd de usuário ------------------------------------------

ensure_systemd_units() {
  step "Serviço systemd (usuário)"

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] copiaria deploy/*.service e deploy/*.timer para $SYSTEMD_USER_DIR"
    info "[dry-run] rodaria: systemctl --user daemon-reload"
    info "[dry-run] rodaria: systemctl --user enable --now $SERVICE_UNIT"
    info "[dry-run] rodaria: systemctl --user enable --now $BACKUP_TIMER_UNIT"
    info "[dry-run] rodaria: systemctl --user start $BACKUP_SERVICE_UNIT (gera já o primeiro backup, como prova)"
    info "[dry-run] pediria sudo para: loginctl enable-linger \$USER (sem isso, o serviço só sobe depois de um login gráfico)"
    return 0
  fi

  mkdir -p "$SYSTEMD_USER_DIR"
  cp "$REPO_ROOT/deploy/motoclub.service" "$SYSTEMD_USER_DIR/"
  cp "$REPO_ROOT/deploy/motoclub-backup.service" "$SYSTEMD_USER_DIR/"
  cp "$REPO_ROOT/deploy/motoclub-backup.timer" "$SYSTEMD_USER_DIR/"
  ok "unidades copiadas para $SYSTEMD_USER_DIR"

  if [ "${MOTOCLUB_SKIP_SYSTEMCTL:-0}" -eq 1 ]; then
    warn "MOTOCLUB_SKIP_SYSTEMCTL=1 — pulando systemctl/loginctl de verdade (só para teste deste script)"
    return 0
  fi

  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_UNIT"
  ok "$SERVICE_UNIT habilitado e iniciado"

  systemctl --user enable --now "$BACKUP_TIMER_UNIT"
  ok "$BACKUP_TIMER_UNIT habilitado (dispara todo dia às 04:00, mesmo se a máquina estava desligada na hora)"

  info "Gerando o primeiro backup agora, para provar que a cadeia inteira funciona..."
  if systemctl --user start "$BACKUP_SERVICE_UNIT"; then
    ok "primeiro backup gerado com sucesso"
  else
    fail "o primeiro backup falhou — rode 'journalctl --user -u $BACKUP_SERVICE_UNIT' para ver o motivo."
  fi

  ensure_sudo
  sudo loginctl enable-linger "$USER"
  ok "linger habilitado para $USER — o serviço agora sobe no boot mesmo sem ninguém logar na tela"
}

# --- Fase 7: energia (sono e tampa) -----------------------------------------------

XFCE_POWER_PROPS=(
  "/xfce4-power-manager/lid-action-on-ac:int:0"
  "/xfce4-power-manager/lid-action-on-battery:int:0"
  "/xfce4-power-manager/dpms-on-ac-sleep:int:0"
  "/xfce4-power-manager/dpms-on-ac-off:int:0"
  "/xfce4-power-manager/dpms-on-battery-sleep:int:0"
  "/xfce4-power-manager/dpms-on-battery-off:int:0"
  "/xfce4-power-manager/blank-on-ac:int:0"
  "/xfce4-power-manager/blank-on-battery:int:0"
)

ensure_xfce_power_settings() {
  if ! command -v xfconf-query >/dev/null 2>&1; then
    warn "xfconf-query não encontrado (esta sessão não parece ser XFCE)."
    warn "Ajuste manualmente em Configurações > Gerenciador de Energia: nunca suspender, nunca apagar a tela, e 'ao fechar a tampa: nada fazer'."
    return 0
  fi

  for entry in "${XFCE_POWER_PROPS[@]}"; do
    local prop="${entry%%:*}"
    local rest="${entry#*:}"
    local type="${rest%%:*}"
    local value="${rest#*:}"
    if [ "$DRY_RUN" -eq 1 ]; then
      info "[dry-run] xfconf-query -c xfce4-power-manager -p $prop -n -t $type -s $value"
      continue
    fi
    if ! xfconf-query -c xfce4-power-manager -p "$prop" -n -t "$type" -s "$value" 2>/dev/null; then
      warn "não consegui ajustar $prop via xfconf-query — confira manualmente no Gerenciador de Energia."
    fi
  done
  [ "$DRY_RUN" -eq 1 ] || ok "ajustes de energia do XFCE aplicados (tela nunca apaga/suspende; tampa fechada não faz nada)"
}

ensure_logind_settings() {
  local dropin="$LOGIND_DROPIN_DIR/motoclub.conf"
  local content
  content=$'[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchDocked=ignore\nHandleLidSwitchExternalPower=ignore\nIdleAction=ignore\n'

  # "$(cat ...)" descarta a quebra de linha final — comparamos contra
  # $content sem a sua própria quebra final, senão esta checagem de
  # idempotência nunca bateria e o arquivo seria reescrito toda vez.
  if [ -f "$dropin" ] && [ "$(cat "$dropin" 2>/dev/null || true)" = "${content%$'\n'}" ]; then
    ok "configuração do logind já está correta em $dropin"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] escreveria $dropin com:"
    info "[dry-run]   HandleLidSwitch=ignore / HandleLidSwitchDocked=ignore / HandleLidSwitchExternalPower=ignore / IdleAction=ignore"
    info "[dry-run] isso impede a suspensão no nível do systemd-logind, que é o que a sessão gráfica do XFCE por si só não cobre."
    return 0
  fi

  local sudo_prefix=()
  if needs_sudo_for "$LOGIND_DROPIN_DIR"; then
    ensure_sudo
    sudo_prefix=(sudo)
  fi
  "${sudo_prefix[@]}" mkdir -p "$LOGIND_DROPIN_DIR"
  if [ "${#sudo_prefix[@]}" -eq 0 ]; then
    printf '%s' "$content" > "$dropin"
  else
    printf '%s' "$content" | sudo tee "$dropin" >/dev/null
  fi
  ok "gravado $dropin"
  ok "vale a partir do próximo reinício — antes do primeiro evento real, reinicie o notebook uma vez para garantir."
}

ensure_power_settings() {
  step "Energia (impedir que o notebook durma)"
  ensure_xfce_power_settings
  ensure_logind_settings
}

# --- main ------------------------------------------------------------------------

main() {
  check_preconditions
  ensure_node
  ensure_directories
  ensure_secrets
  ensure_timezone
  ensure_systemd_units
  ensure_power_settings

  step "Diagnóstico final"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "(instalação em modo --dry-run: nada foi alterado. O diagnóstico abaixo reflete o estado ATUAL da máquina, não o estado que a instalação de verdade deixaria.)"
    say ""
  fi

  local doctor_status=0
  bash "$SCRIPT_DIR/doctor.sh" || doctor_status=$?

  echo
  if [ "$doctor_status" -eq 0 ]; then
    say "Instalação concluída: o diagnóstico confirma que está tudo certo."
  else
    say "Instalação rodou até o fim, mas o diagnóstico encontrou pendências (veja acima)."
    say "Resolva o que estiver marcado como FALHOU e rode 'scripts/doctor.sh' de novo para confirmar."
  fi
  exit "$doctor_status"
}

main "$@"
