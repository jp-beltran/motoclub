#!/usr/bin/env node
// scripts/limpar-banco.mjs — deixa o banco do bar VAZIO, para começar a
// operação com os dados reais do clube em vez dos de demonstração.
//
// Por que um script e não "apagar o arquivo": apagar não resolve. Quando o
// armazenamento está vazio, o repositório GRAVA a demonstração de volta
// (`LocalBarRepository.load`), então o banco renasce com Ana Paula, Bruno e
// as cervejas de exemplo. Para ficar vazio é preciso ESCREVER um banco vazio.
//
// O vazio é derivado do próprio banco: lemos o documento guardado e
// substituímos cada coleção por uma lista vazia. Assim nenhuma lista de
// coleções é repetida aqui — se o modelo ganhar uma coleção nova amanhã,
// este script continua certo sem ninguém lembrar dele.
//
// Uso:
//   node scripts/limpar-banco.mjs               pede confirmação
//   node scripts/limpar-banco.mjs --sim         sem perguntar (só para automação)
//   node scripts/limpar-banco.mjs --db <caminho>
//
// Antes de escrever, ele SEMPRE guarda uma cópia do banco atual ao lado,
// com a data no nome. Limpar é irreversível para quem não tem a cópia.
import { carregarSqlite } from './lib/node-sqlite.mjs'
import { createInterface } from 'node:readline/promises'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// Carregado assim, e não por `import`, para o script poder se reexecutar
// no Node de /opt/node quando o do PATH não tiver node:sqlite.
const { DatabaseSync } = await carregarSqlite()

const CHAVE = 'motoclub:bar-database'

function parseArgs(argv) {
  let db
  let sim = false
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--db') db = argv[(i += 1)]
    else if (a === '--sim' || a === '--yes') sim = true
    else if (a === '-h' || a === '--help') return { ajuda: true }
    else {
      console.error(`ERRO: argumento desconhecido: ${a}`)
      process.exit(2)
    }
  }
  return { db, sim }
}

function resolverBanco(override) {
  if (override) return override
  if (process.env.BAR_DB_PATH) return process.env.BAR_DB_PATH
  const home = process.env.HOME ?? homedir()
  const envFile = process.env.MOTOCLUB_ENV_FILE ?? path.join(home, '.config', 'motoclub', 'env')
  if (existsSync(envFile)) {
    // Mesma convenção de leitura do restore.sh/doctor.sh: extração de texto,
    // nunca `source` — o arquivo tem valores com '$' que um shell expandiria.
    const linha = readFileSync(envFile, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('BAR_DB_PATH='))
      .pop()
    if (linha) {
      const bruto = linha.slice('BAR_DB_PATH='.length).trim()
      const semAspas = /^(['"]).*\1$/.test(bruto) ? bruto.slice(1, -1) : bruto
      if (semAspas) return semAspas
    }
  }
  return path.join(home, '.local', 'share', 'motoclub', 'bar.sqlite3')
}

function servicoRodando(dbPath) {
  const lock = `${dbPath}.lock`
  if (!existsSync(lock)) return null
  try {
    const pid = Number(readFileSync(lock, 'utf8').trim().split('\n')[0])
    if (!Number.isInteger(pid) || pid <= 0) return null
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}

function contar(dados) {
  return Object.entries(dados)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}=${v.length}`)
    .join(' · ')
}

async function main() {
  const { ajuda, db, sim } = parseArgs(process.argv.slice(2))
  if (ajuda) {
    console.log(`Uso: node scripts/limpar-banco.mjs [--sim] [--db <caminho>]

Deixa o banco do bar vazio, guardando antes uma cópia do atual ao lado.`)
    return
  }

  const dbPath = resolverBanco(db)
  if (!existsSync(dbPath)) {
    console.error(`ERRO: banco não encontrado em ${dbPath}`)
    console.error('Se o serviço nunca subiu, não há o que limpar.')
    process.exit(1)
  }

  const pid = servicoRodando(dbPath)
  if (pid) {
    console.error(`ERRO: o serviço parece estar rodando (pid ${pid}).`)
    console.error("Pare primeiro:  systemctl --user stop motoclub")
    console.error('Limpar com o servidor no ar deixaria ele escrevendo por cima.')
    process.exit(1)
  }

  const conexao = new DatabaseSync(dbPath)
  const linha = conexao.prepare('SELECT value FROM kv WHERE key = ?').get(CHAVE)
  if (!linha?.value) {
    console.error(`ERRO: não achei o documento '${CHAVE}' neste banco.`)
    conexao.close()
    process.exit(1)
  }

  let envelope
  try {
    envelope = JSON.parse(String(linha.value))
  } catch {
    console.error('ERRO: o documento guardado não é JSON válido — não vou escrever por cima.')
    conexao.close()
    process.exit(1)
  }
  if (!envelope || typeof envelope.data !== 'object' || envelope.data === null) {
    console.error('ERRO: o documento não tem o formato esperado ({version, data}).')
    conexao.close()
    process.exit(1)
  }

  console.log(`Banco:  ${dbPath}`)
  console.log(`Hoje:   ${contar(envelope.data)}`)

  // O vazio derivado: toda coleção vira lista vazia, e nada mais é tocado.
  const vazio = Object.fromEntries(
    Object.entries(envelope.data).map(([k, v]) => [k, Array.isArray(v) ? [] : v]),
  )
  console.log(`Depois: ${contar(vazio)}`)
  console.log()

  if (!sim) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const resposta = await rl.question(
      'Isso APAGA todos os dados do bar neste computador. Uma cópia do banco atual será guardada ao lado. Confirma? [s/N] ',
    )
    rl.close()
    if (!/^s(im)?$/i.test(resposta.trim())) {
      console.log('Cancelado. Nada foi alterado.')
      conexao.close()
      return
    }
  }

  const carimbo = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const copia = `${dbPath}.antes-de-limpar-${carimbo}`
  conexao.close()
  copyFileSync(dbPath, copia)
  console.log(`Cópia do banco atual: ${copia}`)

  const escrita = new DatabaseSync(dbPath)
  escrita
    .prepare(
      'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .run(CHAVE, JSON.stringify({ ...envelope, data: vazio }), new Date().toISOString())
  escrita.close()

  console.log()
  console.log('✓ banco vazio. Suba o serviço e cadastre os dados do clube:')
  console.log('    systemctl --user start motoclub')
  console.log('    depois, em /consumidores, /itens e /comandas')
}

main().catch((erro) => {
  console.error(`ERRO: ${erro?.message ?? erro}`)
  process.exit(1)
})
