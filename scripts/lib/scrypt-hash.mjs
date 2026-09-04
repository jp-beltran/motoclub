#!/usr/bin/env node
// Hash e verificação do PIN do bar, via scrypt (node:crypto).
//
// Formato fixado pelo contrato compartilhado do backend:
//   BAR_PIN_HASH = "scrypt$<salt-hex>$<hash-hex>"
//
// IMPORTANTE (risco de integração): o contrato fixa só o formato da string,
// não os parâmetros de custo do scrypt (N, r, p) nem o tamanho da chave.
// Este arquivo usa os parâmetros padrão do Node para scryptSync (N=16384,
// r=8, p=1) com chave de 64 bytes. O servidor (escrito em paralelo, em
// server/) precisa recalcular o hash com EXATAMENTE os mesmos parâmetros
// para a verificação bater — combinar isso é responsabilidade de quem
// integra as duas pontas, não algo que este arquivo sozinho garante.
//
// Só depende de node:crypto — nenhuma dependência de npm, para rodar no
// notebook sem `npm install`.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const SCRYPT_PREFIX = 'scrypt';
export const SCRYPT_KEYLEN = 64; // bytes

/**
 * Deriva o hash de um PIN. saltHex é injetável só para testes determinísticos;
 * em uso real é sempre gerado aleatoriamente.
 */
export function hashPin(pin, saltHex = randomBytes(16).toString('hex')) {
  if (typeof pin !== 'string' || pin.length === 0) {
    throw new Error('PIN vazio');
  }
  const salt = Buffer.from(saltHex, 'hex');
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `${SCRYPT_PREFIX}$${saltHex}$${hash.toString('hex')}`;
}

/** Verifica um PIN contra um hash armazenado no formato scrypt$salt$hash. */
export function verifyPin(pin, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== SCRYPT_PREFIX) return false;
  const [, saltHex, hashHex] = parts;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = scryptSync(pin, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Valida o formato de BAR_PIN_HASH sem precisar do PIN original. */
export function isValidHashFormat(stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== SCRYPT_PREFIX) return false;
  return /^[0-9a-f]+$/i.test(parts[1]) && /^[0-9a-f]+$/i.test(parts[2]);
}

// --- CLI ---------------------------------------------------------------
// Uso (o PIN sempre chega por stdin, nunca por argv, para não aparecer em `ps`):
//   printf '%s' "$PIN" | node scrypt-hash.mjs hash
//   printf '%s' "$PIN" | node scrypt-hash.mjs verify "$STORED"

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const mode = process.argv[2];
  const pin = (await readStdin()).replace(/\r?\n$/, '');

  if (mode === 'hash') {
    if (pin.length < 4) {
      process.stderr.write('PIN muito curto (mínimo 4 caracteres)\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(hashPin(pin) + '\n');
    return;
  }

  if (mode === 'verify') {
    const stored = process.argv[3];
    process.exitCode = verifyPin(pin, stored) ? 0 : 1;
    return;
  }

  process.stderr.write('uso: scrypt-hash.mjs <hash|verify [stored]>  (PIN via stdin)\n');
  process.exitCode = 2;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
