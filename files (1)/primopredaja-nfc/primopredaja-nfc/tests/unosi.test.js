/*
 * Testovi za spajanje POTVRĐENIH glasovnih unosa u zapis pacijenta (PRAVILA.spojiUnose)
 * i za to kako ih vide pravila za upozorenja, pregled, akcije, sažetak i izvorni zapisi.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aplikacija } = require('./ucitaj');

const nakon = (sada, min) => new Date(new Date(sada).getTime() + min * 60000).toISOString();
const unos = (D, vrsta, podaci, min = 5, id = 'gu' + vrsta) =>
  ({ id, vrsta, podaci, izvor: '…', potvrdio: 'S02', potvrdeno: nakon(D.sada, min), ispravljeno: false });
const json = (x) => JSON.parse(JSON.stringify(x));

test('bez unosa pacijent ostaje isti objekt', () => {
  const { P, pacijent } = aplikacija();
  const p = pacijent('k7m2q9xa');
  assert.equal(P.spojiUnose(p, []), p);
});

test('spajanje ne mijenja izvorne demo podatke', () => {
  const { D, P, pacijent } = aplikacija();
  const p = pacijent('k7m2q9xa');
  const prije = JSON.stringify(p);
  P.spojiUnose(p, [unos(D, 'terapija', { lijek: 'Spironolakton', doza: '', promjena: 'ukinut', od: null })]);
  assert.equal(JSON.stringify(p), prije);
});

test('djelomični vitalni znakovi: novo mjerenje pulsa, ostali znakovi iz zadnjeg potpunog', () => {
  const { D, P, pacijent } = aplikacija();
  const q = P.spojiUnose(pacijent('h5v1t6ze'), [unos(D, 'vitali', { fp: 128 })]);
  const upoz = json(P.upozorenja(q, D.sada));
  const fp = upoz.find((u) => u.naslov === 'Srčana frekvencija izvan sigurnog raspona');
  assert.ok(fp, 'puls 128 iz glasovnog unosa mora dati kritično upozorenje');
  assert.equal(fp.izvor, 'guvitali');
  assert.equal(P.procjena(q, upoz), 2);

  const pr = json(P.pregled(q, D.sada));
  const s = Object.fromEntries(pr.vitali.stavke.map((x) => [x.oznaka, x]));
  assert.equal(s.FP.vrijednost, '128/min');
  assert.equal(s.FP.ranije, '76/min');
  assert.equal(s.FP.glas, true);
  assert.equal(s.RR.vrijednost, '130/80 mmHg'); // iz zadnjeg potpunog mjerenja (v2)
  assert.equal(s.RR.izvor, 'v2');
  assert.ok(!pr.vitali.stavke.some((x) => x.vrijednost.includes('undefined')));

  const z = json(P.zapisi(q)).find((x) => x.id === 'guvitali');
  assert.equal(z.tekst, 'FP 128/min; glasovni unos, potvrdio/la S02');
});

test('nalaz iz glasovnog unosa: u pregledu, pregledan od onoga tko ga je potvrdio', () => {
  const { D, P, pacijent } = aplikacija();
  const q = P.spojiUnose(pacijent('h5v1t6ze'),
    [unos(D, 'nalaz', { naziv: 'Kalij (K+)', vrijednost: 6.3, jedinica: 'mmol/L', ref: [3.5, 5.1], stiglo: null })]);
  const n = json(P.pregled(q, D.sada)).nalazi[0];
  assert.deepEqual([n.id, n.status, n.izvanRef, n.glas], ['gunalaz', 'pregledan', true, true]);
  assert.ok(!json(P.upozorenja(q, D.sada)).some((u) => u.izvor === 'gunalaz'));
});

test('ukinut lijek: stari zapis zamijenjen, nova promjena traži spomen u bilješci', () => {
  const { D, P, pacijent } = aplikacija();
  const q = P.spojiUnose(pacijent('k7m2q9xa'),
    [unos(D, 'terapija', { lijek: 'Spironolakton', doza: '', promjena: 'ukinut', od: null })]);
  assert.equal(q.terapija.find((t) => t.id === 't3').neaktivno, true);

  const upoz = json(P.upozorenja(q, D.sada));
  assert.ok(!upoz.some((u) => u.id === 'u-t3'), 'zamijenjeni zapis više ne daje upozorenje');
  assert.ok(upoz.some((u) => u.id === 'u-guterapija'), 'ukidanje je promjena koju treba spomenuti');

  const ter = json(P.pregled(q, D.sada)).terapija;
  assert.deepEqual(ter.map((t) => t.id), ['t1', 't2', 'guterapija']);
  assert.equal(P.sazetak(q).tekst.includes('Spironolakton'), false);

  // potvrđena glasovna bilješka koja spominje lijek uklanja upozorenje
  const q2 = P.spojiUnose(pacijent('k7m2q9xa'), [
    unos(D, 'terapija', { lijek: 'Spironolakton', doza: '', promjena: 'ukinut', od: null }, 5),
    unos(D, 'biljeska', { tekst: 'Spironolakton ukinut zbog hiperkalijemije.' }, 6)
  ]);
  assert.ok(!json(P.upozorenja(q2, D.sada)).some((u) => u.id === 'u-guterapija'));
});

test('promjena doze lijeka izgovorenog u genitivu zamjenjuje stari zapis', () => {
  const { D, P, pacijent } = aplikacija();
  const q = P.spojiUnose(pacijent('k7m2q9xa'),
    [unos(D, 'terapija', { lijek: 'Furosemida', doza: '20 mg i.v.', promjena: 'doza smanjena', od: null })]);
  assert.equal(q.terapija.find((t) => t.id === 't1').neaktivno, true);
  assert.equal(q.terapija.find((t) => t.id === 't2').neaktivno, undefined);
});

test('jednokratna doza nije promjena terapije i nije u sažetku', () => {
  const { D, P, pacijent } = aplikacija();
  const q = P.spojiUnose(pacijent('h5v1t6ze'),
    [unos(D, 'terapija', { lijek: 'Paracetamol', doza: '1 g p.o.', promjena: 'jednokratno dan', od: D.sada })]);
  assert.ok(!json(P.upozorenja(q, D.sada)).some((u) => u.izvor === 'guterapija'));
  assert.ok(!P.sazetak(q).tekst.includes('Paracetamol'));
  assert.ok(json(P.pregled(q, D.sada)).terapija.some((t) => t.id === 'guterapija'));
});

test('zadatak iz glasovnog unosa ulazi u akcijsku listu i otvorene zadatke', () => {
  const { D, P, pacijent } = aplikacija();
  const rok = nakon(D.sada, 60);
  const q = P.spojiUnose(pacijent('h5v1t6ze'), [unos(D, 'zadatak', { opis: 'Kontrola GUK-a', rok })]);
  assert.ok(json(P.akcije(q, D.sada)).some((a) => a.izvor === 'guzadatak' && a.tekst === 'Kontrola GUK-a'));
  assert.equal(json(P.pregled(q, D.sada)).zadaci.find((z) => z.id === 'guzadatak').glas, true);
});

test('glasovna bilješka je zadnja bilješka u sažetku i pregledu', () => {
  const { D, P, pacijent } = aplikacija();
  const q = P.spojiUnose(pacijent('k7m2q9xa'), [unos(D, 'biljeska', { tekst: 'Bolesnik pospan.' })]);
  assert.match(P.sazetak(q).tekst, /Zadnja bilješka .*Bolesnik pospan\./);
  const b = json(P.pregled(q, D.sada)).biljeske[0];
  assert.deepEqual([b.id, b.glas, b.autor], ['gubiljeska', true, 'S02']);
});
