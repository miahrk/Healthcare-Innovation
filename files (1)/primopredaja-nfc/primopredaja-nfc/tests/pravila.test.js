/*
 * Testovi za postojeća pravila (js/pravila.js) nad izmišljenim demo podacima (js/data.js).
 * Pokretanje: npm test (u mapi aplikacije). Treba Node.js 20.6 ili noviji, bez paketa.
 *
 * Napomena: objekti iz vm konteksta imaju svoje prototipove, pa ih prije usporedbe
 * pretvaramo u obične vrijednosti (npr. [...niz] ili JSON).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aplikacija } = require('./ucitaj');

const ids = (lista) => [...lista].map((x) => x.id);
const razine = (lista) => [...lista].map((x) => x.razina);

test('Ivo Perić: nepregledan kritičan kalij, nespomenut spironolakton i pad frekvencije', () => {
  const { D, P, pacijent } = aplikacija();
  const upoz = P.upozorenja(pacijent('k7m2q9xa'), D.sada);

  const kalij = upoz.find((u) => u.id === 'u-n2');
  assert.ok(kalij, 'nedostaje upozorenje za kalij');
  assert.equal(kalij.razina, 'kriticno');
  assert.equal(kalij.izvor, 'n2');

  const spiro = upoz.find((u) => u.id === 'u-t3');
  assert.ok(spiro, 'nedostaje upozorenje za promjenu terapije');
  assert.equal(spiro.razina, 'upozorenje');

  assert.ok(upoz.some((u) => u.naslov === 'Nagli pad srčane frekvencije' && u.izvor === 'v3'));
  // Pregledani kreatinin ne smije biti upozorenje
  assert.ok(!upoz.some((u) => u.id === 'u-n1'));
  assert.equal(P.procjena(pacijent('k7m2q9xa'), upoz), 2);
});

test('upozorenja su poredana: kritično, upozorenje, info', () => {
  const { D, P } = aplikacija();
  const red = { kriticno: 0, upozorenje: 1, info: 2 };
  for (const p of D.pacijenti) {
    const r = razine(P.upozorenja(p, D.sada)).map((x) => red[x]);
    assert.deepEqual(r, [...r].sort((a, b) => a - b), `krivi redoslijed za ${p.tag}`);
  }
});

test('promjena terapije spomenuta u kasnijoj bilješci više nije upozorenje', () => {
  const { D, P, pacijent } = aplikacija();
  const p = pacijent('k7m2q9xa');
  const biljeska = { id: 'bk1', vrijeme: D.sada, autor: 'S02', tekst: 'Uveden Spironolakton, pratiti kalij.', uzKrevet: true };
  const upoz = P.upozorenja(p, D.sada, [biljeska]);
  assert.ok(!upoz.some((u) => u.id === 'u-t3'));
});

test('bilješka napisana prije promjene terapije ne poništava upozorenje', () => {
  const { D, P, pacijent } = aplikacija();
  const p = pacijent('k7m2q9xa');
  const ranije = new Date(new Date(p.terapija[2].od).getTime() - 60 * 1000).toISOString();
  const biljeska = { id: 'bk1', vrijeme: ranije, autor: 'S02', tekst: 'Razmotriti spironolakton.', uzKrevet: true };
  assert.ok(P.upozorenja(p, D.sada, [biljeska]).some((u) => u.id === 'u-t3'));
});

test('Marija Šimić: niska saturacija kritična, febrilitet, hemokultura na čekanju', () => {
  const { D, P, pacijent } = aplikacija();
  const upoz = P.upozorenja(pacijent('p3c8w1rn'), D.sada);
  const sat = upoz.find((u) => u.naslov === 'Saturacija ispod ciljne');
  assert.ok(sat);
  assert.equal(sat.razina, 'kriticno'); // 91 % je više od 2 boda ispod cilja 94 %
  assert.ok(upoz.some((u) => u.naslov === 'Febrilitet'));
  const hemo = upoz.find((u) => u.id === 'u-n2');
  assert.equal(hemo.razina, 'info');
});

test('Zoran Jurić: saturacija unutar osobnog cilja 88–92 % i spomenuta promjena terapije', () => {
  const { D, P, pacijent } = aplikacija();
  const upoz = P.upozorenja(pacijent('w2f7b3kc'), D.sada);
  assert.ok(!upoz.some((u) => u.naslov === 'Saturacija ispod ciljne'));
  assert.ok(!upoz.some((u) => u.id === 'u-t1'));
});

test('Katarina Novak: zadatak kojem je prošao rok', () => {
  const { D, P, pacijent } = aplikacija();
  const p = pacijent('n8s5e4dy');
  const upoz = P.upozorenja(p, D.sada);
  const kasni = upoz.find((u) => u.id === 'u-z1');
  assert.ok(kasni);
  assert.equal(kasni.naslov, 'Zadatak kasni');

  const akcije = [...P.akcije(p, D.sada)];
  assert.equal(akcije.find((a) => a.izvor === 'z1').kasni, true);
  // z2 (sutra u 08:00) je 13 h 5 min nakon 18:55, izvan liste za sljedeću smjenu
  assert.ok(!akcije.some((a) => a.izvor === 'z2'));
});

test('Josip Kovačević: bez upozorenja, procjena ostaje stabilan', () => {
  const { D, P, pacijent } = aplikacija();
  const p = pacijent('h5v1t6ze');
  const upoz = P.upozorenja(p, D.sada);
  assert.equal(upoz.length, 0);
  assert.equal(P.procjena(p, upoz), 0);
});

test('procjena: upozorenje podiže stabilnog pacijenta na pojačan nadzor', () => {
  const { P } = aplikacija();
  assert.equal(P.procjena({ stanje: 'stabilan' }, [{ razina: 'upozorenje' }]), 1);
  assert.equal(P.procjena({ stanje: 'stabilan' }, [{ razina: 'info' }]), 0);
  assert.equal(P.procjena({ stanje: 'nadzor' }, []), 1);
});

test('akcije: zadaci unutar 13 sati i nalazi na čekanju, poredano po roku', () => {
  const { D, P, pacijent } = aplikacija();
  const akcije = [...P.akcije(pacijent('p3c8w1rn'), D.sada)];
  assert.deepEqual(akcije.map((a) => a.izvor), ['z1', 'z2', 'n2']);
  assert.equal(akcije[2].rok, null);

  // Zadatak sutra u 10:00 je dalje od 13 sati i ne ulazi u listu
  assert.ok(!P.akcije(pacijent('h5v1t6ze'), D.sada).some((a) => a.izvor === 'z2'));
});

test('sažetak iz pravila navodi zadnju bilješku i terapiju kao izvore', () => {
  const { P, pacijent } = aplikacija();
  const s = P.sazetak(pacijent('k7m2q9xa'));
  assert.deepEqual([...s.izvori], ['b2', 't1', 't2', 't3']);
  assert.match(s.tekst, /Uzeta krv za elektrolite/);
});

test('izvorni zapisi: svi ID-evi su jedinstveni, a plan je na kraju', () => {
  const { D, P } = aplikacija();
  for (const p of D.pacijenti) {
    const z = [...P.zapisi(p)];
    assert.equal(new Set(ids(z)).size, z.length, `dupli ID kod ${p.tag}`);
    const prviPlan = z.findIndex((x) => x.vrsta === 'Plan');
    if (prviPlan >= 0) assert.ok(z.slice(prviPlan).every((x) => x.vrsta === 'Plan'));
  }
});

test('demo podaci su dosljedni', () => {
  const { D } = aplikacija();
  const tagovi = D.pacijenti.map((p) => p.tag);
  assert.equal(new Set(tagovi).size, tagovi.length, 'dupli ID narukvice');
  const djelatnici = new Set(D.djelatnici.map((d) => d.id));
  const pinovi = D.djelatnici.filter((d) => d.pin).map((d) => d.pin);
  assert.equal(new Set(pinovi).size, pinovi.length, 'dupli PIN');
  for (const p of D.pacijenti) {
    assert.match(p.tag, /^[a-z0-9]{4,32}$/, 'ID narukvice mora odgovarati formatu iz nfc.js');
    assert.ok(D.odjeli[p.odjel], `nepoznat odjel ${p.odjel}`);
    p.nalazi.forEach((n) => n.pregledao && assert.ok(djelatnici.has(n.pregledao)));
    p.biljeske.forEach((b) => assert.ok(djelatnici.has(b.autor)));
  }
});

test('pregled: Ivo Perić, zadnji vitalni znakovi s usporedbom i odstupanjima', () => {
  const { D, P, pacijent } = aplikacija();
  const pr = P.pregled(pacijent('k7m2q9xa'), D.sada);
  assert.equal(pr.vitali.id, 'v3');
  const fp = pr.vitali.stavke.find((s) => s.oznaka === 'FP');
  assert.equal(fp.vrijednost, '56/min');
  assert.equal(fp.ranije, '82/min');
  assert.equal(fp.odstupa, true); // nagli pad od 26/min
  assert.equal(pr.vitali.stavke.find((s) => s.oznaka === 'SpO2').odstupa, false);
  assert.equal(pr.vitali.stavke.find((s) => s.oznaka === 'FD').odstupa, false);
});

test('pregled: nalazi od najnovijeg, sa statusom pregleda', () => {
  const { D, P, pacijent } = aplikacija();
  const pr = P.pregled(pacijent('k7m2q9xa'), D.sada);
  assert.deepEqual([...pr.nalazi].map((n) => [n.id, n.status, n.izvanRef]), [['n2', 'nepregledan', true], ['n1', 'pregledan', true]]);
  assert.equal(pr.nalaziJos, 0);
  const marija = P.pregled(pacijent('p3c8w1rn'), D.sada);
  assert.equal(marija.nalazi[0].id, 'n2');
  assert.equal(marija.nalazi[0].status, 'ceka');
});

test('pregled: ograničen broj nalaza i bilješki, s brojem preostalih', () => {
  const { D, P, pacijent } = aplikacija();
  const pr = P.pregled(pacijent('k7m2q9xa'), D.sada, [], 1, 1);
  assert.equal(pr.nalazi.length, 1);
  assert.equal(pr.nalaziJos, 1);
  assert.equal(pr.biljeske.length, 1);
  assert.equal(pr.biljeskeJos, 1);
});

test('pregled: bilješka uz krevet je najnovija bilješka', () => {
  const { D, P, pacijent } = aplikacija();
  const b = { id: 'bk1', vrijeme: D.sada, autor: 'S02', tekst: 'Pospan.', uzKrevet: true };
  const pr = P.pregled(pacijent('k7m2q9xa'), D.sada, [b]);
  assert.deepEqual([...pr.biljeske].map((x) => [x.id, x.uzKrevet]), [['bk1', true], ['b2', false]]);
});

test('pregled: terapija s promjenama i svi otvoreni zadaci po roku', () => {
  const { D, P, pacijent } = aplikacija();
  const pr = P.pregled(pacijent('n8s5e4dy'), D.sada);
  assert.deepEqual([...pr.zadaci].map((z) => [z.id, z.kasni]), [['z1', true], ['z2', false]]);
  const ivo = P.pregled(pacijent('k7m2q9xa'), D.sada);
  assert.equal(ivo.terapija.length, 3);
  assert.equal(ivo.terapija.find((t) => t.id === 't3').promjena, 'uveden');
  assert.equal(ivo.terapija.find((t) => t.id === 't1').promjena, null);
});

test('pregled: pacijent bez zapisa ne puca', () => {
  const { D, P, pacijent } = aplikacija();
  const pr = P.pregled(pacijent('t1g6y8hp'), D.sada);
  assert.equal(pr.vitali, null);
  assert.equal(pr.nalazi.length + pr.terapija.length + pr.biljeske.length + pr.zadaci.length, 0);
});
