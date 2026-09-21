// scripts/lib/backup-content.mjs — responde "os dados do bar estão neste
// arquivo?", que é uma pergunta diferente de "este arquivo é um SQLite
// íntegro".
//
// A diferença custou caro para ser vista. Em 21/09/2026, o pendrive de backup
// do clube tinha três arquivos; os três passavam em `PRAGMA integrity_check`,
// e um deles tinha ZERO linhas na tabela `kv` — tirado na janela entre
// instalar o sistema e abrir o app pela primeira vez, quando o documento ainda
// não existia.
//
// Restaurar aquele arquivo devolveria um banco sem documento. E o repositório,
// ao encontrar o armazenamento vazio, GRAVA a demonstração. Ou seja: o
// operador restauraria "o backup" numa noite ruim e receberia Ana Paula e
// Bruno Santos de volta, sem um único erro na tela — que é a pior forma de um
// backup falhar, porque parece ter funcionado.
//
// `integrity_check` continua necessário: ele pega o arquivo truncado, o setor
// ruim, o pendrive morrendo. Só não responde se o conteúdo está lá.
import { DatabaseSync } from 'node:sqlite';

const CHAVE = 'motoclub:bar-database';

/**
 * @returns {{ ok: boolean, detail: string, vazio?: boolean, resumo?: Record<string, number> }}
 *
 * `vazio: true` NÃO é reprovação. Um clube recém-limpo, antes do primeiro
 * cadastro, tem um documento legítimo com todas as coleções vazias — e é
 * exatamente o estado que o operador acabou de preparar com cuidado. Reprovar
 * aqui impediria de guardá-lo. O que reprova é o documento AUSENTE, que é
 * outra coisa: é o backup que não sabe nada sobre o bar.
 */
export function checkBarDocument(filePath) {
  let db;
  try {
    db = new DatabaseSync(filePath, { readOnly: true });
  } catch (erro) {
    return { ok: false, detail: `não consegui abrir o arquivo: ${erro.message}` };
  }

  try {
    let linha;
    try {
      linha = db.prepare('SELECT value FROM kv WHERE key = ?').get(CHAVE);
    } catch (erro) {
      return { ok: false, detail: `não achei a tabela kv neste arquivo (${erro.message})` };
    }

    if (!linha?.value) {
      return {
        ok: false,
        detail:
          `o arquivo não contém o documento do bar ('${CHAVE}'). ` +
          'Restaurá-lo deixaria o banco sem dados, e o sistema recriaria os ' +
          'dados de demonstração no lugar.',
      };
    }

    let envelope;
    try {
      envelope = JSON.parse(String(linha.value));
    } catch {
      return { ok: false, detail: 'o documento do bar não é JSON válido' };
    }

    const dados = envelope?.data;
    if (!dados || typeof dados !== 'object') {
      return { ok: false, detail: "o documento não tem o campo 'data' esperado" };
    }

    // Contagem por coleção, derivada do próprio documento: nenhuma lista de
    // coleções é repetida aqui, então uma coleção nova aparece sozinha.
    const resumo = {};
    for (const [nome, valor] of Object.entries(dados)) {
      if (Array.isArray(valor)) resumo[nome] = valor.length;
    }
    const total = Object.values(resumo).reduce((soma, n) => soma + n, 0);

    return { ok: true, detail: 'documento do bar presente', vazio: total === 0, resumo };
  } finally {
    try {
      db.close();
    } catch {
      // fechar é higiene; o resultado já foi decidido
    }
  }
}

/** Uma linha legível para o log do backup: o que ficou guardado. */
export function descreverResumo(resumo) {
  if (!resumo) return 'sem resumo';
  const partes = [
    ['consumers', 'consumidores'],
    ['items', 'itens'],
    ['consumptions', 'lançamentos'],
    ['payments', 'pagamentos'],
  ]
    .filter(([chave]) => resumo[chave] !== undefined)
    .map(([chave, rotulo]) => `${resumo[chave]} ${rotulo}`);
  return partes.length ? partes.join(', ') : 'nenhum registro';
}
