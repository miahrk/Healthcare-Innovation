(function () {
  'use strict';

  const D = window.APP_DATA;
  const P = window.PRAVILA;
  const N = window.NFC;
  const app = document.getElementById('app');
  const vr = P.vrijeme;

  // ---------- pohrana (localStorage, samo za demo) ----------
  const PREFIKS = 'primopredaja-demo:';
  const store = {
    get(k, zadano) {
      try { const v = localStorage.getItem(PREFIKS + k); return v === null ? zadano : JSON.parse(v); }
      catch (e) { return zadano; }
    },
    set(k, v) {
      try { localStorage.setItem(PREFIKS + k, JSON.stringify(v)); } catch (e) { /* pohrana nedostupna */ }
    },
    remove(k) {
      try { localStorage.removeItem(PREFIKS + k); } catch (e) { /* pohrana nedostupna */ }
    }
  };

  // ---------- stanje u memoriji ----------
  let aiDostupan = false;
  const potvrde = {};        // tag -> Set ID-eva potvrđenih upozorenja na otvorenoj kartici
  const pristup = {};        // tag -> { nacin: 'nfc' | 'rucno', u: ISO }
  const aiSazeci = {};       // tag -> { sazetak, izvori }

  // ---------- pomoćne funkcije ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const djelatnik = (id) => D.djelatnici.find((d) => d.id === id);
  const imeDjelatnika = (id) => (djelatnik(id) || { ime: id }).ime;
  const pacijent = (tag) => D.pacijenti.find((p) => p.tag === tag);

  function korisnik() {
    const s = store.get('sesija', null);
    return s ? djelatnik(s.id) || null : null;
  }

  // ---------- uloge i razine pristupa ----------
  // Prava su na jednom mjestu kako bi se lako provjerila i promijenila.
  const ROLE = {
    lijecnik: { prava: ['terapija', 'vizita', 'nalazi', 'vitali', 'zadaci', 'plan', 'stanje', 'profil', 'preuzimanje', 'prijem'] },
    sestra: { prava: ['primjena', 'vitali', 'sestrinska', 'zadaci', 'profil', 'preuzimanje', 'prijem'] }
  };

  const rola = (d) => (d && d.rola) || null;
  const ima = (k, pravo) => !!k && (ROLE[rola(k)] || { prava: [] }).prava.includes(pravo);
  // Djelatnik vidi i mijenja samo pacijente svog odjela
  const vidiPacijenta = (k, p) => !!k && !!k.odjel && p.odjel === k.odjel;
  const smijeMijenjati = vidiPacijenta;

  // Trenutno vrijeme za zapise: stvarno vrijeme, ali nikad prije demo-vremena smjene
  function sadaZaZapis() {
    return new Date(Math.max(Date.now(), new Date(D.sada).getTime())).toISOString();
  }

  function kada(iso) {
    const d = new Date(iso);
    const s = new Date(D.sada);
    const isti = d.toDateString() === s.toDateString();
    const sutra = new Date(s); sutra.setDate(s.getDate() + 1);
    if (isti) return vr(iso);
    if (d.toDateString() === sutra.toDateString()) return 'sutra ' + vr(iso);
    return P.vrijemeDatum(iso);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const kljucDatuma = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // '2026-11-13' ili ISO vrijeme -> '13. 11. 2026.'
  function datum(s) {
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      return `${d}. ${m}. ${y}.`;
    }
    const d = new Date(s);
    return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}.`;
  }

  // ISO vrijeme -> '13. 11. 2026. u 18:55'
  function datumVrijeme(iso) {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return datum(iso);
    return `${datum(iso)} u ${vr(iso)}`;
  }

  // ISO <-> vrijednost polja <input type="datetime-local">
  function zaUnos(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${kljucDatuma(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const izUnosa = (v) => (v ? new Date(v).toISOString() : null);

  function dobIz(datumRodenja) {
    const s = new Date(D.sada);
    const [y, m, d] = datumRodenja.split('-').map(Number);
    const prosao = s.getMonth() + 1 > m || (s.getMonth() + 1 === m && s.getDate() >= d);
    return s.getFullYear() - y - (prosao ? 0 : 1);
  }

  const prazanProfil = () => ({
    datumRodenja: '', mbo: '', krvnaGrupa: '', mjesto: '', prijem: null, kontakt: {},
    alergije: [], bolesti: [], kucnaTerapija: [], hospitalizacije: [], pregledi: [], operacije: [],
    navike: '', napomena: ''
  });

  // Izmjene napravljene u demou (novi pacijenti, dopune profila, upisi) čuvaju se
  // u localStorage-u i primjenjuju na podatke iz data.js pri pokretanju.
  function primijeniIzmjene() {
    store.get('noviPacijenti', []).forEach((p) => { if (!pacijent(p.tag)) D.pacijenti.push(p); });
    const dodaci = store.get('profilDodaci', {});
    const klinika = store.get('klinika', {});
    D.pacijenti.forEach((p) => {
      p.profil = Object.assign(prazanProfil(), p.profil);
      Object.entries(dodaci[p.tag] || {}).forEach(([sekcija, lista]) => {
        p.profil[sekcija] = [...(p.profil[sekcija] || []), ...lista];
      });
      if (klinika[p.tag]) Object.assign(p, klinika[p.tag]);
      normalizirajZapise(p);
    });
  }

  // Klinički zapisi koji se mogu upisivati, uređivati i brisati. Kad se pacijentu išta promijeni,
  // sprema se cijela kopija tih polja, pa izmjene i brisanja vrijede i za zapise iz data.js.
  const KLINICKA_POLJA = ['stanje', 'stanjePovijest', 'terapija', 'primjene', 'nalazi', 'vitali', 'biljeske', 'zadaci', 'akoOnda'];

  function spremiKliniku(p) {
    const sve = store.get('klinika', {});
    sve[p.tag] = Object.fromEntries(KLINICKA_POLJA.map((f) => [f, p[f]]));
    store.set('klinika', sve);
    delete aiSazeci[p.tag];
  }

  // Zapisi iz data.js nemaju podatak tko ih je i kada upisao: uzima se vrijeme samog zapisa.
  function normalizirajZapise(p) {
    const pocetak = D.smjena.od;
    const ranije = (a, b) => (new Date(a) < new Date(b) ? a : b);
    ['terapija', 'primjene', 'nalazi', 'vitali', 'biljeske', 'zadaci', 'akoOnda'].forEach((f) => { p[f] = p[f] || []; });
    p.vitali.forEach((x) => { x.upisano = x.upisano || x.vrijeme; });
    p.nalazi.forEach((x) => { x.upisano = x.upisano || x.stiglo || x.naruceno; });
    p.terapija.forEach((x) => { x.upisano = x.upisano || x.od; });
    p.primjene.forEach((x) => { x.upisano = x.upisano || x.vrijeme; });
    p.biljeske.forEach((x) => {
      x.upisano = x.upisano || x.vrijeme;
      x.upisao = x.upisao || x.autor;
      x.vrsta = x.vrsta || (rola(djelatnik(x.autor)) === 'sestra' ? 'sestrinska' : 'vizita');
    });
    p.zadaci.forEach((x) => { x.upisano = x.upisano || ranije(x.rok, pocetak); });
    p.akoOnda.forEach((x) => { x.upisano = x.upisano || pocetak; });
    if (!p.stanjePovijest) {
      const prijem = p.profil.prijem;
      p.stanjePovijest = [{
        id: 's1', stanje: p.stanje,
        upisano: prijem ? (/^\d{4}-\d{2}-\d{2}$/.test(prijem) ? new Date(prijem + 'T08:00').toISOString() : prijem) : pocetak,
        upisao: p.dodao || null, napomena: 'stanje pri prijemu'
      }];
    }
  }

  const biljeskeUzKrevet = (tag) => store.get('biljeske', {})[tag] || [];
  const preuzimanja = () => store.get('preuzimanja', {});

  function zabiljezi(akcija, tag, detalj) {
    const k = korisnik();
    const log = store.get('zapisnik', []);
    log.unshift({ u: new Date().toISOString(), tko: k ? k.id : null, akcija, tag: tag || null, detalj: detalj || '' });
    store.set('zapisnik', log.slice(0, 300));
  }

  function obavijest(tekst) {
    const el = document.getElementById('obavijest');
    el.textContent = tekst;
    el.classList.add('vidljivo');
    clearTimeout(obavijest.t);
    obavijest.t = setTimeout(() => el.classList.remove('vidljivo'), 3200);
  }

  // ---------- usmjeravanje ----------
  function ruta() {
    const h = location.hash.replace(/^#/, '');
    if (h.includes('=')) {
      const par = new URLSearchParams(h);
      if (par.get('p')) return { ime: 'kartica', tag: par.get('p'), nfc: par.get('nfc') === '1' };
      if (par.get('profil')) return { ime: 'profil', tag: par.get('profil') };
      if (par.get('unos')) return { ime: 'unos', tag: par.get('unos'), s: par.get('s') || 'vitali' };
    }
    return { ime: h || 'odjel' };
  }

  function idi(hash) {
    if (location.hash === '#' + hash) render();
    else location.hash = hash;
  }

  function prikazi(html, zadrziPolozaj) {
    const y = window.scrollY;
    app.innerHTML = html;
    if (zadrziPolozaj) { window.scrollTo(0, y); return; }
    window.scrollTo(0, 0);
    const f = app.querySelector('[data-fokus]');
    if (f) f.focus();
  }

  function render(zadrziPolozaj) {
    N.zaustavi();
    zatvoriSloj();
    const r = ruta();
    const k = korisnik();
    if (r.ime !== 'profil') zadnjiProfil = null;
    if (!(r.ime === 'unos' && uredjivanje && uredjivanje.tag === r.tag && uredjivanje.sekcija === r.s)) uredjivanje = null;

    if (!k) {
      if (r.ime !== 'prijava' && r.ime !== 'odjel') store.set('nakonPrijave', location.hash);
      return prikazi(ekranPrijava());
    }
    if (r.ime === 'kartica') return prikazi(ekranKartica(r, k), zadrziPolozaj);
    if (r.ime === 'profil') return prikazi(ekranProfil(r, k), zadrziPolozaj);
    if (r.ime === 'unos') return prikazi(ekranUnos(r, k), zadrziPolozaj);
    if (r.ime === 'zapisnik') return prikazi(ekranZapisnik(k));
    if (r.ime === 'narukvice') return prikazi(ekranNarukvice(k));
    if (r.ime === 'novi-pacijent' && ima(k, 'prijem')) return prikazi(ekranNoviPacijent(k));
    return prikazi(ekranOdjel(k), zadrziPolozaj);
  }

  // ---------- zajednički dijelovi ----------
  function zaglavlje(k, aktivno) {
    const veza = (h, t) => h === aktivno
      ? `<span aria-current="page">${t}</span>`
      : `<a href="#${h}">${t}</a>`;
    return `
      <header class="zaglavlje">
        <div>
          <p class="odjel">${esc(D.odjeli[k.odjel])}</p>
          <p class="tiho">${esc(k.ime)}, ${esc(k.uloga)}</p>
        </div>
        <nav aria-label="Glavni izbornik">
          ${veza('odjel', 'Odjel')}
          ${veza('narukvice', 'Narukvice')}
          ${veza('zapisnik', 'Zapisnik')}
          <button type="button" class="poveznica" data-akcija="odjava">Odjava</button>
        </nav>
      </header>`;
  }

  const valovi = (aktivno) =>
    `<div class="valovi${aktivno ? ' aktivno' : ''}" aria-hidden="true"><span></span><span></span><span></span></div>`;

  // ---------- ekran: prijava ----------
  function ekranPrijava() {
    return `
      <main class="prijava">
        ${valovi(false)}
        <h1>Primopredaja smjene</h1>
        <p class="tiho">Prijavite se PIN-om. Vidjet ćete samo pacijente svog odjela.</p>
        <form id="forma-prijava" autocomplete="off">
          <label for="pin">PIN</label>
          <input id="pin" name="pin" type="password" inputmode="numeric" maxlength="6" required data-fokus>
          <p class="greska" id="greska-prijava" role="alert"></p>
          <button class="gumb" type="submit">Prijavi se</button>
        </form>
        <p class="demo-napomena">
          Demo PIN-ovi: 2222 dr. Radić (liječnik, Interna B), 3333 sestra Tomić (Interna B),
          4444 dr. Grgić s kirurgije (za test odbijenog pristupa).
          Svi podaci u aplikaciji su izmišljeni.
        </p>
      </main>`;
  }

  // ---------- ekran: odjel ----------
  function stanjePacijenta(p) {
    const upoz = P.upozorenja(p, D.sada, biljeskeUzKrevet(p.tag));
    return { upoz, razina: P.procjena(p, upoz) };
  }

  function pacijentiOdjela(odjel) {
    return D.pacijenti
      .filter((p) => p.odjel === odjel)
      .map((p) => ({ p, ...stanjePacijenta(p) }))
      .sort((a, b) => b.razina - a.razina || a.p.soba.localeCompare(b.p.soba) || a.p.krevet.localeCompare(b.p.krevet));
  }

  function ekranOdjel(k) {
    const pre = preuzimanja();
    const lista = pacijentiOdjela(k.odjel);
    const preuzeto = lista.filter((x) => pre[x.p.tag]).length;
    const posto = lista.length ? Math.round((preuzeto / lista.length) * 100) : 0;
    const redovi = redoviPacijenata(lista, pre);
    return ekranOdjelHtml(k, lista, preuzeto, posto, redovi);
  }

  function redoviPacijenata(lista, pre) {
    return lista.map(({ p, upoz, razina }) => {
      const zaPotvrdu = upoz.filter((u) => u.razina !== 'info').length;
      const prx = pre[p.tag];
      const oznaka = prx
        ? `<span class="oznaka ok">Preuzeto u ${vr(prx.u)}</span>`
        : zaPotvrdu
          ? `<span class="oznaka ${razina === 2 ? 'kriticno' : 'upoz'}">${zaPotvrdu} ${zaPotvrdu === 1 ? 'upozorenje' : 'upozorenja'}</span>`
          : '<span class="oznaka tiho-oznaka">Bez upozorenja</span>';
      return `
        <li class="razina-${razina}">
          <button type="button" class="red" data-akcija="otvori" data-tag="${esc(p.tag)}">
            <span class="rizik" aria-hidden="true"></span>
            <span class="krevet">${esc(p.soba)}/${esc(p.krevet)}</span>
            <span class="red-tekst">
              <strong>${esc(p.ime)}</strong>, ${p.dob}
              <span class="tiho red-dg">${esc(p.dg)}</span>
              <span class="nevidljivo">${P.RAZINE[razina]}.</span>
            </span>
            ${oznaka}
          </button>
        </li>`;
    }).join('');
  }

  function ekranOdjelHtml(k, lista, preuzeto, posto, redovi) {
    return `
      ${zaglavlje(k, 'odjel')}
      <main>
        <button type="button" class="sken-gumb" data-akcija="skeniraj" data-fokus>
          ${valovi(false)}
          <span>
            <strong class="sken-naslov">Skeniraj narukvicu</strong>
            <span class="tiho">Prislonite mobitel na narukvicu pacijenta uz krevet</span>
          </span>
        </button>

        <section aria-labelledby="napredak-naslov" class="napredak">
          <h2 id="napredak-naslov">Preuzeto ${preuzeto} od ${lista.length} pacijenata</h2>
          <div class="traka" role="progressbar" aria-valuemin="0" aria-valuemax="${lista.length}" aria-valuenow="${preuzeto}">
            <span style="width:${posto}%"></span>
          </div>
          <p class="tiho mali-tekst">Kraj smjene u ${vr(D.smjena.do)}. Poredano po hitnosti.</p>
        </section>

        <div class="traka-alata">
          <h2>Pacijenti na odjelu</h2>
          ${ima(k, 'prijem') ? '<a class="gumb sporedni mali" href="#novi-pacijent">+ Novi pacijent</a>' : ''}
        </div>
        ${lista.length ? `<ol class="pacijenti">${redovi}</ol>` : '<p class="tiho">Na odjelu nema pacijenata.</p>'}

        <p class="dno">
          <button type="button" class="poveznica" data-akcija="reset">Nova primopredaja (obriši preuzimanja, potvrde i bilješke)</button><br>
          <button type="button" class="poveznica" data-akcija="demo-podaci">Vrati početne demo podatke (obriši sve, i zapisnik)</button>
        </p>
      </main>`;
  }

  // ---------- ekran: kartica pacijenta (I-PASS) ----------
  // Vraća HTML poruke ako djelatnik ne smije vidjeti pacijenta, inače null
  function odbijenPristup(r, k) {
    const p = pacijent(r.tag);
    if (!p) {
      zabiljezi('nepoznata narukvica', r.tag);
      return ekranPoruka(k, 'Nepoznata narukvica',
        `Narukvica s ID-em ${esc(r.tag)} nije povezana ni s jednim pacijentom. Provjerite narukvicu ili je ponovno zapišite.`);
    }
    if (!vidiPacijenta(k, p)) {
      if (r.nfc || !pristup['odbijeno-' + p.tag]) {
        pristup['odbijeno-' + p.tag] = true;
        zabiljezi('odbijen pristup', p.tag, `pacijent nije na odjelu ${k.odjel}`);
        if (r.nfc) history.replaceState(null, '', '#p=' + encodeURIComponent(p.tag));
      }
      return ekranPoruka(k, 'Nemate pristup ovom pacijentu',
        'Pacijent nije na vašem odjelu, pa njegovi podaci nisu prikazani. Pokušaj pristupa je zabilježen u zapisniku.');
    }
    return null;
  }

  function alergijeTrakaHtml(p) {
    const al = p.profil.alergije;
    return al.length
      ? `<p class="alergije-traka"><strong>Alergije:</strong> ${al.map((a) =>
          esc(a.tvar) + (a.reakcija ? ` (${esc(a.reakcija)})` : '')).join(', ')}</p>`
      : '<p class="alergije-traka nema">Nema zabilježenih alergija</p>';
  }

  function ekranKartica(r, k) {
    const odbijeno = odbijenPristup(r, k);
    if (odbijeno) return odbijeno;
    const p = pacijent(r.tag);

    // Način pristupa: skeniranjem ili ručno. Bilježi se jednom po otvaranju.
    if (r.nfc) {
      pristup[p.tag] = { nacin: 'nfc', u: sadaZaZapis() };
      zabiljezi('skenirana narukvica', p.tag);
      history.replaceState(null, '', '#p=' + encodeURIComponent(p.tag));
    } else if (!pristup[p.tag]) {
      pristup[p.tag] = { nacin: 'rucno', u: sadaZaZapis() };
      zabiljezi('kartica otvorena ručno', p.tag, 'bez skeniranja narukvice');
    }
    const nacin = pristup[p.tag];

    const dodatne = biljeskeUzKrevet(p.tag);
    const upoz = P.upozorenja(p, D.sada, dodatne);
    const razina = P.procjena(p, upoz);
    const pre = preuzimanja()[p.tag];
    if (!potvrde[p.tag]) potvrde[p.tag] = new Set(pre ? pre.potvrdena : []);
    const potvrdeno = potvrde[p.tag];
    const zaPotvrdu = upoz.filter((u) => u.razina !== 'info');
    const info = upoz.filter((u) => u.razina === 'info');
    const brojPotvrdenih = zaPotvrdu.filter((u) => potvrdeno.has(u.id)).length;
    const sveSpremno = brojPotvrdenih === zaPotvrdu.length;
    const izvorGumb = (id) =>
      `<button type="button" class="izvor" data-akcija="izvor" data-id="${esc(id)}">izvor ${esc(id)}</button>`;

    // P: sažetak
    const ai = aiSazeci[p.tag];
    const lokalni = P.sazetak(p, dodatne);
    const sazetakHtml = ai
      ? `<p class="ai-oznaka">AI nacrt. Prije preuzimanja provjerite izvore.</p>
         <p>${esc(ai.sazetak)}</p>
         <p class="izvori">${ai.izvori.map(izvorGumb).join(' ')}</p>`
      : `<p>${esc(lokalni.tekst)}</p>
         <p class="izvori">${lokalni.izvori.map(izvorGumb).join(' ')}</p>`;
    const aiGumb = aiDostupan
      ? `<button type="button" class="gumb sporedni mali" data-akcija="ai" data-tag="${esc(p.tag)}">${ai ? 'Ponovno napravi AI sažetak' : 'Napravi AI sažetak'}</button>`
      : `<p class="tiho mali-tekst">Sažetak je složen iz pravila. AI sažetak radi kad je pokrenut lokalni poslužitelj (vidi README).</p>`;

    // A: akcijska lista
    const akcije = P.akcije(p, D.sada);
    const akcijeHtml = akcije.length
      ? `<ul class="akcije">${akcije.map((a) => `
          <li class="${a.kasni ? 'kasni' : ''}">
            <span class="akcija-vrijeme">${a.rok ? kada(a.rok) : 'čim stigne'}</span>
            <span>${esc(a.tekst)}${a.kasni ? ' <strong>(kasni)</strong>' : ''} ${izvorGumb(a.izvor)}</span>
          </li>`).join('')}</ul>`
      : '<p class="tiho">Nema zadataka za sljedeću smjenu.</p>';

    // S: plan za moguće situacije
    const planHtml = p.akoOnda.length
      ? `<ul class="plan">${p.akoOnda.map((a) => `
          <li><strong>Ako ${esc(a.ako)}:</strong> ${esc(a.onda)}</li>`).join('')}</ul>`
      : '<p class="tiho">Nema upisanog plana.</p>';

    // S: upozorenja i preuzimanje
    const upozHtml = zaPotvrdu.length
      ? `<ul class="upozorenja">${zaPotvrdu.map((u) => {
          const ok = potvrdeno.has(u.id);
          return `
            <li class="upoz-stavka ${u.razina}${ok ? ' potvrdeno' : ''}">
              <div>
                <strong>${u.razina === 'kriticno' ? 'Kritično: ' : ''}${esc(u.naslov)}</strong>
                <p>${esc(u.detalj)} ${izvorGumb(u.izvor)}</p>
              </div>
              ${pre ? '' : ok
                ? `<button type="button" class="gumb sporedni mali" data-akcija="odpotvrdi" data-tag="${esc(p.tag)}" data-id="${esc(u.id)}" aria-label="Poništi potvrdu: ${esc(u.naslov)}">Potvrđeno</button>`
                : `<button type="button" class="gumb mali" data-akcija="potvrdi" data-tag="${esc(p.tag)}" data-id="${esc(u.id)}">Potvrdi</button>`}
            </li>`;
        }).join('')}</ul>`
      : '<p class="ok-tekst">Nema upozorenja koja treba potvrditi.</p>';

    const infoHtml = info.length
      ? `<ul class="info-lista">${info.map((u) => `<li>${esc(u.naslov)}. ${esc(u.detalj)}.</li>`).join('')}</ul>`
      : '';

    const preuzimanjeHtml = pre
      ? `<div class="preuzeto">
           <p><strong>Preuzeo/la ${esc(imeDjelatnika(pre.tko))} u ${vr(pre.u)}</strong>,
           ${pre.nacin === 'nfc' ? 'uz skeniranje narukvice' : 'bez skeniranja narukvice'}.</p>
           <button type="button" class="poveznica" data-akcija="ponisti" data-tag="${esc(p.tag)}">Poništi preuzimanje</button>
         </div>`
      : `<button type="button" class="gumb preuzmi" data-akcija="preuzmi" data-tag="${esc(p.tag)}" ${sveSpremno ? '' : 'disabled'}>Preuzmi pacijenta</button>
         ${sveSpremno ? '' : `<p class="tiho mali-tekst">Potvrdite sva upozorenja (${brojPotvrdenih} od ${zaPotvrdu.length}).</p>`}
         ${nacin.nacin === 'rucno' ? '<p class="tiho mali-tekst">Kartica je otvorena ručno. Za potvrdu identiteta skenirajte narukvicu uz krevet.</p>' : ''}`;

    // Izvorni zapisi
    const zapisi = P.zapisi(p, dodatne, imeDjelatnika);
    const zapisiHtml = zapisi.map((z) => `
      <li id="zapis-${esc(z.id)}">
        <span class="zapis-id">${esc(z.id)}</span>
        <span><strong>${esc(z.vrsta)}</strong>${z.vrijeme ? `, ${kada(z.vrijeme)}` : ''}<br>${esc(z.tekst)}</span>
      </li>`).join('');

    return `
      <header class="kartica-zaglavlje razina-${razina}">
        <a href="#odjel" class="natrag">Natrag na odjel</a>
        <p class="tiho">Soba ${esc(p.soba)}, krevet ${esc(p.krevet)}</p>
        <h1 data-fokus tabindex="-1">${esc(p.ime)}, ${p.dob}</h1>
        <p>${esc(p.dg)}</p>
        <p class="identitet ${nacin.nacin}">
          ${nacin.nacin === 'nfc'
            ? `Identitet potvrđen narukvicom u ${vr(nacin.u)}`
            : 'Otvoreno ručno, bez skeniranja narukvice'}
        </p>
        ${alergijeTrakaHtml(p)}
        <p class="mali-tekst"><a href="#profil=${encodeURIComponent(p.tag)}">Profil pacijenta i povijest bolesti</a></p>
        ${navigacijaUnosaHtml(p, null, k)}
      </header>

      <main>
        <ol class="ipass">
          <li>
            <span class="slovo" aria-hidden="true">I</span>
            <div>
              <h2>Težina stanja</h2>
              <p class="razina-tekst r${razina}">${P.RAZINE[razina]}</p>
              ${razina > (({ stabilan: 0, nadzor: 1, nestabilan: 2 })[p.stanje] ?? 0)
                ? '<p class="tiho mali-tekst">Procjena je viša od upisane jer postoje upozorenja.</p>' : ''}
            </div>
          </li>
          <li>
            <span class="slovo" aria-hidden="true">P</span>
            <div>
              <h2>Sažetak pacijenta</h2>
              <div id="sazetak">${sazetakHtml}</div>
              ${aiGumb}
            </div>
          </li>
          <li>
            <span class="slovo" aria-hidden="true">A</span>
            <div>
              <h2>Akcijska lista za sljedeću smjenu</h2>
              ${akcijeHtml}
            </div>
          </li>
          <li>
            <span class="slovo" aria-hidden="true">S</span>
            <div>
              <h2>Plan za moguće situacije</h2>
              ${planHtml}
            </div>
          </li>
          <li>
            <span class="slovo" aria-hidden="true">S</span>
            <div>
              <h2>Provjera i preuzimanje</h2>
              ${upozHtml}
              ${infoHtml}
              <form id="forma-biljeska" data-tag="${esc(p.tag)}">
                <label for="biljeska">Bilješka uz krevet</label>
                <textarea id="biljeska" name="biljeska" rows="3" placeholder="Npr. bolesnik pospan, javiti ako se pogorša"></textarea>
                <button type="submit" class="gumb sporedni mali">Spremi bilješku</button>
              </form>
              <div class="preuzimanje">${preuzimanjeHtml}</div>
            </div>
          </li>
        </ol>

        <details class="izvorni" id="izvorni">
          <summary>Izvorni zapisi (${zapisi.length})</summary>
          <ul class="zapisi">${zapisiHtml}</ul>
        </details>
      </main>`;
  }

  // ---------- ekran: upis podataka (vitalni znakovi, nalazi, terapija, bilješke ...) ----------
  // Svaka vrsta zapisa opisana je jednom konfiguracijom: polja obrasca, pravo potrebno za
  // upis, uređivanje i brisanje te tekst zapisa (za prikaz i zapisnik).
  const STANJA = { stabilan: 'stabilan', nadzor: 'pojačan nadzor', nestabilan: 'nestabilan' };
  const brojHr = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
  const izvanRef = (x) => typeof x.vrijednost === 'number' && Array.isArray(x.ref) &&
    (x.vrijednost < x.ref[0] || x.vrijednost > x.ref[1]);
  const opisNalaza = (x) => (typeof x.vrijednost === 'number'
    ? `${brojHr(x.vrijednost)} ${x.jedinica || ''}${x.ref ? ` (ref. ${brojHr(x.ref[0])}–${brojHr(x.ref[1])})` : ''}`.trim()
    : '') + (x.opis ? (typeof x.vrijednost === 'number' ? ', ' : '') + x.opis : '');
  const oznakaHtml = (vrsta, tekst) => `<span class="oznaka ${vrsta}">${esc(tekst)}</span>`;
  const VRSTE_BILJESKI = { vizita: 'iz vizite', sestrinska: 'sestrinska', krevet: 'uz krevet' };

  const UNOS = {
    vitali: {
      naslov: 'Vitalni znakovi', jednina: 'vitalni znakovi', pref: 'v', pravo: 'vitali',
      vrijeme: (x) => x.vrijeme,
      polja: [
        { k: 'vrijeme', l: 'Vrijeme mjerenja', tip: 'datetime-local', obavezno: true },
        { k: 'fp', l: 'Srčana frekvencija (/min)', tip: 'number', min: 20, max: 250, obavezno: true },
        { k: 'sys', l: 'Sistolički tlak (mmHg)', tip: 'number', min: 40, max: 300, obavezno: true },
        { k: 'dia', l: 'Dijastolički tlak (mmHg)', tip: 'number', min: 20, max: 200, obavezno: true },
        { k: 'spo2', l: 'Saturacija SpO2 (%)', tip: 'number', min: 50, max: 100, obavezno: true },
        { k: 'temp', l: 'Temperatura (°C)', tip: 'number', min: 30, max: 43, korak: '0.1', obavezno: true },
        { k: 'fd', l: 'Frekvencija disanja (/min)', tip: 'number', min: 4, max: 60, obavezno: true }
      ],
      tekst: (x) => `FP ${x.fp}/min, RR ${x.sys}/${x.dia} mmHg, SpO2 ${x.spo2} %, T ${brojHr(x.temp)} °C, FD ${x.fd}/min`
    },
    nalazi: {
      naslov: 'Nalazi', jednina: 'nalaz', pref: 'n', pravo: 'nalazi',
      vrijeme: (x) => x.stiglo || x.naruceno,
      polja: [
        { k: 'naziv', l: 'Pretraga', obavezno: true, placeholder: 'npr. Kalij (K+), RTG srca i pluća' },
        { k: 'naruceno', l: 'Naručeno', tip: 'datetime-local', obavezno: true },
        { k: 'stiglo', l: 'Nalaz stigao', tip: 'datetime-local', napomena: 'Ostavite prazno ako se nalaz još čeka.' },
        { k: 'vrijednost', l: 'Brojčana vrijednost', tip: 'number', korak: 'any' },
        { k: 'jedinica', l: 'Jedinica', placeholder: 'npr. mmol/L' },
        { k: 'refOd', l: 'Referentni raspon od', tip: 'number', korak: 'any' },
        { k: 'refDo', l: 'Referentni raspon do', tip: 'number', korak: 'any' },
        { k: 'opis', l: 'Opisni nalaz', tip: 'textarea', placeholder: 'za nalaze bez brojčane vrijednosti, npr. opis radiologa' }
      ],
      ucitaj: (x) => ({ refOd: x.ref ? x.ref[0] : null, refDo: x.ref ? x.ref[1] : null }),
      spremi: (v, staro) => {
        const ref = v.refOd !== null && v.refDo !== null ? [v.refOd, v.refDo] : null;
        delete v.refOd; delete v.refDo;
        return { ...v, ref, pregledao: staro ? staro.pregledao : null };
      },
      tekst: (x) => `${x.naziv}: ${x.stiglo ? (opisNalaza(x) || 'stigao') : 'na čekanju'}`,
      oznake: (x) => !x.stiglo ? oznakaHtml('tiho-oznaka', 'čeka se')
        : (izvanRef(x) ? oznakaHtml('kriticno', 'izvan raspona') + ' ' : '') +
          (x.pregledao ? oznakaHtml('ok', `pregledao/la ${imeDjelatnika(x.pregledao)}`) : oznakaHtml('upoz', 'nije pregledan')),
      dodatno: (x, p, k) => x.stiglo && !x.pregledao && ima(k, 'nalazi')
        ? `<button type="button" class="gumb mali" data-akcija="nalaz-pregledan" data-tag="${esc(p.tag)}" data-id="${esc(x.id)}">Označi pregledanim</button>` : ''
    },
    terapija: {
      naslov: 'Terapija', jednina: 'terapija', pref: 't', pravo: 'terapija',
      vrijeme: (x) => x.promjenaU || x.od,
      polja: [
        { k: 'lijek', l: 'Lijek', obavezno: true },
        { k: 'doza', l: 'Doza, put i učestalost primjene', obavezno: true, placeholder: 'npr. 40 mg i.v. svakih 12 h' },
        { k: 'od', l: 'Početak primjene', tip: 'datetime-local', obavezno: true },
        { k: 'promjena', l: 'Napomena o promjeni', placeholder: 'npr. uveden, doza smanjena s 40 mg' }
      ],
      spremi: (v, staro) => {
        if (!staro) return { ...v, promjena: v.promjena || 'uveden' };
        if (staro.doza === v.doza) return v;
        // Promjena doze pokreće upozorenje dok se ne spomene u bilješci
        const promjena = v.promjena === (staro.promjena || '') ? `doza promijenjena (bilo: ${staro.doza})` : v.promjena;
        return { ...v, promjena, promjenaU: sadaZaZapis() };
      },
      tekst: (x) => `${x.lijek} ${x.doza}${x.promjena ? ` (${x.promjena})` : ''}`,
      oznake: (x) => `<span class="tiho mali-tekst">od ${esc(datumVrijeme(x.od))}</span>`
    },
    primjene: {
      naslov: 'Primjena lijekova', kratko: 'Primjena lijekova', jednina: 'primjena lijeka', pref: 'm', pravo: 'primjena',
      vrijeme: (x) => x.vrijeme,
      polja: [
        { k: 'terapijaId', l: 'Lijek iz propisane terapije', tip: 'select', obavezno: true,
          opcije: (p) => p.terapija.map((t) => ({ v: t.id, l: `${t.lijek} ${t.doza}` })) },
        { k: 'vrijeme', l: 'Vrijeme primjene', tip: 'datetime-local', obavezno: true },
        { k: 'status', l: 'Status', tip: 'select', obavezno: true, zadano: () => 'primijenjeno',
          opcije: () => ['primijenjeno', 'pacijent odbio', 'odgođeno', 'nije primijenjeno'].map((s) => ({ v: s, l: s })) },
        { k: 'napomena', l: 'Napomena', placeholder: 'npr. mjesto primjene, razlog odgode' }
      ],
      spremi: (v, staro, p) => {
        const t = p.terapija.find((x) => x.id === v.terapijaId);
        return { ...v, lijek: t ? t.lijek : (staro || {}).lijek, doza: t ? t.doza : (staro || {}).doza };
      },
      tekst: (x) => `${x.lijek} ${x.doza}: ${x.status}${x.napomena ? `, ${x.napomena}` : ''}`,
      oznake: (x) => oznakaHtml(x.status === 'primijenjeno' ? 'ok' : 'upoz', x.status),
      bezUnosa: (p) => (p.terapija.length ? '' : 'Pacijent nema propisane terapije. Terapiju propisuje liječnik.')
    },
    biljeske: {
      naslov: 'Bilješke', jednina: 'bilješka', pref: 'b',
      // Liječnik piše i uređuje bilješke iz vizite, sestra sestrinske; bilješke uz krevet su dio primopredaje
      pravo: (k, x) => (x ? x.vrsta !== 'krevet' && ima(k, x.vrsta) : ima(k, 'vizita') || ima(k, 'sestrinska')),
      naslovForme: (k) => (ima(k, 'vizita') ? 'bilješka iz vizite' : 'sestrinska bilješka'),
      lista: (p) => [...p.biljeske, ...biljeskeUzKrevet(p.tag).map((b) => ({ ...b, vrsta: 'krevet', upisano: b.vrijeme, upisao: b.autor }))],
      vrijeme: (x) => x.vrijeme,
      polja: [
        { k: 'vrijeme', l: 'Vrijeme', tip: 'datetime-local', obavezno: true },
        { k: 'tekst', l: 'Bilješka', tip: 'textarea', obavezno: true }
      ],
      spremi: (v, staro, p, k) => ({
        ...v,
        autor: staro ? staro.autor : k.id,
        vrsta: staro ? staro.vrsta : (ima(k, 'vizita') ? 'vizita' : 'sestrinska')
      }),
      tekst: (x) => x.tekst,
      oznake: (x) => oznakaHtml(x.vrsta === 'vizita' ? 'ok' : 'tiho-oznaka', VRSTE_BILJESKI[x.vrsta] || 'bilješka') +
        ` <span class="tiho mali-tekst">${esc(imeDjelatnika(x.autor))}</span>`
    },
    zadaci: {
      naslov: 'Zadaci', jednina: 'zadatak', pref: 'z', pravo: 'zadaci', uzlazno: true,
      vrijeme: (x) => x.rok,
      polja: [
        { k: 'opis', l: 'Zadatak', obavezno: true, placeholder: 'npr. kontrola elektrolita' },
        { k: 'rok', l: 'Rok', tip: 'datetime-local', obavezno: true }
      ],
      tekst: (x) => x.opis,
      oznake: (x) => x.gotovo
        ? oznakaHtml('ok', `obavljeno${x.obavio ? ', ' + imeDjelatnika(x.obavio) : ''}`)
        : new Date(x.rok) < new Date(D.sada) ? oznakaHtml('kriticno', 'kasni') : '',
      dodatno: (x, p, k) => ima(k, 'zadaci')
        ? `<button type="button" class="gumb ${x.gotovo ? 'sporedni ' : ''}mali" data-akcija="zadatak-gotovo" data-tag="${esc(p.tag)}" data-id="${esc(x.id)}">${x.gotovo ? 'Vrati na neobavljeno' : 'Označi obavljenim'}</button>` : ''
    },
    akoOnda: {
      naslov: 'Plan za moguće situacije', kratko: 'Plan', jednina: 'plan', pref: 'a', pravo: 'plan',
      vrijeme: (x) => x.upisano,
      polja: [
        { k: 'ako', l: 'Ako (situacija)', obavezno: true, placeholder: 'npr. saturacija ispod 90 %' },
        { k: 'onda', l: 'Onda (postupak)', obavezno: true, placeholder: 'npr. javiti dežurnom liječniku' }
      ],
      tekst: (x) => `Ako ${x.ako}: ${x.onda}`
    },
    stanje: {
      naslov: 'Stanje pacijenta', kratko: 'Stanje', jednina: 'procjena stanja', pref: 's', pravo: 'stanje',
      polje: 'stanjePovijest', nepromjenjivo: true,
      vrijeme: (x) => x.upisano,
      polja: [
        { k: 'stanje', l: 'Stanje', tip: 'select', obavezno: true, zadano: (p) => p.stanje,
          opcije: () => Object.entries(STANJA).map(([v, l]) => ({ v, l })) },
        { k: 'napomena', l: 'Obrazloženje', tip: 'textarea', placeholder: 'npr. hemodinamski stabilan, afebrilan' }
      ],
      tekst: (x) => `${STANJA[x.stanje] || x.stanje}${x.napomena ? `: ${x.napomena}` : ''}`,
      nakon: (p) => {
        const zadnje = [...p.stanjePovijest].sort((a, b) => new Date(b.upisano) - new Date(a.upisano))[0];
        if (zadnje) p.stanje = zadnje.stanje;
      }
    }
  };
  Object.entries(UNOS).forEach(([kljuc, c]) => { c.polje = c.polje || kljuc; });

  const dozvoljeno = (c, k, x) => (typeof c.pravo === 'function' ? c.pravo(k, x) : ima(k, c.pravo));
  const zapisiSekcije = (c, p) => (c.lista ? c.lista(p) : p[c.polje]);
  let uredjivanje = null; // { tag, sekcija, id } zapisa koji se uređuje

  function metaHtml(x) {
    const dijelovi = [`Upisano ${datumVrijeme(x.upisano)}${x.upisao ? `, ${imeDjelatnika(x.upisao)}` : ', iz bolničkog sustava'}`];
    if (x.izmijenjeno) dijelovi.push(`izmijenjeno ${datumVrijeme(x.izmijenjeno)}, ${imeDjelatnika(x.izmijenio)}`);
    return `<p class="meta">${esc(dijelovi.join(' · '))}</p>`;
  }

  // ID-evi se ne ponavljaju ni nakon brisanja, jer se na njih pozivaju upozorenja i izvori
  function noviId(p, lista, pref) {
    const brojaci = store.get('idBrojaci', {});
    const kljuc = `${p.tag}:${pref}`;
    const naj = lista.reduce((m, x) => {
      const r = new RegExp(`^${pref}(\\d+)$`).exec(x.id);
      return r ? Math.max(m, Number(r[1])) : m;
    }, brojaci[kljuc] || 0);
    brojaci[kljuc] = naj + 1;
    store.set('idBrojaci', brojaci);
    return pref + (naj + 1);
  }

  function navigacijaUnosaHtml(p, aktivno) {
    return `
      <nav class="unos-nav" aria-label="Zapisi pacijenta">
        <p class="tiho mali-tekst">${aktivno ? 'Vrsta zapisa' : 'Zapisi i upis podataka'}</p>
        <ul>${Object.entries(UNOS).map(([s, c]) => `
          <li><a href="#unos=${encodeURIComponent(p.tag)}&s=${s}" ${s === aktivno ? 'aria-current="page"' : ''}>${esc(c.kratko || c.naslov)}</a></li>`).join('')}
        </ul>
      </nav>`;
  }

  function formaZapisaHtml(c, sek, p, k, staro) {
    const vrijednosti = staro ? { ...staro, ...(c.ucitaj ? c.ucitaj(staro) : {}) } : {};
    const sada = zaUnos(sadaZaZapis());
    const polja = c.polja.map((f, i) => {
      const id = `u-${sek}-${f.k}`;
      let val = vrijednosti[f.k];
      if (f.tip === 'datetime-local') val = staro ? zaUnos(val) : (f.obavezno ? sada : '');
      if (!staro && f.zadano) val = f.zadano(p);
      val = val ?? '';
      const atr = `id="${id}" name="${f.k}" ${f.obavezno ? 'required' : ''} ${staro && i === 0 ? 'data-fokus' : ''}`;
      let unos;
      if (f.tip === 'select') {
        const opcije = f.opcije(p);
        unos = `<select ${atr}>
          ${(!f.zadano || !f.obavezno) ? `<option value="">${f.obavezno ? 'odaberite' : '—'}</option>` : ''}
          ${opcije.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}
        </select>`;
      } else if (f.tip === 'textarea') {
        unos = `<textarea ${atr} rows="3" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
      } else {
        unos = `<input ${atr} type="${f.tip || 'text'}" value="${esc(val)}" autocomplete="off"
          ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
          ${f.tip === 'number' ? `step="${f.korak || '1'}" inputmode="decimal"` : ''}
          placeholder="${esc(f.placeholder || '')}">`;
      }
      return `<div class="polje${f.tip === 'textarea' ? ' siroko' : ''}">
          <label for="${id}">${esc(f.l)}${f.obavezno ? '' : ' <span class="tiho">(neobavezno)</span>'}</label>
          ${unos}
          ${f.napomena ? `<span class="tiho mali-tekst">${esc(f.napomena)}</span>` : ''}
        </div>`;
    }).join('');
    const naslov = staro ? `Uredi: ${c.jednina}` : `Novi upis: ${c.naslovForme ? c.naslovForme(k) : c.jednina}`;
    return `
      <form class="forma forma-zapis${staro ? ' uredjivanje' : ''}" data-tag="${esc(p.tag)}" data-sekcija="${sek}" data-id="${staro ? esc(staro.id) : ''}" autocomplete="off">
        <h2>${esc(naslov)}</h2>
        <div class="polja-mreza">${polja}</div>
        <p class="tiho mali-tekst">${staro
          ? 'Izmjena se bilježi s vašim imenom, datumom i vremenom. Izvorni upis ostaje naveden.'
          : `Zapis će biti označen vašim imenom (${esc(k.ime)}) te datumom i vremenom upisa.`}</p>
        <div class="gumbi-red">
          <button type="submit" class="gumb mali">${staro ? 'Spremi izmjene' : 'Spremi'}</button>
          ${staro ? '<button type="button" class="gumb sporedni mali" data-akcija="odustani-uredi">Odustani</button>' : ''}
        </div>
      </form>`;
  }

  function ekranUnos(r, k) {
    const odbijeno = odbijenPristup(r, k);
    if (odbijeno) return odbijeno;
    const p = pacijent(r.tag);
    const sek = UNOS[r.s] ? r.s : 'vitali';
    const c = UNOS[sek];
    const smije = smijeMijenjati(k, p);
    const smjer = c.uzlazno ? 1 : -1;
    const stavke = [...zapisiSekcije(c, p)]
      .sort((a, b) => smjer * (new Date(c.vrijeme(a)) - new Date(c.vrijeme(b))));
    const ured = uredjivanje && uredjivanje.sekcija === sek ? p[c.polje].find((x) => x.id === uredjivanje.id) : null;

    let forma;
    if (!smije) {
      forma = '<p class="napomena">Pacijent nije na vašem odjelu.</p>';
    } else if (ured && dozvoljeno(c, k, ured)) {
      forma = formaZapisaHtml(c, sek, p, k, ured);
    } else if (!dozvoljeno(c, k, null)) {
      forma = `<p class="napomena">Vaša uloga ne uključuje upis: ${esc(c.naslov.toLowerCase())}. Zapise možete pregledavati.</p>`;
    } else if (c.bezUnosa && c.bezUnosa(p)) {
      forma = `<p class="napomena">${esc(c.bezUnosa(p))}</p>`;
    } else {
      forma = formaZapisaHtml(c, sek, p, k, null);
    }

    const lista = stavke.length
      ? `<ol class="zapis-lista">${stavke.map((x) => {
          const mozeMijenjati = smije && !c.nepromjenjivo && dozvoljeno(c, k, x);
          const gumbi = [
            smije && c.dodatno ? c.dodatno(x, p, k) : '',
            mozeMijenjati ? `<button type="button" class="gumb sporedni mali" data-akcija="uredi-zapis" data-tag="${esc(p.tag)}" data-sekcija="${sek}" data-id="${esc(x.id)}">Uredi</button>` : '',
            mozeMijenjati ? `<button type="button" class="poveznica opasno" data-akcija="obrisi-zapis" data-tag="${esc(p.tag)}" data-sekcija="${sek}" data-id="${esc(x.id)}">Obriši</button>` : ''
          ].filter(Boolean).join('');
          return `
            <li class="zapis-stavka${ured && ured.id === x.id ? ' istaknuto' : ''}" id="zs-${esc(x.id)}">
              <div class="zapis-glava">
                <span class="zapis-vrijeme">${esc(datumVrijeme(c.vrijeme(x)))}</span>
                <span class="zapis-id">${esc(x.id)}</span>
                ${c.oznake ? c.oznake(x) : ''}
              </div>
              <p class="zapis-tekst">${esc(c.tekst(x, p))}</p>
              ${metaHtml(x)}
              ${gumbi ? `<div class="zapis-gumbi">${gumbi}</div>` : ''}
            </li>`;
        }).join('')}</ol>`
      : `<p class="tiho">Nema zapisa: ${esc(c.naslov.toLowerCase())}.</p>`;

    return `
      ${zaglavlje(k, '')}
      <header class="profil-zaglavlje">
        <a href="#p=${encodeURIComponent(p.tag)}" class="natrag">Natrag na karticu za primopredaju</a>
        <p class="tiho">${esc(D.odjeli[p.odjel] || p.odjel)}, soba ${esc(p.soba)}, krevet ${esc(p.krevet)} ·
          <a href="#profil=${encodeURIComponent(p.tag)}">Profil</a></p>
        <h1 ${ured ? '' : 'data-fokus'} tabindex="-1">${esc(p.ime)}, ${p.dob}: ${esc(c.naslov.toLowerCase())}</h1>
        ${alergijeTrakaHtml(p)}
        ${navigacijaUnosaHtml(p, sek)}
      </header>
      <main>
        <section class="unos-forma">${forma}</section>
        <section aria-labelledby="zapisi-naslov">
          <h2 id="zapisi-naslov">Upisano (${stavke.length})</h2>
          ${lista}
        </section>
      </main>`;
  }

  function spremiZapis(f, k) {
    const p = pacijent(f.dataset.tag);
    const sek = f.dataset.sekcija;
    const c = UNOS[sek];
    if (!p || !c || !smijeMijenjati(k, p)) return;
    const lista = p[c.polje];
    const staro = f.dataset.id ? lista.find((x) => x.id === f.dataset.id) : null;
    if (f.dataset.id && (!staro || c.nepromjenjivo)) return;
    if (!dozvoljeno(c, k, staro)) return;

    let v = {};
    c.polja.forEach((x) => {
      const raw = (f.elements[x.k].value || '').trim();
      v[x.k] = x.tip === 'number' ? (raw === '' ? null : Number(raw))
        : x.tip === 'datetime-local' ? izUnosa(raw) : raw;
    });
    if (c.spremi) v = c.spremi(v, staro, p, k);
    const sada = sadaZaZapis();
    if (staro) {
      Object.assign(staro, v, { izmijenio: k.id, izmijenjeno: sada });
      zabiljezi('izmjena zapisa', p.tag, `${c.naslov}: ${c.tekst(staro, p)}`);
      obavijest('Izmjena je spremljena.');
    } else {
      const novi = { id: noviId(p, lista, c.pref), ...v, upisao: k.id, upisano: sada };
      lista.push(novi);
      zabiljezi('novi zapis', p.tag, `${c.naslov}: ${c.tekst(novi, p)}`);
      obavijest(`Upisano ${datumVrijeme(sada)}.`);
    }
    if (c.nakon) c.nakon(p);
    spremiKliniku(p);
    uredjivanje = null;
    render(true);
  }

  function obrisiZapis(tag, sek, id, k) {
    const p = pacijent(tag);
    const c = UNOS[sek];
    if (!p || !c || c.nepromjenjivo || !smijeMijenjati(k, p)) return;
    const x = p[c.polje].find((z) => z.id === id);
    if (!x || !dozvoljeno(c, k, x)) return;
    if (!confirm(`Obrisati zapis?\n\n${c.tekst(x, p)}\n\nBrisanje se bilježi u zapisniku.`)) return;
    p[c.polje] = p[c.polje].filter((z) => z.id !== id);
    if (c.nakon) c.nakon(p);
    spremiKliniku(p);
    zabiljezi('obrisan zapis', tag, `${c.naslov}: ${c.tekst(x, p)}`);
    if (uredjivanje && uredjivanje.id === id) uredjivanje = null;
    obavijest('Zapis je obrisan.');
    render(true);
  }

  // ---------- ekran: profil pacijenta (osobni podaci i medicinska povijest) ----------
  const poDatumu = (polje) => (a, b) => String(b[polje] || '').localeCompare(String(a[polje] || ''));

  // Sekcije profila koje se mogu dopunjavati. Izvorni zapisi se ne brišu,
  // ukloniti se mogu samo stavke dodane u ovom demou.
  const SEKCIJE = {
    alergije: {
      naslov: 'Alergije', prazno: 'Nema zabilježenih alergija.',
      polja: [
        { k: 'tvar', l: 'Lijek ili tvar', obavezno: true },
        { k: 'reakcija', l: 'Reakcija' },
        { k: 'tezina', l: 'Težina reakcije', opcije: ['blaga', 'umjerena', 'teška'] }
      ],
      prikaz: (x) => `<strong>${esc(x.tvar)}</strong>${x.reakcija ? `: ${esc(x.reakcija)}` : ''}
        ${x.tezina ? `<span class="oznaka ${x.tezina === 'teška' ? 'kriticno' : 'upoz'}">${esc(x.tezina)}</span>` : ''}`
    },
    bolesti: {
      naslov: 'Popratne bolesti i kronična stanja', prazno: 'Nema zabilježenih popratnih bolesti.',
      polja: [{ k: 'naziv', l: 'Bolest ili stanje', obavezno: true }, { k: 'od', l: 'Od (godina)' }],
      prikaz: (x) => `${esc(x.naziv)}${x.od ? ` <span class="tiho">(od ${esc(x.od)})</span>` : ''}`
    },
    kucnaTerapija: {
      naslov: 'Kućna terapija', prazno: 'Nema zabilježene kućne terapije.',
      polja: [{ k: 'lijek', l: 'Lijek', obavezno: true }, { k: 'doza', l: 'Doza i način primjene' }],
      prikaz: (x) => `<strong>${esc(x.lijek)}</strong>${x.doza ? ` ${esc(x.doza)}` : ''}`
    },
    hospitalizacije: {
      naslov: 'Prethodne hospitalizacije', prazno: 'Nema zabilježenih prethodnih hospitalizacija.',
      polja: [
        { k: 'od', l: 'Prijem', tip: 'date', obavezno: true },
        { k: 'do', l: 'Otpust', tip: 'date' },
        { k: 'mjesto', l: 'Odjel ili ustanova' },
        { k: 'razlog', l: 'Razlog hospitalizacije', obavezno: true }
      ],
      sort: poDatumu('od'),
      prikaz: (x) => `<span class="povijest-datum">${datum(x.od)}${x.do ? ` – ${datum(x.do)}` : ''}</span>
        <span>${esc(x.razlog)}${x.mjesto ? ` <span class="tiho">(${esc(x.mjesto)})</span>` : ''}</span>`
    },
    pregledi: {
      naslov: 'Prethodni pregledi', prazno: 'Nema zabilježenih pregleda.',
      polja: [
        { k: 'datum', l: 'Datum', tip: 'date', obavezno: true },
        { k: 'vrsta', l: 'Pregled (npr. kardiolog, UZV srca)', obavezno: true },
        { k: 'nalaz', l: 'Nalaz i preporuka' }
      ],
      sort: poDatumu('datum'),
      prikaz: (x) => `<span class="povijest-datum">${datum(x.datum)}</span>
        <span><strong>${esc(x.vrsta)}</strong>${x.nalaz ? `: ${esc(x.nalaz)}` : ''}</span>`
    },
    operacije: {
      naslov: 'Operacije i zahvati', prazno: 'Nema zabilježenih operacija.',
      polja: [{ k: 'godina', l: 'Godina' }, { k: 'naziv', l: 'Operacija ili zahvat', obavezno: true }],
      sort: poDatumu('godina'),
      prikaz: (x) => `${x.godina ? `<span class="povijest-datum">${esc(x.godina)}.</span>` : ''}<span>${esc(x.naziv)}</span>`
    }
  };

  let zadnjiProfil = null;

  function sekcijaProfilaHtml(p, kljuc, k) {
    const s = SEKCIJE[kljuc];
    const mozeUpis = smijeMijenjati(k, p) && ima(k, 'profil');
    const stavke = [...p.profil[kljuc]];
    if (s.sort) stavke.sort(s.sort);
    const lista = stavke.length
      ? `<ul class="povijest${s.sort ? ' s-datumom' : ''}">${stavke.map((x) => `
          <li>
            ${s.prikaz(x)}
            ${x.dodao ? `<span class="dodano tiho">dodao/la ${esc(imeDjelatnika(x.dodao))}${x.dodano ? `, ${esc(datumVrijeme(x.dodano))}` : ''}
              ${mozeUpis ? `<button type="button" class="poveznica" data-akcija="ukloni-profil" data-tag="${esc(p.tag)}"
                data-sekcija="${kljuc}" data-id="${esc(x.id)}">Ukloni</button>` : ''}</span>` : ''}
          </li>`).join('')}</ul>`
      : `<p class="tiho">${s.prazno}</p>`;
    if (!mozeUpis) {
      return `
        <section class="profil-sekcija" aria-labelledby="s-${kljuc}">
          <h2 id="s-${kljuc}">${s.naslov}</h2>
          ${lista}
        </section>`;
    }
    const polja = s.polja.map((f) => {
      const id = `f-${kljuc}-${f.k}`;
      const unos = f.opcije
        ? `<select id="${id}" name="${f.k}"><option value="">nije poznato</option>${f.opcije.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
        : `<input id="${id}" name="${f.k}" type="${f.tip || 'text'}" ${f.obavezno ? 'required' : ''} autocomplete="off"
            ${f.tip === 'date' ? `max="${kljucDatuma(new Date(D.sada))}"` : ''}>`;
      return `<label for="${id}">${esc(f.l)}${f.obavezno ? '' : ' <span class="tiho">(neobavezno)</span>'}</label>${unos}`;
    }).join('');
    return `
      <section class="profil-sekcija" aria-labelledby="s-${kljuc}">
        <h2 id="s-${kljuc}">${s.naslov}</h2>
        ${lista}
        <details class="dodaj">
          <summary>Dodaj: ${s.naslov.toLowerCase()}</summary>
          <form class="forma forma-profil" data-tag="${esc(p.tag)}" data-sekcija="${kljuc}">
            ${polja}
            <button type="submit" class="gumb mali">Spremi</button>
          </form>
        </details>
      </section>`;
  }

  function ekranProfil(r, k) {
    const odbijeno = odbijenPristup(r, k);
    if (odbijeno) return odbijeno;
    const p = pacijent(r.tag);
    const pr = p.profil;
    if (zadnjiProfil !== p.tag) {
      zabiljezi('otvoren profil pacijenta', p.tag);
      zadnjiProfil = p.tag;
    }

    const red = (naziv, vrijednost) => vrijednost
      ? `<div><dt>${naziv}</dt><dd>${vrijednost}</dd></div>` : '';
    const kontakt = pr.kontakt && pr.kontakt.ime
      ? `${esc(pr.kontakt.ime)}${pr.kontakt.odnos ? ` (${esc(pr.kontakt.odnos)})` : ''}${pr.kontakt.telefon ? `, ${esc(pr.kontakt.telefon)}` : ''}`
      : '';

    const vit = [...p.vitali].sort((a, b) => new Date(b.vrijeme) - new Date(a.vrijeme))[0];
    const unos = (s, t) => `<a href="#unos=${encodeURIComponent(p.tag)}&s=${s}">${t}</a>`;

    // Trenutna terapija: od kada, tko je propisao i zadnja primjena
    const zadnjaPrimjena = (t) => p.primjene
      .filter((m) => m.terapijaId === t.id)
      .sort((a, b) => new Date(b.vrijeme) - new Date(a.vrijeme))[0];
    const terapija = p.terapija.length
      ? `<ul class="povijest">${[...p.terapija].sort((a, b) => new Date(b.od) - new Date(a.od)).map((x) => {
          const m = zadnjaPrimjena(x);
          return `<li>
            <span><strong>${esc(x.lijek)}</strong> ${esc(x.doza)}${x.promjena ? ` <span class="tiho">(${esc(x.promjena)})</span>` : ''}</span>
            <span class="dodano tiho">od ${esc(datumVrijeme(x.od))}${x.upisao ? `, propisao/la ${esc(imeDjelatnika(x.upisao))}` : ''}${x.promjenaU ? `; promjena ${esc(datumVrijeme(x.promjenaU))}` : ''}</span>
            <span class="dodano tiho">${m ? `zadnja primjena ${esc(datumVrijeme(m.vrijeme))} (${esc(m.status)}, ${esc(imeDjelatnika(m.upisao))})` : 'primjena još nije zabilježena'}</span>
          </li>`;
        }).join('')}</ul>`
      : '<p class="tiho">Nema propisane terapije.</p>';

    // Tijek stanja: svaki upis s datumom i vremenom kada je upisan, najnoviji prvi
    const tijek = [];
    Object.values(UNOS).forEach((c) => zapisiSekcije(c, p).forEach((x) => tijek.push({
      u: x.upisano, vrsta: c.jednina, tekst: c.tekst(x, p), tko: x.upisao, izmijenjeno: x.izmijenjeno, izmijenio: x.izmijenio
    })));
    Object.entries(SEKCIJE).forEach(([s, c]) => p.profil[s].filter((x) => x.dodano).forEach((x) => tijek.push({
      u: x.dodano, vrsta: c.naslov.toLowerCase(), tekst: c.prikaz(x).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), tko: x.dodao
    })));
    tijek.sort((a, b) => new Date(b.u) - new Date(a.u));
    const tijekStavke = tijek.map((t) => `
      <li>
        <span class="povijest-datum">${esc(datumVrijeme(t.u))}</span>
        <span><strong>${esc(t.vrsta.charAt(0).toUpperCase() + t.vrsta.slice(1))}:</strong> ${esc(t.tekst)}
          <span class="dodano tiho">${t.tko ? `upisao/la ${esc(imeDjelatnika(t.tko))}` : 'iz bolničkog sustava'}${t.izmijenjeno ? `; izmijenio/la ${esc(imeDjelatnika(t.izmijenio))} ${esc(datumVrijeme(t.izmijenjeno))}` : ''}</span>
        </span>
      </li>`);
    const zadnjeStanje = [...p.stanjePovijest].sort((a, b) => new Date(b.upisano) - new Date(a.upisano))[0];

    return `
      ${zaglavlje(k, '')}
      <header class="profil-zaglavlje">
        <a href="#p=${encodeURIComponent(p.tag)}" class="natrag">Natrag na karticu za primopredaju</a>
        <p class="tiho">${esc(D.odjeli[p.odjel] || p.odjel)}, soba ${esc(p.soba)}, krevet ${esc(p.krevet)}</p>
        <h1 data-fokus tabindex="-1">${esc(p.ime)}, ${p.dob}</h1>
        <p>${p.spol === 'Ž' ? 'Žena' : 'Muškarac'}${pr.datumRodenja ? `, ${p.spol === 'Ž' ? 'rođena' : 'rođen'} ${datum(pr.datumRodenja)}` : ''}</p>
        ${alergijeTrakaHtml(p)}
        ${navigacijaUnosaHtml(p, null)}
      </header>

      <main class="profil">
        <section class="profil-sekcija" aria-labelledby="s-osobno">
          <h2 id="s-osobno">Osnovni podaci</h2>
          <dl class="podaci">
            ${red('MBO', esc(pr.mbo))}
            ${red('Krvna grupa', esc(pr.krvnaGrupa))}
            ${red('Prebivalište', esc(pr.mjesto))}
            ${red('Kontakt osoba', kontakt)}
            ${red('Navike', esc(pr.navike))}
            ${red('Napomena', esc(pr.napomena))}
            ${red('Narukvica', `<code>${esc(p.tag)}</code>`)}
          </dl>
          <div class="narukvica-gumbi">
            ${N.podrzan ? `<button type="button" class="gumb mali" data-akcija="zapisi-tag" data-tag="${esc(p.tag)}">Zapiši na narukvicu</button>` : ''}
            <button type="button" class="gumb sporedni mali" data-akcija="kopiraj" data-tag="${esc(p.tag)}">Kopiraj poveznicu za narukvicu</button>
          </div>
        </section>

        <section class="profil-sekcija" aria-labelledby="s-sada">
          <h2 id="s-sada">Trenutna hospitalizacija</h2>
          <dl class="podaci">
            ${red('Prijem', pr.prijem ? datum(pr.prijem) : '')}
            ${red('Dijagnoza', esc(p.dg))}
            ${red('Upisano stanje', `${esc(STANJA[p.stanje] || p.stanje)}${zadnjeStanje ? ` <span class="tiho">(${esc(datumVrijeme(zadnjeStanje.upisano))}${zadnjeStanje.upisao ? `, ${esc(imeDjelatnika(zadnjeStanje.upisao))}` : ''})</span>` : ''} · ${unos('stanje', 'promjene stanja')}`)}
            ${red('Zadnji vitalni znakovi', vit ? `${esc(datumVrijeme(vit.vrijeme))}: FP ${vit.fp}/min, RR ${vit.sys}/${vit.dia} mmHg, SpO2 ${vit.spo2} %, T ${brojHr(vit.temp)} °C · ${unos('vitali', 'svi vitalni znakovi')}` : unos('vitali', 'upiši vitalne znakove'))}
          </dl>
        </section>

        <section class="profil-sekcija" aria-labelledby="s-terapija">
          <h2 id="s-terapija">Trenutna terapija</h2>
          ${terapija}
          <p class="mali-tekst">${unos('terapija', 'Terapija')} · ${unos('primjene', 'Primjena lijekova')}</p>
        </section>

        ${sekcijaProfilaHtml(p, 'bolesti', k)}
        ${sekcijaProfilaHtml(p, 'alergije', k)}

        <section class="profil-sekcija" aria-labelledby="s-tijek">
          <h2 id="s-tijek">Tijek stanja i upisi</h2>
          <p class="tiho mali-tekst">Svaki upis o pacijentu s datumom i vremenom kada je upisan, najnoviji prvi.</p>
          ${tijek.length ? `
            <ul class="povijest s-datumom tijek">${tijekStavke.slice(0, 15).join('')}</ul>
            ${tijek.length > 15 ? `<details class="dodaj"><summary>Prikaži starije upise (${tijek.length - 15})</summary>
              <ul class="povijest s-datumom tijek">${tijekStavke.slice(15).join('')}</ul></details>` : ''}`
          : '<p class="tiho">Nema upisa.</p>'}
        </section>

        ${['kucnaTerapija', 'hospitalizacije', 'pregledi', 'operacije'].map((s) => sekcijaProfilaHtml(p, s, k)).join('')}
      </main>`;
  }

  // ---------- ekran: novi pacijent ----------
  const KRVNE_GRUPE = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', '0+', '0-'];

  function ekranNoviPacijent(k) {
    const danas = kljucDatuma(new Date(D.sada));
    const polje = (id, oznaka, unos, obavezno) =>
      `<label for="${id}">${oznaka}${obavezno ? '' : ' <span class="tiho">(neobavezno)</span>'}</label>${unos}`;
    return `
      ${zaglavlje(k, '')}
      <main>
        <a href="#odjel" class="natrag">Natrag na odjel</a>
        <h1 data-fokus tabindex="-1">Novi pacijent</h1>
        <p class="tiho">Pacijent se prima na odjel ${esc(D.odjeli[k.odjel])}. Nakon spremanja dobiva anonimni ID koji zapišete na NFC narukvicu.</p>

        <form id="forma-novi" class="forma" autocomplete="off">
          <fieldset>
            <legend>Osobni podaci</legend>
            ${polje('n-ime', 'Ime i prezime', '<input id="n-ime" name="ime" required>', true)}
            <div class="dva-stupca">
              <div>${polje('n-rod', 'Datum rođenja', `<input id="n-rod" name="datumRodenja" type="date" max="${danas}" required>`, true)}</div>
              <div>${polje('n-spol', 'Spol', '<select id="n-spol" name="spol" required><option value="">odaberite</option><option value="Ž">žensko</option><option value="M">muško</option></select>', true)}</div>
            </div>
            <div class="dva-stupca">
              <div>${polje('n-mbo', 'MBO', '<input id="n-mbo" name="mbo" inputmode="numeric" pattern="[0-9]{9}" title="9 znamenki">')}</div>
              <div>${polje('n-krv', 'Krvna grupa', `<select id="n-krv" name="krvnaGrupa"><option value="">nije poznato</option>${KRVNE_GRUPE.map((g) => `<option>${g}</option>`).join('')}</select>`)}</div>
            </div>
            ${polje('n-mjesto', 'Prebivalište', '<input id="n-mjesto" name="mjesto">')}
          </fieldset>

          <fieldset>
            <legend>Prijem i smještaj</legend>
            <div class="dva-stupca">
              <div>${polje('n-soba', 'Soba', '<input id="n-soba" name="soba" required>', true)}</div>
              <div>${polje('n-krevet', 'Krevet', '<input id="n-krevet" name="krevet" required>', true)}</div>
            </div>
            ${polje('n-dg', 'Uputna dijagnoza', '<input id="n-dg" name="dg" required>', true)}
            <div class="dva-stupca">
              <div>${polje('n-prijem', 'Datum prijema', `<input id="n-prijem" name="prijem" type="date" value="${danas}" max="${danas}" required>`, true)}</div>
              <div>${polje('n-stanje', 'Stanje', '<select id="n-stanje" name="stanje"><option value="stabilan">stabilan</option><option value="nadzor">pojačan nadzor</option><option value="nestabilan">nestabilan</option></select>', true)}</div>
            </div>
          </fieldset>

          <fieldset>
            <legend>Medicinska povijest</legend>
            <p class="tiho mali-tekst">Jedna stavka po retku. Detalj odvojite crticom, npr. „Penicilin - urtikarija“.</p>
            ${polje('n-alergije', 'Alergije', '<textarea id="n-alergije" name="alergije" rows="2" placeholder="Penicilin - urtikarija"></textarea>')}
            ${polje('n-bolesti', 'Bolesti i kronična stanja', '<textarea id="n-bolesti" name="bolesti" rows="3" placeholder="Arterijska hipertenzija - 2015"></textarea>')}
            ${polje('n-terapija', 'Kućna terapija', '<textarea id="n-terapija" name="kucnaTerapija" rows="3" placeholder="Metformin - 1000 mg p.o. 2x dnevno"></textarea>')}
            ${polje('n-operacije', 'Operacije i zahvati', '<textarea id="n-operacije" name="operacije" rows="2" placeholder="2012 - Apendektomija"></textarea>')}
            ${polje('n-navike', 'Navike (pušenje, alkohol)', '<input id="n-navike" name="navike">')}
            ${polje('n-napomena', 'Napomena', '<textarea id="n-napomena" name="napomena" rows="2" placeholder="npr. nagluh, pokretan uz pomagalo"></textarea>')}
          </fieldset>

          <fieldset>
            <legend>Kontakt osoba</legend>
            ${polje('n-k-ime', 'Ime i prezime', '<input id="n-k-ime" name="kontaktIme">')}
            <div class="dva-stupca">
              <div>${polje('n-k-odnos', 'Odnos s pacijentom', '<input id="n-k-odnos" name="kontaktOdnos" placeholder="npr. kći">')}</div>
              <div>${polje('n-k-tel', 'Telefon', '<input id="n-k-tel" name="kontaktTelefon" type="tel">')}</div>
            </div>
          </fieldset>

          <p class="greska" id="greska-novi" role="alert"></p>
          <div class="gumbi-red">
            <button type="submit" class="gumb">Spremi pacijenta</button>
            <a href="#odjel" class="gumb sporedni">Odustani</a>
          </div>
        </form>
      </main>`;
  }

  // "Penicilin - urtikarija" -> ['Penicilin', 'urtikarija']
  function podijeliRedak(redak) {
    const dijelovi = redak.split(/\s+[-–]\s+|:\s+/);
    return [dijelovi[0].trim(), dijelovi.slice(1).join(' - ').trim()];
  }

  function noviTag() {
    const znakovi = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let tag;
    do {
      tag = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => znakovi[b % 36]).join('');
    } while (pacijent(tag));
    return tag;
  }

  function spremiNovogPacijenta(f, k) {
    const v = (ime) => (f.elements[ime].value || '').trim();
    const greska = document.getElementById('greska-novi');
    const soba = v('soba');
    const krevet = v('krevet');
    const zauzet = D.pacijenti.find((p) => p.odjel === k.odjel && p.soba === soba && p.krevet === krevet);
    if (zauzet) {
      greska.textContent = `Krevet ${soba}/${krevet} je zauzet (${zauzet.ime}).`;
      f.elements.krevet.focus();
      return;
    }
    const retci = (ime) => v(ime).split('\n').map((x) => x.trim()).filter(Boolean);
    const id = (pref, i) => `${pref}${i + 1}`;
    const tag = noviTag();
    const p = {
      tag, odjel: k.odjel, soba, krevet,
      ime: v('ime'), dob: dobIz(v('datumRodenja')), spol: v('spol'),
      dg: v('dg'), stanje: v('stanje') || 'stabilan',
      profil: Object.assign(prazanProfil(), {
        datumRodenja: v('datumRodenja'), mbo: v('mbo'), krvnaGrupa: v('krvnaGrupa'), mjesto: v('mjesto'),
        prijem: v('prijem'),
        kontakt: { ime: v('kontaktIme'), odnos: v('kontaktOdnos'), telefon: v('kontaktTelefon') },
        alergije: retci('alergije').map((r, i) => { const [tvar, reakcija] = podijeliRedak(r); return { id: id('al', i), tvar, reakcija, tezina: '' }; }),
        bolesti: retci('bolesti').map((r, i) => { const [naziv, od] = podijeliRedak(r); return { id: id('bo', i), naziv, od }; }),
        kucnaTerapija: retci('kucnaTerapija').map((r, i) => { const [lijek, doza] = podijeliRedak(r); return { id: id('kt', i), lijek, doza }; }),
        operacije: retci('operacije').map((r, i) => {
          const [a, b] = podijeliRedak(r);
          return /^\d{4}\.?$/.test(a) && b ? { id: id('op', i), godina: a.replace('.', ''), naziv: b } : { id: id('op', i), godina: '', naziv: r };
        }),
        navike: v('navike'), napomena: v('napomena')
      }),
      terapija: [], primjene: [], nalazi: [], vitali: [], biljeske: [], zadaci: [], akoOnda: [],
      stanjePovijest: [{ id: 's1', stanje: v('stanje') || 'stabilan', upisano: sadaZaZapis(), upisao: k.id, napomena: 'stanje pri prijemu' }],
      dodao: k.id
    };
    D.pacijenti.push(p);
    store.set('noviPacijenti', [...store.get('noviPacijenti', []), p]);
    zabiljezi('primljen novi pacijent', tag, `soba ${soba}, krevet ${krevet}`);
    normalizirajZapise(p);
    obavijest(`Pacijent ${p.ime} je dodan. Zapišite ID ${tag} na narukvicu.`);
    idi('profil=' + encodeURIComponent(tag));
  }

  // ---------- ekran: poruka (nepoznata narukvica, zabranjen pristup) ----------
  function ekranPoruka(k, naslov, tekst) {
    return `
      ${zaglavlje(k, '')}
      <main class="poruka">
        <h1 data-fokus tabindex="-1">${naslov}</h1>
        <p>${tekst}</p>
        <a class="gumb" href="#odjel">Natrag na odjel</a>
      </main>`;
  }

  // ---------- ekran: zapisnik pristupa ----------
  function ekranZapisnik(k) {
    const log = store.get('zapisnik', []);
    const redovi = log.map((z) => {
      const p = z.tag ? pacijent(z.tag) : null;
      const opis = p ? (vidiPacijenta(k, p) ? `${p.soba}/${p.krevet} ${p.ime}` : `drugi odjel (${z.tag})`) : (z.tag || '');
      return `
        <tr>
          <td>${P.vrijemeDatum(z.u)}</td>
          <td>${esc(z.tko ? imeDjelatnika(z.tko) : '')}</td>
          <td>${esc(z.akcija)}</td>
          <td>${esc(opis)}</td>
          <td>${esc(z.detalj)}</td>
        </tr>`;
    }).join('');
    return `
      ${zaglavlje(k, 'zapisnik')}
      <main>
        <h1 data-fokus tabindex="-1">Zapisnik pristupa</h1>
        <p class="tiho">Svaka prijava, skeniranje, otvaranje kartice i preuzimanje se bilježi. U stvarnom sustavu zapisnik je na poslužitelju i ne može se mijenjati.</p>
        ${log.length ? `
          <div class="tablica-omot">
            <table>
              <thead><tr><th>Vrijeme</th><th>Djelatnik</th><th>Radnja</th><th>Pacijent</th><th>Detalj</th></tr></thead>
              <tbody>${redovi}</tbody>
            </table>
          </div>` : '<p>Zapisnik je prazan. Skenirajte narukvicu ili otvorite karticu pacijenta.</p>'}
      </main>`;
  }

  // ---------- ekran: narukvice (zapisivanje NFC tagova) ----------
  function poveznicaZaTag(tag) {
    return `${location.origin}${location.pathname}#p=${encodeURIComponent(tag)}&nfc=1`;
  }

  function ekranNarukvice(k) {
    const lista = D.pacijenti.filter((p) => p.odjel === k.odjel);
    return `
      ${zaglavlje(k, 'narukvice')}
      <main>
        <h1 data-fokus tabindex="-1">Narukvice pacijenata</h1>
        <p class="tiho">Na svaku narukvicu zapisuje se samo poveznica s anonimnim ID-em. Bez prijave djelatnika ona ne otkriva ništa o pacijentu.</p>
        ${N.podrzan ? '' : '<p class="napomena">Zapisivanje na NFC radi u Chromeu na Androidu, preko HTTPS-a. Na ovom uređaju možete kopirati poveznicu i zapisati je aplikacijom poput NFC Tools.</p>'}
        <ul class="narukvice">
          ${lista.map((p) => `
            <li>
              <div>
                <strong>${esc(p.soba)}/${esc(p.krevet)} ${esc(p.ime)}</strong>
                <span class="tiho">ID na narukvici: <code>${esc(p.tag)}</code></span>
              </div>
              <div class="narukvica-gumbi">
                ${N.podrzan ? `<button type="button" class="gumb mali" data-akcija="zapisi-tag" data-tag="${esc(p.tag)}">Zapiši na narukvicu</button>` : ''}
                <button type="button" class="gumb sporedni mali" data-akcija="kopiraj" data-tag="${esc(p.tag)}">Kopiraj poveznicu</button>
              </div>
            </li>`).join('')}
        </ul>
      </main>`;
  }

  // ---------- donji sloj (skeniranje, zapisivanje) ----------
  function otvoriSloj(html) {
    zatvoriSloj();
    const sloj = document.createElement('div');
    sloj.className = 'sloj';
    sloj.innerHTML = `<div class="sloj-sadrzaj" role="dialog" aria-modal="true" aria-labelledby="sloj-naslov">${html}</div>`;
    document.body.appendChild(sloj);
    const f = sloj.querySelector('[data-fokus]') || sloj.querySelector('button');
    if (f) f.focus();
  }

  function zatvoriSloj() {
    N.zaustavi();
    document.querySelectorAll('.sloj').forEach((s) => s.remove());
  }

  const PORUKE_NFC = {
    nepodrzano: '',
    prazan: 'Na narukvici nema ID-a pacijenta. Zapišite je na stranici Narukvice.',
    citanje: 'Narukvica nije pročitana. Držite mobitel uz narukvicu sekundu duže.',
    dozvola: 'Preglednik nema dozvolu za NFC. Dopustite NFC u postavkama stranice i pokušajte ponovno.'
  };

  function pokreniSkeniranje() {
    if (N.podrzan) {
      otvoriSloj(`
        ${valovi(true)}
        <h2 id="sloj-naslov">Prislonite mobitel na narukvicu</h2>
        <p class="tiho">Stražnji dio mobitela, blizu kamere, držite uz narukvicu.</p>
        <p class="greska" id="sken-greska" role="alert"></p>
        <button type="button" class="gumb sporedni" data-akcija="zatvori-sloj">Odustani</button>`);
      N.skeniraj(
        (tag) => { zatvoriSloj(); delete pristup[tag]; idi(`p=${encodeURIComponent(tag)}&nfc=1`); },
        (kod) => { const el = document.getElementById('sken-greska'); if (el) el.textContent = PORUKE_NFC[kod] || PORUKE_NFC.citanje; }
      );
    } else {
      otvoriSloj(`
        ${valovi(false)}
        <h2 id="sloj-naslov">Ovaj preglednik ne čita NFC</h2>
        <p class="tiho">Skeniranje u aplikaciji radi u Chromeu na Androidu. Na iPhoneu prislonite mobitel na narukvicu bez otvaranja aplikacije: otvorit će se poveznica s narukvice.</p>
        <form id="forma-rucno">
          <label for="rucni-id">Ili upišite ID s narukvice</label>
          <input id="rucni-id" name="tagid" autocomplete="off" required data-fokus placeholder="npr. k7m2q9xa">
          <button type="submit" class="gumb">Otvori karticu</button>
        </form>
        <button type="button" class="gumb sporedni" data-akcija="zatvori-sloj">Odustani</button>`);
    }
  }

  async function zapisiNarukvicu(tag) {
    otvoriSloj(`
      ${valovi(true)}
      <h2 id="sloj-naslov">Prislonite praznu narukvicu</h2>
      <p class="tiho">Zapisujem ID <code>${esc(tag)}</code>.</p>
      <p class="greska" id="zapis-greska" role="alert"></p>
      <button type="button" class="gumb sporedni" data-akcija="zatvori-sloj">Odustani</button>`);
    try {
      await N.zapisi(poveznicaZaTag(tag));
      zatvoriSloj();
      zabiljezi('zapisana narukvica', tag);
      obavijest('Narukvica je zapisana.');
    } catch (e) {
      const el = document.getElementById('zapis-greska');
      if (el) el.textContent = 'Zapisivanje nije uspjelo. Provjerite je li narukvica NFC (NTAG213/215) i nije zaključana.';
    }
  }

  // ---------- AI sažetak (samo uz lokalni poslužitelj) ----------
  async function provjeriAI() {
    try {
      const odg = await fetch('api/zdravlje', { cache: 'no-store' });
      if (!odg.ok) return;
      const json = await odg.json();
      aiDostupan = !!json.ai;
      if (aiDostupan && ruta().ime === 'kartica') render(true);
    } catch (e) { aiDostupan = false; }
  }

  async function napraviAISazetak(tag, gumb) {
    const p = pacijent(tag);
    const k = korisnik();
    if (!p || !k || p.odjel !== k.odjel) return;
    gumb.disabled = true;
    gumb.textContent = 'Radim sažetak…';
    try {
      const odg = await fetch('api/sazetak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          opis: `${p.dob} god., ${p.spol === 'Ž' ? 'žena' : 'muškarac'}, ${p.dg}`,
          zapisi: P.zapisi(p, biljeskeUzKrevet(tag), imeDjelatnika)
            .map((z) => ({ ...z, vrijeme: z.vrijeme ? kada(z.vrijeme) : 'bez vremena' }))
        })
      });
      const json = await odg.json();
      if (!odg.ok) throw new Error(json.greska || 'greška');
      aiSazeci[tag] = json;
      zabiljezi('AI sažetak', tag);
      render(true);
    } catch (e) {
      gumb.disabled = false;
      gumb.textContent = 'Napravi AI sažetak';
      obavijest('AI sažetak nije napravljen. Prikazan je sažetak iz pravila.');
    }
  }

  // ---------- događaji ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-akcija]');
    if (!b) return;
    const a = b.dataset.akcija;
    const tag = b.dataset.tag;
    const k = korisnik();

    if (a === 'odjava') {
      zabiljezi('odjava');
      store.set('sesija', null);
      location.hash = '';
      render();
    } else if (a === 'skeniraj') {
      pokreniSkeniranje();
    } else if (a === 'zatvori-sloj') {
      zatvoriSloj();
    } else if (a === 'otvori') {
      delete pristup[tag];
      idi('p=' + encodeURIComponent(tag));
    } else if (a === 'uredi-zapis') {
      uredjivanje = { tag, sekcija: b.dataset.sekcija, id: b.dataset.id };
      render();
    } else if (a === 'odustani-uredi') {
      const id = uredjivanje && uredjivanje.id;
      uredjivanje = null;
      render(true);
      const el = id && document.getElementById('zs-' + id);
      if (el) el.scrollIntoView({ block: 'center' });
    } else if (a === 'obrisi-zapis') {
      obrisiZapis(tag, b.dataset.sekcija, b.dataset.id, k);
    } else if (a === 'nalaz-pregledan' || a === 'zadatak-gotovo') {
      const p = pacijent(tag);
      if (!p || !smijeMijenjati(k, p)) return;
      const sada = sadaZaZapis();
      if (a === 'nalaz-pregledan') {
        const n = p.nalazi.find((x) => x.id === b.dataset.id);
        if (!n || !ima(k, 'nalazi')) return;
        Object.assign(n, { pregledao: k.id, pregledano: sada });
        zabiljezi('pregledan nalaz', tag, `${n.naziv}: ${opisNalaza(n)}`);
        obavijest(`Nalaz je označen pregledanim (${datumVrijeme(sada)}).`);
      } else {
        const z = p.zadaci.find((x) => x.id === b.dataset.id);
        if (!z || !ima(k, 'zadaci')) return;
        Object.assign(z, z.gotovo ? { gotovo: false, obavio: null, obavljeno: null } : { gotovo: true, obavio: k.id, obavljeno: sada });
        zabiljezi(z.gotovo ? 'obavljen zadatak' : 'zadatak vraćen na neobavljeno', tag, z.opis);
      }
      spremiKliniku(p);
      render(true);
    } else if (a === 'potvrdi' || a === 'odpotvrdi') {
      const set = potvrde[tag] || (potvrde[tag] = new Set());
      if (a === 'potvrdi') set.add(b.dataset.id); else set.delete(b.dataset.id);
      render(true);
    } else if (a === 'preuzmi') {
      const p = pacijent(tag);
      if (!p || !smijeMijenjati(k, p) || !ima(k, 'preuzimanje')) return;
      const pre = preuzimanja();
      const nacin = (pristup[tag] && pristup[tag].nacin) || 'rucno';
      pre[tag] = { tko: k.id, u: sadaZaZapis(), nacin, potvrdena: [...(potvrde[tag] || [])] };
      store.set('preuzimanja', pre);
      zabiljezi('preuzet pacijent', tag, nacin === 'nfc' ? 'uz skeniranje narukvice' : 'bez skeniranja narukvice');
      obavijest(`Pacijent ${pacijent(tag).ime} je preuzet.`);
      idi('odjel');
    } else if (a === 'ponisti') {
      const pre = preuzimanja();
      delete pre[tag];
      store.set('preuzimanja', pre);
      potvrde[tag] = new Set();
      zabiljezi('poništeno preuzimanje', tag);
      render(true);
    } else if (a === 'izvor') {
      const det = document.getElementById('izvorni');
      const el = document.getElementById('zapis-' + b.dataset.id);
      if (det && el) {
        det.open = true;
        document.querySelectorAll('.zapisi li.istaknuto').forEach((x) => x.classList.remove('istaknuto'));
        el.classList.add('istaknuto');
        el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      }
    } else if (a === 'ai') {
      napraviAISazetak(tag, b);
    } else if (a === 'reset') {
      if (confirm('Obrisati sva preuzimanja, potvrde i bilješke uz krevet iz ovog demoa? Zapisnik ostaje.')) {
        store.set('preuzimanja', {});
        store.set('biljeske', {});
        Object.keys(potvrde).forEach((x) => delete potvrde[x]);
        Object.keys(aiSazeci).forEach((x) => delete aiSazeci[x]);
        zabiljezi('nova primopredaja');
        render();
      }
    } else if (a === 'ukloni-profil') {
      const p = pacijent(tag);
      if (!p || !smijeMijenjati(k, p) || !ima(k, 'profil')) return;
      const sek = b.dataset.sekcija;
      p.profil[sek] = p.profil[sek].filter((x) => x.id !== b.dataset.id);
      const dodaci = store.get('profilDodaci', {});
      if (dodaci[tag] && dodaci[tag][sek]) dodaci[tag][sek] = dodaci[tag][sek].filter((x) => x.id !== b.dataset.id);
      store.set('profilDodaci', dodaci);
      zabiljezi('izmjena profila', tag, `uklonjena stavka: ${SEKCIJE[sek].naslov.toLowerCase()}`);
      render(true);
    } else if (a === 'demo-podaci') {
      if (confirm('Vratiti početne demo podatke? Brišu se preuzimanja, bilješke, zapisnik, novi pacijenti, dopune profila i svi upisi, a vi se odjavljujete.')) {
        ['sesija', 'preuzimanja', 'biljeske', 'zapisnik', 'nakonPrijave', 'noviPacijenti', 'profilDodaci', 'klinika', 'idBrojaci']
          .forEach((x) => store.remove(x));
        location.hash = '';
        location.reload();
      }
    } else if (a === 'zapisi-tag') {
      zapisiNarukvicu(tag);
    } else if (a === 'kopiraj') {
      const url = poveznicaZaTag(tag);
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(() => obavijest('Poveznica je kopirana.'))
        .catch(() => prompt('Kopirajte poveznicu:', url));
    }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    e.preventDefault();

    if (f.id === 'forma-prijava') {
      const pin = f.pin.value.trim();
      const d = D.djelatnici.find((x) => x.pin === pin);
      if (!d) {
        document.getElementById('greska-prijava').textContent = 'Pogrešan PIN. Pokušajte ponovno.';
        f.pin.value = '';
        f.pin.focus();
        return;
      }
      store.set('sesija', { id: d.id });
      zabiljezi('prijava');
      const cilj = store.get('nakonPrijave', null);
      store.set('nakonPrijave', null);
      if (cilj && cilj !== location.hash) location.hash = cilj.replace(/^#/, '');
      else render();
    } else if (f.id === 'forma-biljeska') {
      const tekst = f.biljeska.value.trim();
      if (!tekst) return;
      const tag = f.dataset.tag;
      const p = pacijent(tag);
      const k = korisnik();
      if (!p || !smijeMijenjati(k, p) || !ima(k, 'preuzimanje')) return;
      const sve = store.get('biljeske', {});
      (sve[tag] = sve[tag] || []).push({ id: 'bk' + Date.now().toString(36), vrijeme: sadaZaZapis(), autor: k.id, tekst, vrsta: 'krevet' });
      store.set('biljeske', sve);
      delete aiSazeci[tag];
      zabiljezi('bilješka uz krevet', tag);
      obavijest('Bilješka je spremljena.');
      render(true);
    } else if (f.id === 'forma-novi') {
      const k = korisnik();
      if (k && k.odjel && ima(k, 'prijem')) spremiNovogPacijenta(f, k);
    } else if (f.classList.contains('forma-zapis')) {
      const k = korisnik();
      if (k) spremiZapis(f, k);
    } else if (f.classList.contains('forma-profil')) {
      const k = korisnik();
      const tag = f.dataset.tag;
      const sek = f.dataset.sekcija;
      const p = pacijent(tag);
      if (!p || !smijeMijenjati(k, p) || !ima(k, 'profil') || !SEKCIJE[sek]) return;
      const stavka = { id: 'd' + Date.now().toString(36), dodao: k.id, dodano: sadaZaZapis() };
      SEKCIJE[sek].polja.forEach((x) => { stavka[x.k] = (f.elements[x.k].value || '').trim(); });
      p.profil[sek].push(stavka);
      const dodaci = store.get('profilDodaci', {});
      dodaci[tag] = dodaci[tag] || {};
      (dodaci[tag][sek] = dodaci[tag][sek] || []).push(stavka);
      store.set('profilDodaci', dodaci);
      zabiljezi('izmjena profila', tag, `dodano: ${SEKCIJE[sek].naslov.toLowerCase()}`);
      obavijest(sek === 'alergije' ? 'Alergija je zabilježena i provjerava se u terapiji.' : 'Spremljeno u profil.');
      render(true);
    } else if (f.id === 'forma-rucno') {
      const tag = f.querySelector('#rucni-id').value.trim();
      if (!tag) return;
      zatvoriSloj();
      delete pristup[tag];
      idi('p=' + encodeURIComponent(tag));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') zatvoriSloj();
  });

  window.addEventListener('hashchange', () => render());

  primijeniIzmjene();
  render();
  provjeriAI();
})();
