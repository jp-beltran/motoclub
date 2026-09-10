#!/usr/bin/env bash
# Testes da seção "Caminho de atualização (git)" do doctor.sh.
#
# Por que ela existe: medido no alvo, o Linux Mint 22.3 XFCE **não** traz
# git instalado. Tanto o install.sh quanto o doctor.sh dizem ao operador
# "dê git pull na branch de produção" como o jeito de atualizar — sem git
# essa orientação é impossível de seguir, e a pessoa descobre isso na
# noite em que precisa de uma correção. Esta seção transforma esse achado
# numa recusa barulhenta, em vez de uma surpresa.
#
# Uso: bash scripts/test/doctor-update-path.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail=0
total=0

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  total=$((total + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ok - $desc"
  else
    echo "  FALHOU - $desc"
    echo "      esperava encontrar: [$needle]"
    printf '%s\n' "$haystack" | sed 's/^/        /'
    fail=$((fail + 1))
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/motoclub"
mkdir -p "$HOME_DIR/dist" "$HOME_DIR/server/dist" "$HOME_DIR/scripts/lib"
echo '<div id="root"></div>' > "$HOME_DIR/dist/index.html"
echo 'console.log("bundle")' > "$HOME_DIR/server/dist/server.mjs"
cp "$REPO_ROOT/scripts/doctor.sh" "$HOME_DIR/scripts/"
cp "$REPO_ROOT"/scripts/lib/*.sh "$REPO_ROOT"/scripts/lib/*.mjs "$HOME_DIR/scripts/lib/"

secao() {
  MOTOCLUB_HOME_DIR="$HOME_DIR" \
  MOTOCLUB_CONFIG_DIR="$TMP/config" \
  MOTOCLUB_ENV_FILE="$TMP/config/env" \
  BAR_DB_PATH="$TMP/data/bar.sqlite3" \
  BAR_BACKUP_DIR="$TMP/backups" \
  MOTOCLUB_SYSTEMD_USER_DIR="$TMP/systemd" \
  MOTOCLUB_NODE_INSTALL_ROOT="$TMP/node" \
  MOTOCLUB_LOGIND_DROPIN_DIR="$TMP/logind" \
    bash "$HOME_DIR/scripts/doctor.sh" 2>/dev/null \
    | sed -n '/== Caminho de atualização/,/^$/p'
}

git_local() { git -C "$HOME_DIR" -c user.email=t@t -c user.name=teste "$@"; }

echo
echo "sem git no PATH — o caso do Mint recém-instalado"
# PATH mínimo com tudo que o doctor.sh usa, menos git. É a única forma de
# fazer `command -v git` falhar de fora do script.
SEM_GIT="$TMP/bin-sem-git"
mkdir -p "$SEM_GIT"
for c in bash sh sed grep awk stat find cut tr head tail sort date curl ss \
         systemctl loginctl xfconf-query node dpkg-query readlink dirname basename \
         cat ls wc printf env timeout du df id sysctl; do
  for d in /usr/bin /bin /usr/sbin /sbin; do
    [ -x "$d/$c" ] && { ln -sf "$d/$c" "$SEM_GIT/$c"; break; }
  done
done
if PATH="$SEM_GIT" command -v git >/dev/null 2>&1; then
  echo "  ?  pulado: não consegui montar um PATH sem git neste ambiente"
else
  saida="$(PATH="$SEM_GIT" secao)"
  assert_contains "reprova (não é só aviso): sem git não há atualização" \
    "FALHOU   git não está instalado" "$saida"
  assert_contains "diz o comando exato para resolver" "sudo apt-get install -y git" "$saida"
  assert_contains "explica que o Mint não traz git" "o Mint não traz git por padrão" "$saida"
fi

echo
echo "com git, mas a pasta não é um checkout (copiada à mão por pendrive, por exemplo)"
saida="$(secao)"
assert_contains "confirma o git" "OK       git " "$saida"
assert_contains "reprova a pasta sem git" "não é um checkout git" "$saida"
assert_contains "ensina o clone certo" "git clone --branch producao" "$saida"

echo
echo "checkout numa branch que não é producao"
git_local init -q
git_local add -A >/dev/null 2>&1
git_local commit -qm "base" >/dev/null 2>&1
git_local config remote.origin.url "https://github.com/jp-beltran/motoclub.git"
git_local checkout -q -B main
saida="$(secao)"
assert_contains "avisa (sem reprovar) sobre a branch errada" "ATENCAO  o checkout está na branch 'main'" "$saida"
assert_contains "explica que só producao traz artefato" "só a branch 'producao' carrega dist/" "$saida"

echo
echo "checkout na branch producao — o estado esperado no notebook"
git_local checkout -q -B producao
saida="$(secao)"
assert_contains "aprova" "OK       checkout na branch 'producao'" "$saida"
assert_contains "mostra a origem" "github.com/jp-beltran/motoclub.git" "$saida"

echo
echo "HEAD desanexado — 'git pull' não funciona, e a mensagem não pode dizer que a branch se chama HEAD"
git_local checkout -q --detach
saida="$(secao)"
assert_contains "reprova o HEAD desanexado" "não está em nenhuma branch (HEAD desanexado)" "$saida"
total=$((total + 1))
if [[ "$saida" != *"branch 'HEAD'"* ]]; then
  echo "  ok - não chama o estado de \"branch 'HEAD'\" (o erro de usar rev-parse --abbrev-ref)"
else
  echo "  FALHOU - relatou a branch como 'HEAD'; use symbolic-ref, não rev-parse --abbrev-ref"
  fail=$((fail + 1))
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "OK: $total asserções passaram"
  exit 0
fi
echo "FALHOU: $fail de $total asserções"
exit 1
