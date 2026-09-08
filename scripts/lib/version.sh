#!/usr/bin/env bash
# Funções puras de comparação de versão, usadas pelo install.sh e pelo doctor.sh.
# Sem efeitos colaterais: só leem os argumentos recebidos, nunca o sistema.
# Isso é o que torna possível testar este arquivo sozinho, sem instalar nada.

# version_ge "2.39" "2.28"  -> retorna 0 (verdadeiro) se o primeiro número for
# maior ou igual ao segundo, comparando por partes numéricas (major.minor.patch...).
version_ge() {
  local a="$1" b="$2"
  local -a pa pb
  IFS='.' read -r -a pa <<<"$a"
  IFS='.' read -r -a pb <<<"$b"
  local len=${#pa[@]}
  if [ "${#pb[@]}" -gt "$len" ]; then
    len=${#pb[@]}
  fi
  local i
  for ((i = 0; i < len; i++)); do
    local na="${pa[i]:-0}" nb="${pb[i]:-0}"
    # remove qualquer sufixo não numérico (ex.: "0-rc1"), tratando como 0 se sobrar vazio
    na="${na%%[!0-9]*}"
    nb="${nb%%[!0-9]*}"
    na="${na:-0}"
    nb="${nb:-0}"
    if ((10#$na > 10#$nb)); then
      return 0
    elif ((10#$na < 10#$nb)); then
      return 1
    fi
  done
  return 0
}

# strip_v "v22.11.0" -> "22.11.0"
strip_v() {
  local v="$1"
  echo "${v#v}"
}

# node_major "22.11.0" -> "22"
node_major() {
  local v
  v="$(strip_v "$1")"
  echo "${v%%.*}"
}

# node_version_ok CURRENT REQUIRED_MAJOR
# Verdadeiro se CURRENT existir e tiver major >= REQUIRED_MAJOR.
node_version_ok() {
  local current="$1" required_major="$2"
  if [ -z "$current" ]; then
    return 1
  fi
  local major
  major="$(node_major "$current")"
  [ "$major" -ge "$required_major" ]
}

# parse_glibc_version "ldd (Ubuntu GLIBC 2.39-0ubuntu8.3) 2.39" -> "2.39"
parse_glibc_version() {
  local line="$1"
  echo "$line" | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | tail -1
}

# node_version_ge CURRENT REQUIRED  (comparação pontuada completa, não só o
# major). Ex.: node_version_ge "v22.11.0" "22.5.0" -> verdadeiro.
# Existe porque "major >= 22" não basta para tudo: node:sqlite só existe a
# partir do Node 22.5, e node_version_ok (acima) não enxerga isso.
node_version_ge() {
  local current="$1" required="$2"
  if [ -z "$current" ]; then
    return 1
  fi
  version_ge "$(strip_v "$current")" "$required"
}
