#!/usr/bin/env bash
# Lista única das propriedades do xfce4-power-manager que o Motoclub ajusta
# para impedir o notebook de dormir. Compartilhada entre install.sh (que
# escreve as oito) e doctor.sh (que precisa reler as MESMAS oito, não só
# uma — reler menos do que se escreveu dá falsa sensação de segurança
# justamente na maior suposição não verificada desta entrega: os nomes de
# propriedade certos para a versão do xfce4-power-manager do Mint 22).
#
# Formato de cada entrada: "<propriedade>:<tipo xfconf>:<valor esperado>"
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

# split_xfce_prop_entry "prop:type:value" -> preenche PROP, PROP_TYPE, PROP_VALUE
# (variáveis globais, de propósito — bash não devolve tuplas; isolado numa
# função para não repetir o parsing em install.sh e doctor.sh).
split_xfce_prop_entry() {
  local entry="$1"
  PROP="${entry%%:*}"
  local rest="${entry#*:}"
  PROP_TYPE="${rest%%:*}"
  PROP_VALUE="${rest#*:}"
}
