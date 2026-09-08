#!/usr/bin/env bash
# scripts/lib/env-file.sh — leitura e escrita do arquivo de segredos
# (~/.config/motoclub/env), compartilhada por install.sh, doctor.sh e
# restore.sh.
#
# Por que isto existe num lugar só: antes havia três implementações quase
# iguais de "pega o valor desta variável no arquivo", e foi exatamente aí
# que apareceram os bugs de parsing corrigidos na rodada anterior. Uma
# implementação, um teste.
#
# O detalhe que motivou as aspas na escrita — medido, não suposto, em
# systemd 255 (255.4-1ubuntu8.17, a mesma base do Ubuntu 24.04 que o
# Mint 22 usa):
#
#   BAR_PIN_HASH=scrypt$SALT$HASH        (sem aspas)
#     systemd  -> scrypt$SALT$HASH   (literal, correto)
#     shell    -> scrypt             (!!! expandiu $SALT e $HASH como
#                                     variáveis vazias, SEM erro)
#
#   BAR_PIN_HASH='scrypt$SALT$HASH'      (com aspas simples)
#     systemd  -> scrypt$SALT$HASH   (idêntico: o systemd tira as aspas)
#     shell    -> scrypt$SALT$HASH   (correto)
#
# Ou seja: para o serviço as duas formas são equivalentes, então nada muda
# no notebook. Mas quem estiver depurando às 23h e der `source` no arquivo
# recebe, na forma sem aspas, um hash truncado e nenhum aviso — e vai
# concluir que o arquivo está corrompido. As aspas eliminam essa pegadinha.
#
# A leitura aceita AS DUAS formas de propósito: uma instalação que já
# existe tem o arquivo sem aspas e o install.sh nunca o reescreve (para
# não rotacionar um PIN que funciona), então o leitor precisa continuar
# entendendo o formato antigo para sempre.

# env_file_var <arquivo> <variável>
#
# Imprime o valor da variável, sem aspas envolventes e sem nova linha.
# Variável ausente ou arquivo ausente => string vazia, exit 0 (não achar
# não é erro: estes scripts rodam com `set -e`).
#
# Quando a variável aparece mais de uma vez, vale a ÚLTIMA — é a semântica
# do EnvironmentFile do systemd, e o install.sh acrescenta linhas no fim
# (o caminho do pendrive, por exemplo).
env_file_var() {
  local file="$1" var="$2"
  local value=""

  [ -f "$file" ] || { printf '%s' ""; return 0; }

  # `cut -d= -f2-` e não `-f2`: o valor pode conter '=' (um caminho de
  # pendrive com query string, um segredo em base64 com padding).
  value="$(grep -E "^${var}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2-)" || true

  # Tira UMA camada de aspas envolventes, e só se elas casarem nas duas
  # pontas — assim um valor que legitimamente começa com aspas (ou que
  # tem uma aspa no meio) não é mutilado.
  case "$value" in
    \'*\')
      [ "${#value}" -ge 2 ] && value="${value:1:${#value}-2}"
      ;;
    \"*\")
      [ "${#value}" -ge 2 ] && value="${value:1:${#value}-2}"
      ;;
  esac

  printf '%s' "$value"
}

# env_file_line <variável> <valor>
#
# Monta a linha `VAR='valor'` para gravar no arquivo de segredos.
#
# Aspas SIMPLES, e o valor não pode conter apóstrofo. Isso não é
# preguiça: aspas simples sem apóstrofo interno é a ÚNICA forma em que o
# systemd e o shell concordam. Medido em systemd 255, com o mesmo arquivo
# lido pelos dois:
#
#   A='o'\''reilly'      (o idioma de escape do shell)
#     systemd -> o''reilly'      shell -> o'reilly     DISCORDAM
#   B="valor$VAR"        (aspas duplas)
#     systemd -> valor$VAR       shell -> valor        DISCORDAM
#   C='sem apostrofo'    (aspas simples, sem apóstrofo)
#     systemd -> sem apostrofo   shell -> sem apostrofo  IGUAIS
#
# Como não existe escape que sirva aos dois, um valor com apóstrofo é
# RECUSADO em vez de gravado numa forma sobre a qual os dois leitores
# discordam. Um arquivo de segredos que significa duas coisas diferentes
# conforme quem lê é pior do que um erro na hora de instalar.
#
# Devolve 1 e explica no stderr se o valor tem apóstrofo; quem chama
# decide (o install.sh pergunta o caminho de novo).
env_file_line() {
  local var="$1" value="$2"

  case "$value" in
    *\'*)
      echo "env_file_line: o valor de $var contém apóstrofo (') e não pode ir para o arquivo de segredos:" >&2
      echo "  [$value]" >&2
      echo "  systemd e shell leem escapes de apóstrofo de formas diferentes, então o valor ficaria ambíguo." >&2
      echo "  Use um caminho sem apóstrofo (por exemplo, renomeie o diretório)." >&2
      return 1
      ;;
  esac

  printf "%s='%s'" "$var" "$value"
}
