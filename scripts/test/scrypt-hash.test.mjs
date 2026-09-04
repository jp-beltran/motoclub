import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, verifyPin, isValidHashFormat, SCRYPT_PREFIX } from '../lib/scrypt-hash.mjs';

test('hashPin produz o formato scrypt$salt$hash', () => {
  const stored = hashPin('1234');
  const parts = stored.split('$');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], SCRYPT_PREFIX);
  assert.match(parts[1], /^[0-9a-f]+$/);
  assert.match(parts[2], /^[0-9a-f]+$/);
});

test('hashPin com o mesmo salt é determinístico', () => {
  const a = hashPin('1234', 'aa'.repeat(16));
  const b = hashPin('1234', 'aa'.repeat(16));
  assert.equal(a, b);
});

test('hashPin com salts diferentes produz hashes diferentes', () => {
  const a = hashPin('1234');
  const b = hashPin('1234');
  assert.notEqual(a, b); // salt aleatório por padrão
});

test('verifyPin aceita o PIN correto', () => {
  const stored = hashPin('4321');
  assert.equal(verifyPin('4321', stored), true);
});

test('verifyPin rejeita o PIN errado', () => {
  const stored = hashPin('4321');
  assert.equal(verifyPin('0000', stored), false);
});

test('verifyPin rejeita formatos malformados sem lançar exceção', () => {
  assert.equal(verifyPin('4321', 'nao-e-um-hash'), false);
  assert.equal(verifyPin('4321', 'scrypt$semhash'), false);
  assert.equal(verifyPin('4321', 'outraversao$aa$bb'), false);
  assert.equal(verifyPin('4321', ''), false);
  assert.equal(verifyPin('4321', undefined), false);
  assert.equal(verifyPin('4321', 'scrypt$zz$zz'), false); // hex inválido
});

test('hashPin recusa PIN vazio', () => {
  assert.throws(() => hashPin(''));
});

test('isValidHashFormat reconhece hashes válidos e rejeita o resto', () => {
  assert.equal(isValidHashFormat(hashPin('9999')), true);
  assert.equal(isValidHashFormat('scrypt$aa$bb'), true);
  assert.equal(isValidHashFormat('scrypt$aa'), false);
  assert.equal(isValidHashFormat('outro$aa$bb'), false);
  assert.equal(isValidHashFormat(null), false);
  assert.equal(isValidHashFormat('scrypt$zz$bb'), false); // salt não-hex
});
