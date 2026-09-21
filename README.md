# motoclub

Sistema do bar do motoclube: lança consumo, controla comanda de visitante e
dívida mensal de integrante, fecha o mês, registra pagamento e movimenta
estoque. Roda inteiro no notebook do clube — servidor Node e banco SQLite na
própria máquina, sem depender de internet.

## Documentação

- [`docs/atalhos.md`](docs/atalhos.md) — atalhos de terminal para operar o
  notebook: ver o estado, gerar e restaurar backup, desfazer pelo histórico,
  atualizar, limpar o banco.

## Operar no notebook

```bash
~/motoclub/scripts/doctor.sh     # diagnóstico: o primeiro comando quando algo parece errado
cd ~/motoclub && git pull        # atualiza (o serviço reinicia sozinho)
```

## Desenvolver

```bash
npm run dev          # front com a API do servidor em proxy
npm run test:run     # testes de app
npm run test:server  # testes do servidor
npm run test:scripts # testes dos scripts de operação
npm run lint
npm run build
npm run e2e          # não rode junto com test:server: os dois recompilam o bundle
```

Publicar para o notebook (só na máquina de desenvolvimento — o notebook nunca
compila):

```bash
bash scripts/publish-producao.sh --push
```
