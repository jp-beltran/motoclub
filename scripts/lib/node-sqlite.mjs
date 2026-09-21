// scripts/lib/node-sqlite.mjs — carrega `node:sqlite` e, se o Node que está
// rodando não tiver o módulo, reexecuta o script no Node certo.
//
// Por que isto existe: os scripts chamados por doctor.sh e restore.sh recebem
// o interpretador já resolvido (`$NODE_BIN`, de `find_node`), porque o Node do
// PATH pode ser velho demais ou nem existir — o Mint não traz Node. Mas
// `limpar-banco.mjs` e `history.mjs` são feitos para o operador rodar na mão,
// e aí ninguém resolve nada: um `node scripts/limpar-banco.mjs` pega o que
// estiver no PATH e morre com `ERR_UNKNOWN_BUILTIN_MODULE`, que não diz nada
// a quem só queria limpar o banco.
//
// `node:sqlite` existe a partir do Node 22.5, e até a 22.12 exigia a flag
// `--experimental-sqlite`. As duas situações produzem o mesmo erro obscuro, e
// as duas se resolvem do mesmo jeito: usar o Node que o instalador colocou em
// /opt/node.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// Onde procurar um Node que sirva. Sobrescrevível só para teste deste
// próprio arquivo — nunca em produção.
const CANDIDATOS = process.env.MOTOCLUB_NODE_CANDIDATOS
  ? process.env.MOTOCLUB_NODE_CANDIDATOS.split(':').filter(Boolean)
  : ['/opt/node/bin/node']

/**
 * Devolve o módulo `node:sqlite`. Se o Node atual não o tiver, reexecuta este
 * mesmo script no primeiro Node que tiver e encerra o processo com o código
 * do filho — do ponto de vista de quem digitou o comando, simplesmente
 * funcionou.
 *
 * `stdio: 'inherit'` não é detalhe: estes scripts perguntam antes de apagar, e
 * sem o terminal herdado a pergunta iria para o vazio e a resposta nunca
 * chegaria.
 */
export async function carregarSqlite() {
  try {
    // Seam de teste: é a única forma de exercitar o caminho de recuperação
    // numa máquina cujo Node TEM o módulo. Nunca defina isto em produção.
    if (process.env.MOTOCLUB_FINGIR_SEM_SQLITE === '1') {
      const falso = new Error('node:sqlite ausente (simulado)')
      falso.code = 'ERR_UNKNOWN_BUILTIN_MODULE'
      throw falso
    }
    return await import('node:sqlite')
  } catch (erro) {
    if (erro?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw erro
    return reexecutarOuExplicar()
  }
}

function reexecutarOuExplicar() {
  // `process.env.MOTOCLUB_NODE_REEXEC` evita laço infinito: se o Node de
  // destino também não tiver o módulo, a segunda tentativa não reexecuta.
  if (process.env.MOTOCLUB_NODE_REEXEC === '1') {
    explicar('o Node usado na segunda tentativa também não tem node:sqlite')
  }

  const alvo = CANDIDATOS.find((caminho) => existsSync(caminho))
  if (!alvo) {
    explicar('não achei um Node com node:sqlite nesta máquina')
  }

  // O seam de teste NÃO é propagado ao filho: se fosse, o filho fingiria a
  // mesma ausência e o caminho feliz (reexecutar e funcionar) seria
  // intestável — só o ramo de erro rodaria, para sempre.
  const { MOTOCLUB_FINGIR_SEM_SQLITE: _seam, ...ambiente } = process.env
  const filho = spawnSync(alvo, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...ambiente, MOTOCLUB_NODE_REEXEC: '1' },
  })
  process.exit(filho.status ?? 1)
}

function explicar(motivo) {
  console.error(`ERRO: ${motivo}.`)
  console.error()
  console.error('Este script precisa do módulo node:sqlite, que existe a partir do')
  console.error('Node 22.5. O Node do sistema costuma ser mais antigo — ou nem existir,')
  console.error('já que o Linux Mint não traz Node.')
  console.error()
  console.error('O instalador coloca um Node adequado em /opt/node. Rode assim:')
  console.error(`  /opt/node/bin/node ${process.argv[1] ?? 'scripts/<script>.mjs'}`)
  console.error()
  console.error('Se /opt/node não existir, rode antes: ~/motoclub/scripts/install.sh')
  process.exit(1)
}
