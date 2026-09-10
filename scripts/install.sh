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
# shellcheck source=lib/env-file.sh
source "$SCRIPT_DIR/lib/env-file.sh"

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
# node:sqlite só existe a partir do Node 22.5 — major>=22 sozinho não
# basta (um Node 22.0-22.4 passaria no major mas não teria o driver que
# o servidor e estes scripts precisam).
NODE_MIN_VERSION="22.5.0"
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

  # Medido no alvo: o Linux Mint 22.3 XFCE não traz git instalado.
  # Aviso e não falha, de propósito — se você chegou até aqui os artefatos
  # existem, então a instalação pode terminar e o bar pode operar. O que
  # não funciona sem git é a ATUALIZAÇÃO, e é justamente o que este
  # script e o doctor.sh mandam fazer ("git pull na branch de produção").
  # Descobrir isso agora, na instalação calma, é muito melhor que
  # descobrir na noite em que uma correção precisa chegar.
  if ! command -v git >/dev/null 2>&1; then
    warn "git não está instalado — a instalação continua, mas não haverá como ATUALIZAR este sistema depois."
    warn "Resolva com: sudo apt-get install -y git"
  else
    ok "git presente ($(git --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)) — o caminho de atualização por 'git pull' existe"
  fi
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
  if node_version_ge "$current" "$NODE_MIN_VERSION"; then
    ok "Node $current já está pronto em $NODE_LINK/bin/node (>= $NODE_MIN_VERSION) — nada a fazer"
    return 0
  fi

  if [ -n "$current" ]; then
    info "Node em $NODE_LINK é $current, mais antigo que o exigido (>= $NODE_MIN_VERSION; node:sqlite só existe a partir daí) — vou instalar uma versão nova ao lado"
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
  # EXIT, não RETURN: os dois "exit 1" abaixo (hash ausente, SHA256 não
  # confere) terminam o script inteiro, e um trap RETURN só dispara em
  # `return`/fim de função — nesses dois casos ele nunca dispararia,
  # deixando o tarball baixado (até ~50 MB) esquecido em /tmp para sempre.
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp_dir'" EXIT

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

  # Defesa extra (o "ensure_node" só chega até aqui quando $current já
  # falhou node_version_ge, então install_dir nunca deveria ser a versão
  # hoje ativa — mas se por algum motivo for, recusar em vez de apagar a
  # versão em uso é o comportamento seguro).
  local active_target=""
  if [ -L "$NODE_LINK" ]; then
    active_target="$(readlink -f "$NODE_LINK" 2>/dev/null || true)"
  fi
  if [ -d "$install_dir" ] && [ -n "$active_target" ] && [ "$install_dir" = "$active_target" ]; then
    fail "'$install_dir' é a instalação ATIVA do Node — recusando removê-la. Algo está inconsistente; investigue manualmente antes de rodar de novo."
    exit 1
  fi

  info "Extraindo em $install_dir..."
  "${sudo_prefix[@]}" mkdir -p "$NODE_INSTALL_ROOT"
  "${sudo_prefix[@]}" tar -xJf "$tmp_dir/$tarball" -C "$NODE_INSTALL_ROOT"
  # rm-antes-do-mv só alcança um diretório de tentativa anterior incompleta
  # com este MESMO nome de versão (nunca a versão ativa — checado acima);
  # o link em si só é trocado no fim, depois que o mv já colocou os
  # arquivos novos no lugar certo.
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

  # Apóstrofo no caminho é barrado aqui, na entrada, e não lá na
  # escrita: systemd e shell leem escapes de apóstrofo de formas
  # diferentes (medido — ver lib/env-file.sh), então o arquivo de
  # segredos passaria a significar duas coisas conforme quem lê.
  case "$path" in
    *\'*)
      fail "o caminho '$path' contém apóstrofo, que não pode ir para o arquivo de segredos. Renomeie o diretório (ou monte o pendrive em outro ponto) e rode o instalador de novo. Pulando o pendrive por enquanto."
      printf ''
      return 0
      ;;
  esac

  # ">&2" aqui não é opcional: esta função devolve o caminho escrevendo em
  # stdout (é assim que os dois chamadores capturam com "$(...)"), e "ok"
  # também escreve em stdout por padrão. Sem o redirecionamento, a saída
  # combinada ("  OK  pendrive...\n/media/x") vira o valor capturado —
  # BAR_BACKUP_USB_PATH grava essa string inteira, quebrada, no arquivo de
  # segredos, e o pendrive nunca funciona de verdade (ver o teste que
  # exercita exatamente isto, scripts/test/install-lib.test.sh).
  ok "pendrive verificado e gravável em $path" >&2
  printf '%s' "$path"
}

ensure_usb_config_update_only() {
  local existing
  existing="$(env_file_var "$ENV_FILE" BAR_BACKUP_USB_PATH)"
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
    # env_file_line recusa valor com apóstrofo (systemd e shell leem
    # escapes de apóstrofo de formas diferentes). prompt_usb_path já
    # barra isso na entrada; aqui é a segunda tranca, para não escrever
    # no arquivo de segredos algo ambíguo se um caminho vier por
    # MOTOCLUB_INSTALL_USB_PATH.
    if ! env_file_line BAR_BACKUP_USB_PATH "$usb_path" >> "$ENV_FILE"; then
      warn "pendrive NÃO registrado — o caminho contém apóstrofo. Os backups vão existir só no HD interno."
      return 0
    fi
    printf '\n' >> "$ENV_FILE"
    ok "pendrive registrado em $ENV_FILE"
  fi
}

# "mínimo 4 dígitos" tem que exigir dígitos de verdade — checar só o
# comprimento aceitaria "abcd" como PIN válido, o que contradiz a própria
# mensagem mostrada ao operador.
is_valid_pin() {
  [[ "$1" =~ ^[0-9]{4,}$ ]]
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
    if [ "$pin" != "$pin_confirm" ] || ! is_valid_pin "$pin"; then
      fail "PIN de teste inválido (MOTOCLUB_INSTALL_PIN/_CONFIRM) — precisa ser só dígitos, mínimo 4"
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
      if ! is_valid_pin "$pin"; then
        fail "PIN inválido — precisa ser só dígitos, mínimo 4 (tente de novo)."
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

  # Valores entre aspas simples: é a única forma em que o systemd
  # (EnvironmentFile) e o shell (`source`, quando alguém for depurar)
  # leem exatamente o mesmo valor. Ver o cabeçalho de lib/env-file.sh
  # para a medição.
  {
    env_file_line BAR_PIN_HASH "$pin_hash"; printf '\n'
    env_file_line BAR_SESSION_SECRET "$session_secret"; printf '\n'
    if [ -n "$usb_path" ]; then
      if env_file_line BAR_BACKUP_USB_PATH "$usb_path"; then
        printf '\n'
      fi
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
  if sudo timedatectl set-timezone America/Sao_Paulo; then
    ok "fuso horário ajustado para America/Sao_Paulo"
  else
    fail "não consegui ajustar o fuso — rode manualmente: sudo timedatectl set-timezone America/Sao_Paulo"
  fi
}

# --- Fase 6: unidades systemd de usuário ------------------------------------------

# Espera até ~15s que $DB_PATH apareça, depois de subir o serviço. O
# processo entra "ativo" (Type=simple) assim que faz fork/exec — o banco só
# existe quando o servidor de fato abre e cria o arquivo. Sem esta espera,
# disparar o backup logo em seguida pega o banco ainda inexistente numa
# instalação perfeitamente correta, e o instalador terminaria dizendo que a
# cadeia de backup está quebrada quando na verdade só faltou um instante.
wait_for_database() {
  local waited=0
  while [ ! -f "$DB_PATH" ] && [ "$waited" -lt 15 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  [ -f "$DB_PATH" ]
}

ensure_systemd_units() {
  step "Serviço systemd (usuário)"

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] copiaria deploy/*.service e deploy/*.timer para $SYSTEMD_USER_DIR"
    info "[dry-run] rodaria: systemctl --user daemon-reload"
    info "[dry-run] rodaria: systemctl --user enable $SERVICE_UNIT"
    info "[dry-run] rodaria: systemctl --user restart $SERVICE_UNIT"
    info "[dry-run]   (restart, não só 'enable --now': numa reinstalação a unidade já está ativa e"
    info "[dry-run]    'enable --now' não reinicia nada — sem isso, um PIN ou server.mjs novos ficam"
    info "[dry-run]    gravados no disco mas o processo em memória continua rodando os antigos)"
    info "[dry-run] rodaria: systemctl --user enable $BACKUP_TIMER_UNIT"
    info "[dry-run] rodaria: systemctl --user restart $BACKUP_TIMER_UNIT"
    info "[dry-run] esperaria o banco existir (até ~15s) e então rodaria: systemctl --user start $BACKUP_SERVICE_UNIT (gera já o primeiro backup, como prova)"
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

  # Nenhuma chamada systemctl/loginctl abaixo pode abortar o script (por
  # isso todas são "if ... ; then ... else fail ...; fi", nunca uma chamada
  # nua sob `set -e`): se o serviço não sobe, é exatamente isso que
  # scripts/doctor.sh (rodado no fim deste instalador) existe para
  # diagnosticar — abortar aqui pularia esse diagnóstico bem na hora em que
  # ele mais importa, deixando quem instalou sem pista nenhuma.
  if ! systemctl --user daemon-reload; then
    fail "systemctl --user daemon-reload falhou"
  fi

  # "enable" + "restart" (não "enable --now"): "--now" só INICIA se a
  # unidade estiver parada, e não faz nada se ela já estiver ativa. Numa
  # reinstalação a unidade já está ativa (é o caso mais comum: rodar de
  # novo depois de um "git pull" ou para trocar o PIN), e sem reiniciar de
  # verdade, o binário/PIN novos ficam gravados no disco mas o processo em
  # memória continua com os antigos — o efeito só aparece no próximo
  # reboot, de forma imprevisível (possivelmente no meio de um evento).
  if ! systemctl --user enable "$SERVICE_UNIT"; then
    fail "systemctl --user enable $SERVICE_UNIT falhou"
  fi
  if systemctl --user restart "$SERVICE_UNIT"; then
    ok "$SERVICE_UNIT (re)iniciado com a configuração e o binário atuais"
  else
    fail "$SERVICE_UNIT não (re)iniciou — o diagnóstico no fim deste instalador mostra o motivo."
  fi

  if ! systemctl --user enable "$BACKUP_TIMER_UNIT"; then
    fail "systemctl --user enable $BACKUP_TIMER_UNIT falhou"
  fi
  if systemctl --user restart "$BACKUP_TIMER_UNIT"; then
    ok "$BACKUP_TIMER_UNIT habilitado (dispara todo dia às 04:00, mesmo se a máquina estava desligada na hora)"
  else
    fail "$BACKUP_TIMER_UNIT não habilitou/reiniciou."
  fi

  info "Esperando o banco de dados ser criado pelo servidor (até 15s) antes do primeiro backup..."
  if wait_for_database; then
    info "Gerando o primeiro backup agora, para provar que a cadeia inteira funciona..."
    if systemctl --user start "$BACKUP_SERVICE_UNIT"; then
      ok "primeiro backup gerado com sucesso"
    else
      fail "o primeiro backup falhou — rode 'journalctl --user -u $BACKUP_SERVICE_UNIT' para ver o motivo."
    fi
  else
    warn "o banco ainda não existe em $DB_PATH depois de 15s — o servidor pode não ter subido ainda (o diagnóstico abaixo mostra o estado real)."
    warn "pulei o primeiro backup por agora; o timer roda sozinho às 04:00, ou rode 'systemctl --user start $BACKUP_SERVICE_UNIT' depois que o serviço estiver de pé."
  fi

  ensure_sudo
  if sudo loginctl enable-linger "$USER"; then
    ok "linger habilitado para $USER — o serviço agora sobe no boot mesmo sem ninguém logar na tela"
  else
    fail "não consegui habilitar o linger — rode manualmente: sudo loginctl enable-linger $USER"
  fi
}

# --- Fase 7: energia (sono e tampa) -----------------------------------------------

# shellcheck source=lib/xfce-power-props.sh
source "$SCRIPT_DIR/lib/xfce-power-props.sh"

ensure_xfce_power_settings() {
  if ! command -v xfconf-query >/dev/null 2>&1; then
    warn "xfconf-query não encontrado (esta sessão não parece ser XFCE)."
    warn "Ajuste manualmente em Configurações > Gerenciador de Energia: nunca suspender, nunca apagar a tela, e 'ao fechar a tampa: nada fazer'."
    return 0
  fi

  for entry in "${XFCE_POWER_PROPS[@]}"; do
    split_xfce_prop_entry "$entry"
    if [ "$DRY_RUN" -eq 1 ]; then
      info "[dry-run] xfconf-query -c xfce4-power-manager -p $PROP -n -t $PROP_TYPE -s $PROP_VALUE"
      continue
    fi
    if ! xfconf-query -c xfce4-power-manager -p "$PROP" -n -t "$PROP_TYPE" -s "$PROP_VALUE" 2>/dev/null; then
      warn "não consegui ajustar $PROP via xfconf-query — confira manualmente no Gerenciador de Energia."
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
    say "Resolva o que estiver marcado como FALHOU e rode '$SCRIPT_DIR/doctor.sh' de novo para confirmar."
  fi
  exit "$doctor_status"
}

# Só roda main quando o arquivo é EXECUTADO, não quando é `source`ado —
# isso é o que deixa scripts/test/install-lib.test.sh testar funções
# individuais (prompt_usb_path, is_valid_pin, ...) sem disparar a
# instalação inteira.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
