# Atalhos para o notebook do bar

Os comandos de operação são longos e moram em caminhos que ninguém decora:
`/opt/node/bin/node ~/motoclub/scripts/limpar-banco.mjs` não é coisa que se
digite às onze da noite com o balcão cheio. Este documento cria nomes curtos
para cada um.

São para o **notebook do clube**. A última seção é da máquina de
desenvolvimento, e não deve ir para o notebook.

## Instalar

Cole o bloco inteiro no terminal do notebook, uma vez só:

```bash
cat >> ~/.bashrc <<'ATALHOS'

# ─── Motoclub ────────────────────────────────────────────────────────────────
# Caminhos absolutos de propósito: estes atalhos precisam funcionar de
# qualquer pasta, e o Linux Mint não traz `node` — quem instala um Node
# adequado é o scripts/install.sh, em /opt/node.
MOTOCLUB_DIR="$HOME/motoclub"
MOTOCLUB_NODE="/opt/node/bin/node"

# Dia a dia
alias bar-abrir='xdg-open http://127.0.0.1:8787'
alias bar-estado='"$MOTOCLUB_DIR/scripts/doctor.sh"'
alias bar-reiniciar='systemctl --user restart motoclub'
alias bar-parar='systemctl --user stop motoclub'
alias bar-subir='systemctl --user start motoclub'
alias bar-log='journalctl --user -u motoclub -n 50 -f'

# Backup
alias bar-backup='systemctl --user start motoclub-backup.service'
alias bar-backups='ls -lht ~/Backups/motoclub/'
alias bar-restaurar='"$MOTOCLUB_DIR/scripts/restore.sh"'

# Histórico de versões (desfazer um toque errado)
alias bar-historico='"$MOTOCLUB_NODE" "$MOTOCLUB_DIR/scripts/history.mjs"'

# Atualizar (o hook post-merge reinicia o serviço sozinho)
alias bar-atualizar='git -C "$MOTOCLUB_DIR" pull'

# Limpar o banco. É função, e não alias, porque são três passos e o
# serviço TEM de voltar mesmo se a limpeza falhar no meio.
bar-limpar() {
  systemctl --user stop motoclub || return 1
  "$MOTOCLUB_NODE" "$MOTOCLUB_DIR/scripts/limpar-banco.mjs" "$@"
  local resultado=$?
  systemctl --user start motoclub
  return $resultado
}
# ─────────────────────────────────────────────────────────────────────────────
ATALHOS

source ~/.bashrc
```

O `source` no fim faz valerem já nesta janela. Em terminais novos eles
carregam sozinhos.

## O que cada um faz

| Atalho | O que faz |
|---|---|
| `bar-abrir` | Abre o sistema no navegador (`127.0.0.1:8787`) |
| `bar-estado` | **O primeiro comando quando algo parece errado.** Diagnóstico completo: Node, segredos, banco, serviço, backup, energia, pendrive — e o que fazer em cada linha que reprova |
| `bar-reiniciar` | Reinicia o serviço |
| `bar-parar` / `bar-subir` | Para e sobe o serviço |
| `bar-log` | Mostra o que o serviço está registrando, ao vivo (`Ctrl+C` sai) |
| `bar-backup` | Gera um backup **agora**, sem esperar as 04:00 |
| `bar-backups` | Lista os backups, do mais novo para o mais velho |
| `bar-restaurar` | Restaura um backup. Interativo: lista, você escolhe, ele confere a integridade **antes** de tocar em qualquer coisa |
| `bar-historico` | Histórico de versões do banco. Use `bar-historico list`, `bar-historico diff 3`, `bar-historico restore 3` |
| `bar-atualizar` | Puxa a versão nova e o serviço reinicia sozinho |
| `bar-limpar` | **Apaga todos os dados do bar.** Para e sobe o serviço em volta da limpeza |

## Os dois que apagam coisa

Só dois atalhos destroem dado, e os dois pedem confirmação antes:

**`bar-limpar`** zera o bar inteiro. Serve para tirar os dados de
demonstração antes de começar a operar de verdade. Ele guarda uma cópia do
banco atual ao lado antes de escrever, e só age depois de você responder `s`.

**`bar-restaurar`** troca o banco atual pelo de um backup. Também preserva o
banco de antes, num arquivo com `antes-da-restauracao` no nome — dá para
voltar atrás se você escolher o backup errado.

Nenhum dos dois roda com o serviço no ar. O `bar-limpar` cuida disso sozinho;
o `bar-restaurar` para e sobe o serviço como parte do trabalho dele.

## Por que caminho absoluto, e por que `/opt/node`

Os atalhos usam `"$MOTOCLUB_DIR/scripts/..."` em vez de caminho relativo
porque você vai chamá-los de qualquer pasta — inclusive de dentro de `~`, onde
`scripts/` não existe.

E usam `/opt/node/bin/node` em vez de `node` por um motivo medido no Mint: **o
Linux Mint não traz Node nenhum**. Quem instala é o `scripts/install.sh`, em
`/opt/node`. Um atalho que chamasse `node` falharia com "command not found" —
ou, pior, pegaria algum Node antigo que alguém instalou depois e que não tem o
módulo `node:sqlite` que o banco usa.

## Quando um atalho não funcionar

Se algum deles reclamar, o primeiro passo é sempre:

```bash
bar-estado
```

Ele foi escrito para dizer, em cada linha que reprova, o comando exato que
resolve. Se ele disser que `/opt/node` não existe, rode
`~/motoclub/scripts/install.sh` — o instalador é idempotente e não troca um PIN
que já funciona.

## Na máquina de desenvolvimento (não no notebook)

O `publish-producao.sh` compila e publica os artefatos que o notebook consome.
Ele **não** roda no notebook — aquela máquina nunca compila nada.

```bash
cat >> ~/.bashrc <<'ATALHOS'

# ─── Motoclub (desenvolvimento) ──────────────────────────────────────────────
MOTOCLUB_REPO="$HOME/Desktop/Motoclub"
alias bar-publicar='bash "$MOTOCLUB_REPO/scripts/publish-producao.sh" --push'
alias bar-publicar-teste='bash "$MOTOCLUB_REPO/scripts/publish-producao.sh"'
# ─────────────────────────────────────────────────────────────────────────────
ATALHOS
```

`bar-publicar-teste` faz tudo menos publicar: roda os testes, compila, sobe o
bundle recém-compilado e faz login por HTTP para provar que ele executa, e
monta a branch local. Serve para ver se a publicação passaria, sem publicar.

Ajuste `MOTOCLUB_REPO` se o seu repositório estiver em outro lugar.
