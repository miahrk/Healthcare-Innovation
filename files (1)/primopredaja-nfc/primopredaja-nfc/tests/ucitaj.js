/*
 * Učitava skripte aplikacije (pisane za preglednik, bez modula) u izolirani kontekst,
 * tako da ih testovi mogu koristiti bez preglednika i bez dodatnih paketa.
 * Skripte vješaju svoje objekte na `window`, pa je `window` ovdje sam kontekst.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KORIJEN = path.resolve(__dirname, '..');

function ucitaj(...datoteke) {
  const kontekst = vm.createContext({ console });
  kontekst.window = kontekst;
  for (const d of datoteke) {
    const kod = fs.readFileSync(path.join(KORIJEN, d), 'utf8');
    vm.runInContext(kod, kontekst, { filename: d });
  }
  return kontekst;
}

// Svježa kopija podataka i pravila za svaki test, da testovi ne utječu jedan na drugoga
function aplikacija() {
  const k = ucitaj('js/data.js', 'js/pravila.js');
  return { D: k.APP_DATA, P: k.PRAVILA, pacijent: (tag) => k.APP_DATA.pacijenti.find((p) => p.tag === tag) };
}

module.exports = { KORIJEN, ucitaj, aplikacija };
