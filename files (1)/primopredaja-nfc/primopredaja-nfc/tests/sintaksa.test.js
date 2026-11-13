/*
 * Provjera sintakse svih skripti aplikacije (zamjena za build korak, kojeg nema).
 * Skripte se samo prevode, ne izvršavaju, pa ne trebaju preglednik.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { KORIJEN } = require('./ucitaj');

const index = fs.readFileSync(path.join(KORIJEN, 'index.html'), 'utf8');
const skripte = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

test('index.html učitava skripte aplikacije', () => {
  assert.ok(skripte.length > 0);
  assert.ok(skripte.includes('js/app.js'));
});

for (const s of skripte) {
  test(`sintaksa: ${s}`, () => {
    const kod = fs.readFileSync(path.join(KORIJEN, s), 'utf8');
    assert.doesNotThrow(() => new vm.Script(kod, { filename: s }));
  });
}
