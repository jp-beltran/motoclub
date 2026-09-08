#!/usr/bin/env bash
# scripts/publish-producao.sh — monta e publica a branch `producao`.
#
# Por que esta branch existe: o notebook do bar é um Dell Inspiron 3135
# (APU AMD A6-1450, 8 W). Ele não compila — `tsc -b && vite build` nessa
# CPU é questão de minutos e de RAM. Então o build acontece AQUI, na
# máquina de desenvolvimento, e o notebook recebe artefato pronto por
# `git pull`. Versionar build normalmente é má prática; aqui é o certo,
# porque a máquina alvo não pode compilar e não há CI no meio.
#
# O que a branch `producao` contém: todo o código-fonte da branch de
# origem MAIS `dist/` e `server/dist/server.mjs` commitados (eles são
# ignorados no .gitignore, então entram com `git add -f`).
#
# Cada publicação é um commit NOVO em cima da `producao` anterior — nunca
# um force-push. Isso é deliberado: garante que no notebook o `git pull`
# seja sempre fast-forward, que é o único comando que o operador precisa
# saber. Um force-push aqui transformaria o `git pull` de lá em erro de
# non-fast-forward.
#
# Uso:
#   scripts/publish-producao.sh                 monta a branch local, NÃO publica
#   scripts/publish-producao.sh --push          monta e publica em origin/producao
#   scripts/publish-producao.sh --no-gates      pula os testes (só para iterar)
#   scripts/publish-producao.sh --source=<ref>  branch/commit de origem (padrão: HEAD atual)
#
# No notebook, depois disto:
#   git pull && systemctl --user restart motoclub
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PUSH=0
GATES=1
SOURCE_REF=""
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    --no-gates) GATES=0 ;;
    --source=*) SOURCE_REF="${arg#--source=}" ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

passo() { printf '\n== %s ==\n' "$1"; }
ok()    { printf '  OK  %s\n' "$1"; }
falha() { printf '  FALHOU  %s\n' "$1" >&2; exit 1; }

# --- 1. o estado tem de ser limpo -------------------------------------------
passo "Conferindo o estado do repositório"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no | sed 's/^/    /' >&2
  falha "há alterações não commitadas. Publique a partir de um estado limpo, senão o artefato não corresponde a nenhum commit."
fi
ok "árvore limpa"

[ -n "$SOURCE_REF" ] || SOURCE_REF="$(git rev-parse --abbrev-ref HEAD)"
SOURCE_SHA="$(git rev-parse "$SOURCE_REF")" || falha "ref de origem inválida: $SOURCE_REF"
ok "origem: $SOURCE_REF ($(git rev-parse --short "$SOURCE_SHA"))"

# --- 2. portões --------------------------------------------------------------
if [ "$GATES" -eq 1 ]; then
  passo "Portões de qualidade (é o que impede publicar um artefato quebrado)"
  npm run test:run    >/dev/null 2>&1 && ok "testes do app"       || falha "testes do app vermelhos — rode 'npm run test:run' para ver"
  npm run test:server >/dev/null 2>&1 && ok "testes do servidor"  || falha "testes do servidor vermelhos — rode 'npm run test:server'"
  npm run test:scripts>/dev/null 2>&1 && ok "testes dos scripts"  || falha "testes dos scripts vermelhos — rode 'npm run test:scripts'"
  npm run lint        >/dev/null 2>&1 && ok "lint"                || falha "lint vermelho — rode 'npm run lint'"
else
  passo "Portões PULADOS (--no-gates)"
  echo "  AVISO  publicando sem rodar os testes. Use isto só para iterar, nunca para o notebook."
fi

# --- 3. build ----------------------------------------------------------------
passo "Compilando (aqui, porque o notebook não compila)"
rm -rf dist server/dist
npm run build      >/dev/null 2>&1 && ok "front-end + typecheck do servidor" || falha "'npm run build' falhou — rode direto para ver o erro"
npm run build:server >/dev/null 2>&1 && ok "bundle do servidor"              || falha "'npm run build:server' falhou"

[ -f dist/index.html ]            || falha "dist/index.html não foi gerado"
[ -f server/dist/server.mjs ]     || falha "server/dist/server.mjs não foi gerado"
ok "dist/ ($(find dist -type f | wc -l) arquivos, $(du -sh dist | cut -f1)) e server/dist/server.mjs ($(du -h server/dist/server.mjs | cut -f1))"

# --- 4. o bundle SOBE? -------------------------------------------------------
# Sem isto a branch pode publicar um bundle que compila e não executa —
# exatamente a classe de falha que só aparece no notebook, na hora do evento.
passo "Fumaça: o bundle publicado realmente sobe e responde?"
SMOKE_DIR="$(mktemp -d)"
trap 'rm -rf "$SMOKE_DIR"' EXIT
SMOKE_PORT=8798
(
  export BAR_DB_PATH="$SMOKE_DIR/fumaca.sqlite3"
  export BAR_PORT="$SMOKE_PORT"
  export BAR_HOST=127.0.0.1
  export TZ=America/Sao_Paulo
  export BAR_STATIC_DIR="$REPO_ROOT/dist"
  BAR_SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  export BAR_SESSION_SECRET
  BAR_PIN_HASH="$(printf '1234' | node "$SCRIPT_DIR/lib/scrypt-hash.mjs" hash)"
  export BAR_PIN_HASH
  node --no-warnings server/dist/server.mjs >"$SMOKE_DIR/servidor.log" 2>&1 &
  echo $! > "$SMOKE_DIR/pid"
  wait
) &
for _ in $(seq 1 40); do
  [ -f "$SMOKE_DIR/pid" ] && curl -fsS -o /dev/null "http://127.0.0.1:$SMOKE_PORT/" 2>/dev/null && break
  sleep 0.25
done

CODIGO="$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/" 2>/dev/null || echo 000)"
SESSAO="$(curl -fsS -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$SMOKE_PORT/api/session" \
            -H 'Content-Type: application/json' -d '{"pin":"1234"}' 2>/dev/null || echo 000)"
[ -f "$SMOKE_DIR/pid" ] && kill "$(cat "$SMOKE_DIR/pid")" 2>/dev/null || true

[ "$CODIGO" != "000" ] || { sed -n '1,20p' "$SMOKE_DIR/servidor.log" >&2; falha "o bundle não respondeu na porta $SMOKE_PORT"; }
ok "servidor respondeu (HTTP $CODIGO na raiz)"
[ "$SESSAO" = "200" ] || { sed -n '1,20p' "$SMOKE_DIR/servidor.log" >&2; falha "o login com PIN devolveu $SESSAO, esperado 200"; }
ok "login com PIN devolveu 200"

# --- 5. monta a branch num worktree temporário -------------------------------
# Worktree separado de propósito: não mexe na sua árvore de trabalho, e o
# `producao` nunca precisa ficar em checkout aqui.
passo "Montando a branch producao"
PROD_WT="$(mktemp -d)"
trap 'rm -rf "$SMOKE_DIR"; git worktree remove --force "$PROD_WT" 2>/dev/null || rm -rf "$PROD_WT"' EXIT

git fetch origin producao --quiet 2>/dev/null || true
if git rev-parse --verify --quiet refs/heads/producao >/dev/null; then
  git worktree add --quiet "$PROD_WT" producao
  ok "producao local encontrada"
elif git rev-parse --verify --quiet refs/remotes/origin/producao >/dev/null; then
  git worktree add --quiet -b producao "$PROD_WT" origin/producao
  ok "producao criada a partir de origin/producao"
else
  git worktree add --quiet -b producao "$PROD_WT" "$SOURCE_SHA"
  ok "producao criada pela primeira vez, a partir de $SOURCE_REF"
fi

cd "$PROD_WT"

# Traz o código-fonte novo. Nunca conflita: `producao` só ADICIONA os
# artefatos, que não existem na branch de origem.
if ! git merge --no-edit -q "$SOURCE_SHA" 2>/dev/null; then
  git merge --abort 2>/dev/null || true
  cd "$REPO_ROOT"
  falha "o merge de $SOURCE_REF em producao conflitou — resolva à mão e rode de novo"
fi
ok "código-fonte de $SOURCE_REF incorporado"

# Substitui os artefatos por inteiro, para arquivo velho de build anterior
# não ficar pendurado (os nomes em dist/assets têm hash, então sobra fácil).
rm -rf dist server/dist
mkdir -p server
cp -r "$REPO_ROOT/dist" ./dist
cp -r "$REPO_ROOT/server/dist" ./server/dist

cat > producao-info.json <<JSON
{
  "sourceRef": "$SOURCE_REF",
  "sourceCommit": "$SOURCE_SHA",
  "builtAt": "$(TZ=America/Sao_Paulo date --iso-8601=seconds)",
  "builtBy": "$(git config user.name 2>/dev/null || echo desconhecido)",
  "nodeVersion": "$(node --version)",
  "buildTZ": "America/Sao_Paulo"
}
JSON

git add -f dist server/dist producao-info.json
git add -A

if git diff --cached --quiet; then
  cd "$REPO_ROOT"
  passo "Nada a publicar"
  echo "  A producao já está idêntica ao build de $SOURCE_REF ($(git rev-parse --short "$SOURCE_SHA"))."
  exit 0
fi

git commit -q -m "build: artefatos de $(git rev-parse --short "$SOURCE_SHA") para o notebook

Front-end (dist/) e bundle do servidor (server/dist/server.mjs) compilados na
máquina de desenvolvimento. O notebook do bar não compila: ele só faz
'git pull' e 'systemctl --user restart motoclub'.

Origem: $SOURCE_REF @ $SOURCE_SHA
Node do build: $(node --version)"
PROD_SHA="$(git rev-parse --short HEAD)"
ok "commit $PROD_SHA criado na producao"

git ls-files dist server/dist | wc -l | sed 's/^/  arquivos de artefato versionados: /'

cd "$REPO_ROOT"

# --- 6. publicar -------------------------------------------------------------
if [ "$PUSH" -eq 1 ]; then
  passo "Publicando"
  git push origin producao
  ok "origin/producao atualizado"
  printf '\nNo notebook:\n  cd ~/motoclub && git pull && systemctl --user restart motoclub\n\n'
else
  passo "Pronto, NÃO publicado"
  printf '  A branch local producao está em %s.\n  Para publicar:  git push origin producao\n\n' "$PROD_SHA"
fi
