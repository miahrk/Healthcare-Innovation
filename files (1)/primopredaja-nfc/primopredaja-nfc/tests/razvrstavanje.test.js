/*
 * Testovi za razvrstavanje izgovorenog teksta u polja (js/razvrstavanje.js).
 * Glavno pravilo: ništa se ne izmišlja, a ono što se ne može pouzdano svrstati ide u opću bilješku.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ucitaj } = require('./ucitaj');

const k = ucitaj('js/data.js', 'js/razvrstavanje.js');
const R = k.RAZVRSTAVANJE;
const SADA = k.APP_DATA.sada; // danas 18:55

// Obične vrijednosti (vm kontekst ima svoje prototipove)
const razvrstaj = (t) => JSON.parse(JSON.stringify(R.razvrstaj(t, SADA)));
const vrste = (r) => r.polja.map((p) => p.vrsta);
const polje = (r, vrsta) => r.polja.find((p) => p.vrsta === vrsta);
const sviOd = (r, vrsta) => r.polja.filter((p) => p.vrsta === vrsta);

function sat(iso) {
  const d = new Date(iso);
  const s = new Date(SADA);
  const dan = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(s).setHours(0, 0, 0, 0)) / 86400000);
  return `${dan === 1 ? 'sutra ' : dan === 0 ? '' : dan + 'd '}${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

test('prazan tekst: nema polja', () => {
  assert.deepEqual(razvrstaj('').polja, []);
  assert.deepEqual(razvrstaj('   ').polja, []);
});

test('diktat bez interpunkcije (kako ga vraća Chrome) razvrstava se u sva polja', () => {
  const r = razvrstaj('tlak 130 na 85 puls 92 saturacija 95 posto temperatura 37 zarez 8 kalij 5,4 uveden ceftriakson 2 g iv treba kontrolirati CRP sutra u 6 sati bolesnik se žali na bol u leđima');
  assert.deepEqual(vrste(r), ['vitali', 'nalaz', 'terapija', 'zadatak', 'biljeska']);
  assert.deepEqual(polje(r, 'vitali').podaci, { sys: 130, dia: 85, fp: 92, spo2: 95, temp: 37.8 });
  assert.deepEqual(polje(r, 'nalaz').podaci, { naziv: 'Kalij (K+)', vrijednost: 5.4, jedinica: 'mmol/L', ref: [3.5, 5.1], stiglo: null });
  assert.deepEqual(polje(r, 'terapija').podaci, { lijek: 'Ceftriakson', doza: '2 g iv', promjena: 'uveden', od: null });
  const z = polje(r, 'zadatak');
  assert.equal(z.podaci.opis, 'Kontrolirati CRP');
  assert.equal(sat(z.podaci.rok), 'sutra 06:00');
  assert.equal(polje(r, 'biljeska').podaci.tekst, 'Bolesnik se žali na bol u leđima.');
});

test('diktat s interpunkcijom i uobičajenim zapisima', () => {
  const r = razvrstaj('Bolesnica pospana, budi se na poziv. RR 105/60 mmHg, FP 118/min, SpO2 89 %, T 38,6 °C, frekvencija disanja 26. Dan paracetamol 1 g p.o.');
  assert.deepEqual(polje(r, 'vitali').podaci, { sys: 105, dia: 60, fp: 118, spo2: 89, temp: 38.6, fd: 26 });
  assert.deepEqual(polje(r, 'terapija').podaci, { lijek: 'Paracetamol', doza: '1 g p.o.', promjena: 'jednokratno dan', od: null });
  assert.equal(polje(r, 'biljeska').podaci.tekst, 'Bolesnica pospana, budi se na poziv.');
});

test('svaka svrstana vrijednost doslovno postoji u izgovorenom tekstu', () => {
  const t = 'tlak 140 na 90 puls 76 kreatinin 210 smanjena doza furosemida na 20 mg i.v. zadatak: bilanca tekućine u 22 sata';
  const r = razvrstaj(t);
  const norm = R.normaliziraj(t);
  for (const p of r.polja) {
    if (p.vrsta === 'biljeska') continue;
    p.izvor.split(' · ').forEach((dio) => assert.ok(norm.includes(dio), `izvor "${dio}" nije u tekstu`));
  }
  assert.deepEqual(polje(r, 'terapija').podaci, { lijek: 'Furosemida', doza: '20 mg i.v.', promjena: 'doza smanjena', od: null });
  assert.equal(polje(r, 'zadatak').podaci.opis, 'Bilanca tekućine');
  assert.equal(sat(polje(r, 'zadatak').podaci.rok), '22:00');
  assert.equal(polje(r, 'biljeska'), undefined);
});

test('ništa prepoznatljivo: sve ide u opću bilješku, bez izmišljanja', () => {
  const r = razvrstaj('bolesnik je mirniji nego jutros, obitelj je bila u posjetu');
  assert.deepEqual(vrste(r), ['biljeska']);
  assert.equal(polje(r, 'biljeska').podaci.tekst, 'Bolesnik je mirniji nego jutros, obitelj je bila u posjetu.');
  assert.deepEqual(r.napomene, []);
});

test('vrijednost izvan uvjerljivog raspona ostaje u bilješci, uz napomenu', () => {
  const r = razvrstaj('tlak 300 na 80 saturacija 120 puls 80');
  assert.deepEqual(polje(r, 'vitali').podaci, { fp: 80 });
  assert.match(polje(r, 'biljeska').podaci.tekst, /tlak 300 na 80/i);
  assert.match(polje(r, 'biljeska').podaci.tekst, /saturacija 120/i);
  assert.equal(r.napomene.length, 2);
});

test('nalaz u krivoj jedinici (hemoglobin 7,2 g/dL) se ne svrstava', () => {
  const r = razvrstaj('hemoglobin 7,2');
  assert.equal(polje(r, 'nalaz'), undefined);
  assert.match(polje(r, 'biljeska').podaci.tekst, /hemoglobin 7,2/i);
  assert.equal(r.napomene.length, 1);
});

test('isti vitalni znak s različitim vrijednostima je dvosmislen: ide u bilješku', () => {
  const r = razvrstaj('puls 80 ne zapravo puls 90 temperatura 36,9');
  assert.deepEqual(polje(r, 'vitali').podaci, { temp: 36.9 });
  assert.match(polje(r, 'biljeska').podaci.tekst, /puls 80/i);
  assert.match(polje(r, 'biljeska').podaci.tekst, /puls 90/i);
  assert.equal(r.napomene.length, 1);
});

test('nejasna frekvencija (bez "srčana" ili "disanja") se ne svrstava', () => {
  const r = razvrstaj('frekvencija 88');
  assert.deepEqual(vrste(r), ['biljeska']);
});

test('nalazi: više nalaza, kvalifikator natašte i jedinica', () => {
  const r = razvrstaj('GUK natašte 8,4 mmol/L, natrij 132, CRP 148');
  const n = sviOd(r, 'nalaz').map((p) => [p.podaci.naziv, p.podaci.vrijednost]);
  assert.deepEqual(n, [['GUK', 8.4], ['Natrij (Na+)', 132], ['CRP', 148]]);
  assert.equal(sviOd(r, 'nalaz')[1].podaci.ref, null); // natrij nema ref u demo podacima: ne izmišljamo
});

test('terapija: ukinut lijek bez doze je promjena, uveden lijek bez doze nije', () => {
  const r = razvrstaj('ukinut metformin. uveden inzulin');
  const t = sviOd(r, 'terapija');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].podaci, { lijek: 'Metformin', doza: '', promjena: 'ukinut', od: null });
  assert.match(polje(r, 'biljeska').podaci.tekst, /uveden inzulin/i);
  assert.equal(r.napomene.length, 1);
});

test('"dan" kao dan u tjednu nije terapija', () => {
  const r = razvrstaj('drugi dan bez temperature, apetit bolji');
  assert.deepEqual(vrste(r), ['biljeska']);
  assert.deepEqual(r.napomene, []);
});

test('zadaci: rok popodne, rok koji je već prošao danas je sutra, relativni rok', () => {
  const a = polje(razvrstaj('potrebno je izvaditi krv za KKS u 9 navečer'), 'zadatak');
  assert.equal(a.podaci.opis, 'Izvaditi krv za KKS');
  assert.equal(sat(a.podaci.rok), '21:00');

  const b = polje(razvrstaj('zadatak promijeniti kanilu u 8 sati'), 'zadatak');
  assert.equal(sat(b.podaci.rok), 'sutra 08:00'); // 08:00 je danas već prošlo (sada je 18:55)

  const c = polje(razvrstaj('ponoviti GUK za 2 sata'), 'zadatak');
  assert.equal(c.podaci.opis, 'Ponoviti GUK');
  assert.equal(sat(c.podaci.rok), '20:55');

  const d = polje(razvrstaj('kontrola GUK-a u 21:30'), 'zadatak');
  assert.equal(d.podaci.opis, 'Kontrola GUK-a');
  assert.equal(sat(d.podaci.rok), '21:30');
});

test('zadatak bez vremena: "treba" je zadatak bez roka, "kontrola" ostaje bilješka', () => {
  const r = razvrstaj('treba javiti obitelji');
  assert.deepEqual(polje(r, 'zadatak').podaci, { opis: 'Javiti obitelji', rok: null });

  const r2 = razvrstaj('kontrola elektrolita poslijepodne');
  assert.deepEqual(vrste(r2), ['biljeska']);
});

test('"ne treba" nije zadatak', () => {
  const r = razvrstaj('ne treba ništa dodatno');
  assert.deepEqual(vrste(r), ['biljeska']);
});

test('nemoguće vrijeme (25 sati) ne daje rok', () => {
  const r = razvrstaj('kontrola tlaka u 25 sati');
  assert.equal(polje(r, 'zadatak'), undefined);
});

test('zadatak završava nakon vremena, ostatak ide u bilješku', () => {
  const r = razvrstaj('treba snimiti EKG u 20 sati bolesnik se žali na lupanje srca');
  assert.equal(polje(r, 'zadatak').podaci.opis, 'Snimiti EKG');
  assert.equal(polje(r, 'biljeska').podaci.tekst, 'Bolesnik se žali na lupanje srca.');
});

test('polja su poredana kako su izgovorena i imaju jedinstvene ID-eve', () => {
  const r = razvrstaj('bolesnik miran. zadatak: okretati u krevetu u 22 sata. kalij 4,1. puls 70');
  assert.deepEqual(vrste(r), ['zadatak', 'nalaz', 'vitali', 'biljeska']);
  assert.deepEqual(r.polja.map((p) => p.id), ['g1', 'g2', 'g3', 'g4']);
});

test('opis polja za prikaz', () => {
  const r = razvrstaj('tlak 120/80 temperatura 37,2 kalij 3,9 uveden pantoprazol 40 mg i.v.');
  assert.equal(R.opisPolja(polje(r, 'vitali')), 'RR 120/80 mmHg, T 37,2 °C');
  assert.equal(R.opisPolja(polje(r, 'nalaz')), 'Kalij (K+): 3,9 mmol/L');
  assert.equal(R.opisPolja(polje(r, 'terapija')), 'Pantoprazol 40 mg i.v. (uveden)');
});

test('samostalno "t" je temperatura samo uz decimalu ili °', () => {
  assert.deepEqual(polje(razvrstaj('T 37,9'), 'vitali').podaci, { temp: 37.9 });
  assert.deepEqual(polje(razvrstaj('t 38 °C'), 'vitali').podaci, { temp: 38 });
  assert.deepEqual(vrste(razvrstaj('soba t 12')), ['biljeska']);
});

test('vrijeme iza lijeka ili nalaza: prošlo vrijeme je vrijeme primjene ili nalaza', () => {
  const r = razvrstaj('primio furosemid 40 mg iv u 18 sati diureza slaba');
  const t = polje(r, 'terapija');
  assert.equal(t.podaci.lijek, 'Furosemid');
  assert.equal(sat(t.podaci.od), '18:00');
  assert.equal(polje(r, 'biljeska').podaci.tekst, 'Diureza slaba.');

  const n = polje(razvrstaj('GUK 4,1 u 17:30'), 'nalaz');
  assert.equal(sat(n.podaci.stiglo), '17:30');
});

test('buduće vrijeme iza lijeka nije vrijeme primjene i ostaje u tekstu', () => {
  const r = razvrstaj('dan paracetamol 1 g p.o. u 20 sati');
  assert.equal(polje(r, 'terapija').podaci.od, null);
  assert.match(polje(r, 'biljeska').podaci.tekst, /u 20 sati/i);
});

test('nesvrstani dijelovi spojeni su s "…" da se vidi što je izvučeno', () => {
  const r = razvrstaj('pacijent Ivo Perić tlak 100 na 60 diureza slaba');
  assert.equal(polje(r, 'biljeska').podaci.tekst, 'Pacijent Ivo Perić … diureza slaba.');
});
