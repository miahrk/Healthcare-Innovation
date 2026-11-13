(function () {
  'use strict';

  const D = window.APP_DATA;
  const P = window.PRAVILA;
  const N = window.NFC;
  const app = document.getElementById('app');
  const vr = P.vrijeme;

  // ---------- pohrana (localStorage, samo za demo) ----------
  // Verzija u ključu: podaci starije, šire verzije aplikacije (raspored, profili, upisi)
  // spremani su pod 'primopredaja-demo:' i ovdje se zanemaruju i brišu.
  const PREFIKS = 'primopredaja-demo-v2:';
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('primopredaja-demo:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* pohrana nedostupna */ }
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

  // Djelatnik vidi samo pacijente svog odjela (liječnik i sestra imaju ista prava)
  const vidiPacijenta = (k, p) => !!k && p.odjel === k.odjel;

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

  // Način otvaranja kartice: pravo skeniranje, simulirano skeniranje (demo bez čitača) ili ručno
  const NACIN_OPIS = {
    nfc: 'uz skeniranje narukvice',
    sim: 'uz simulirano skeniranje narukvice',
    rucno: 'bez skeniranja narukvice'
  };
  const SIM_DETALJ = 'simulirano skeniranje (demo bez NFC čitača)';

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
      if (par.get('p')) {
        // sim=1: skeniranje je simulirano u demou (nema NFC čitača), ali se ponaša kao skeniranje
        const nfc = par.get('nfc') === '1';
        return { ime: 'kartica', tag: par.get('p'), nfc, sim: nfc && par.get('sim') === '1' };
      }
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
    // Diktat staje kad se napusti kartica pacijenta za kojeg se diktira (tekst ipak ide u nacrt)
    if (G.slusa() && (!k || r.ime !== 'kartica' || r.tag !== slusaTag)) G.zaustavi();

    if (!k) {
      if (r.ime !== 'prijava' && r.ime !== 'odjel') store.set('nakonPrijave', location.hash);
      return prikazi(ekranPrijava());
    }
    if (r.ime === 'kartica') return prikazi(ekranKartica(r, k), zadrziPolozaj);
    if (r.ime === 'zapisnik') return prikazi(ekranZapisnik(k));
    if (r.ime === 'narukvice') return prikazi(ekranNarukvice(k));
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

  function ekranOdjel(k) {
    const pre = preuzimanja();
    const lista = D.pacijenti
      .filter((p) => p.odjel === k.odjel)
      .map((p) => ({ p, ...stanjePacijenta(p) }))
      .sort((a, b) => b.razina - a.razina || a.p.soba.localeCompare(b.p.soba) || a.p.krevet.localeCompare(b.p.krevet));

    const preuzeto = lista.filter((x) => pre[x.p.tag]).length;
    const posto = lista.length ? Math.round((preuzeto / lista.length) * 100) : 0;

    const redovi = lista.map(({ p, upoz, razina }) => {
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
          <p class="tiho mali-tekst">Kraj smjene u ${vr(D.krajSmjene)}. Poredano po hitnosti.</p>
        </section>

        <ol class="pacijenti">${redovi}</ol>

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
        zabiljezi('odbijen pristup', p.tag, `pacijent nije na odjelu djelatnika (${k.odjel})${r.sim ? ', ' + SIM_DETALJ : ''}`);
        if (r.nfc) history.replaceState(null, '', '#p=' + encodeURIComponent(p.tag));
      }
      return ekranPoruka(k, 'Nemate pristup ovom pacijentu',
        'Pacijent nije na vašem odjelu, pa njegovi podaci nisu prikazani. Pokušaj pristupa je zabilježen u zapisniku.');
    }
    return null;
  }

  function alergijeTrakaHtml(p) {
    return p.alergije.length
      ? `<p class="alergije-traka"><strong>Alergije:</strong> ${p.alergije.map(esc).join(', ')}</p>`
      : '<p class="alergije-traka nema">Nema zabilježenih alergija</p>';
  }

  // Brzi pregled za primopredaju: sve ključno na jednom mjestu, uz poveznice na izvorne zapise
  function brziPregledHtml(p, dodatne, izvorGumb) {
    const pr = P.pregled(p, D.sada, dodatne);
    const prazno = (t) => `<p class="tiho mali-tekst">${t}</p>`;
    const jos = (n) => n ? `<p class="tiho mali-tekst">i još ${n} u izvornim zapisima</p>` : '';
    const STATUS = {
      ceka: '<span class="oznaka tiho-oznaka">na čekanju</span>',
      nepregledan: '<span class="oznaka kriticno">nije pregledan</span>',
      pregledan: ''
    };

    const vitaliHtml = pr.vitali
      ? `<p class="tiho mali-tekst">Mjereno u ${kada(pr.vitali.vrijeme)}${pr.vitali.ranijeVrijeme ? `, u zagradi ${kada(pr.vitali.ranijeVrijeme)}` : ''} ${izvorGumb(pr.vitali.id)}</p>
         <dl class="vitali">${pr.vitali.stavke.map((s) => `
           <div class="${s.odstupa ? 'odstupa' : ''}">
             <dt>${s.oznaka}</dt>
             <dd><strong>${esc(s.vrijednost)}</strong>${s.ranije ? ` <span class="tiho">(${esc(s.ranije)})</span>` : ''}${s.odstupa ? '<span class="nevidljivo"> odstupa</span>' : ''}</dd>
           </div>`).join('')}</dl>`
      : prazno('Nema mjerenja.');

    const nalaziHtml = pr.nalazi.length
      ? `<ul class="pregled-lista">${pr.nalazi.map((n) => `
          <li${n.status === 'nepregledan' && n.izvanRef ? ' class="kriticno-tekst"' : ''}>
            <strong>${esc(n.naziv)}</strong>: ${esc(n.tekst)} ${STATUS[n.status]}
            <span class="tiho mali-tekst">${kada(n.vrijeme)}</span> ${izvorGumb(n.id)}
          </li>`).join('')}</ul>${jos(pr.nalaziJos)}`
      : prazno('Nema nalaza.');

    const terapijaHtml = pr.terapija.length
      ? `<ul class="pregled-lista">${pr.terapija.map((t) => `
          <li><strong>${esc(t.lijek)}</strong> ${esc(t.doza)}
            ${t.promjena ? `<span class="oznaka upoz">${esc(t.promjena)} u ${kada(t.od)}</span>` : ''} ${izvorGumb(t.id)}
          </li>`).join('')}</ul>`
      : prazno('Nema terapije.');

    const biljeskeHtml = pr.biljeske.length
      ? `<ul class="pregled-lista">${pr.biljeske.map((b) => `
          <li><span class="tiho mali-tekst">${kada(b.vrijeme)}, ${esc(imeDjelatnika(b.autor))}${b.uzKrevet ? ', uz krevet' : ''}</span><br>
            ${esc(b.tekst)} ${izvorGumb(b.id)}
          </li>`).join('')}</ul>${jos(pr.biljeskeJos)}`
      : prazno('Nema bilješki.');

    const zadaciHtml = pr.zadaci.length
      ? `<ul class="pregled-lista">${pr.zadaci.map((z) => `
          <li${z.kasni ? ' class="kriticno-tekst"' : ''}>
            <strong>${kada(z.rok)}</strong> ${esc(z.opis)}${z.kasni ? ' <strong>(kasni)</strong>' : ''} ${izvorGumb(z.id)}
          </li>`).join('')}</ul>`
      : prazno('Nema otvorenih zadataka.');

    const blok = (naslov, html, siroko) =>
      `<section class="pregled-blok${siroko ? ' siroko' : ''}"><h3>${naslov}</h3>${html}</section>`;

    return `
      <section class="pregled" aria-labelledby="pregled-naslov">
        <h2 id="pregled-naslov">Pregled za primopredaju</h2>
        <div class="pregled-mreza">
          ${blok('Vitalni znakovi', vitaliHtml, true)}
          ${blok('Zadnji nalazi', nalaziHtml)}
          ${blok('Terapija', terapijaHtml)}
          ${blok('Zadnje bilješke', biljeskeHtml)}
          ${blok('Otvoreni zadaci', zadaciHtml)}
        </div>
      </section>`;
  }

  // Tko je i kada pristupao zapisu ovog pacijenta (iz zapisnika), najnovije prvo
  const PRISTUPI_NA_KARTICI = 10;
  function pristupiZapisuHtml(p) {
    const svi = store.get('zapisnik', []).filter((z) => z.tag === p.tag);
    if (!svi.length) return '';
    const ime = (z) => esc(z.tko ? imeDjelatnika(z.tko) : 'nepoznato');
    const redovi = svi.slice(0, PRISTUPI_NA_KARTICI).map((z) => `
      <li>
        <span class="pristup-vrijeme">${P.vrijemeDatum(z.u)}</span>
        <span><strong>${ime(z)}</strong>: ${esc(z.akcija)}${z.detalj ? `, <span class="tiho">${esc(z.detalj)}</span>` : ''}</span>
      </li>`).join('');
    return `
      <details class="izvorni pristupi" id="pristupi">
        <summary>Pristupi zapisu (${svi.length}), zadnji: ${ime(svi[0])} u ${P.vrijemeDatum(svi[0].u)}</summary>
        <ol class="pristupi-lista">${redovi}</ol>
        ${svi.length > PRISTUPI_NA_KARTICI ? `<p class="tiho mali-tekst">Prikazano zadnjih ${PRISTUPI_NA_KARTICI}.</p>` : ''}
        <p class="mali-tekst"><a href="#zapisnik">Cijeli zapisnik pristupa</a></p>
      </details>`;
  }

  // ---------- glasovni unos ----------
  // Govor (ili upisani tekst) -> pravila u razvrstavanje.js -> NACRT polja označenih "nepotvrđeno".
  // Djelatnik svako polje pregleda, po potrebi ispravi i potvrdi ili odbaci.
  // U "unosi" ulazi samo ono što je čovjek potvrdio.
  const G = window.GOVOR;
  const RZ = window.RAZVRSTAVANJE;
  const VRSTE_POLJA = { vitali: 'Vitalni znakovi', nalaz: 'Nalaz', terapija: 'Terapija', zadatak: 'Zadatak', biljeska: 'Opća bilješka' };
  const PROMJENE = ['uveden', 'ukinut', 'doza povećana', 'doza smanjena', 'jednokratno dan'];
  const VITALI_POLJA = [
    ['fp', 'FP (/min)'], ['sys', 'RR sistolički'], ['dia', 'RR dijastolički'],
    ['spo2', 'SpO2 (%)'], ['temp', 'T (°C)'], ['fd', 'FD (/min)']
  ];
  const PRIMJERI_DIKTATA = [
    'Tlak 100 na 60, puls 52, saturacija 94 posto. Kalij 6,1 javljen dežurnom. Ukinut spironolakton. Zadatak: kontrola kalija u 22 sata. Bolesnik pospan, budi se na poziv.',
    'saturacija 91 temperatura 38 zarez 9 dan paracetamol 1 g p.o. u 18 sati bolesnica se žali na bol u prsima kod kašlja treba javiti obitelji',
    'puls 88 tlak 300 na 80 frekvencija 20 bolesnik bez tegoba'
  ];
  const diktat = { tag: null, tekst: '' };   // tekst u polju za diktat, da se ne izgubi pri ponovnom crtanju
  let slusaTag = null;                       // pacijent za kojeg se trenutno diktira

  const nacrti = () => store.get('nacrti', {});
  const nacrtZa = (tag) => nacrti()[tag] || null;
  function spremiNacrt(tag, n) {
    const sve = nacrti();
    if (n && n.polja.length) sve[tag] = n; else delete sve[tag];
    store.set('nacrti', sve);
  }
  const potvrdeniUnosi = (tag) => store.get('unosi', {})[tag] || [];

  const brojUTekst = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
  const uBroj = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).trim().replace(',', '.')));

  // ISO -> vrijednost za <input type="datetime-local"> (lokalno vrijeme)
  function uLokalno(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const dv = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dv(d.getMonth() + 1)}-${dv(d.getDate())}T${dv(d.getHours())}:${dv(d.getMinutes())}`;
  }

  function nacrtPoljeUnosi(pl) {
    const d = pl.podaci;
    const ime = (kljuc) => `np-${pl.id}-${kljuc}`;
    const unos = (kljuc, oznaka, vrijednost, dodatno = '') => `
      <label for="${ime(kljuc)}">${oznaka}</label>
      <input id="${ime(kljuc)}" data-polje="${esc(pl.id)}" data-kljuc="${kljuc}" value="${esc(vrijednost)}" autocomplete="off" ${dodatno}>`;

    if (pl.vrsta === 'vitali') {
      return `<div class="nacrt-mreza">${VITALI_POLJA.map(([kljuc, oznaka]) =>
        `<div>${unos(kljuc, oznaka, brojUTekst(d[kljuc]), 'inputmode="decimal"')}</div>`).join('')}</div>`;
    }
    if (pl.vrsta === 'nalaz') {
      return `<div class="nacrt-mreza">
        <div>${unos('naziv', 'Nalaz', d.naziv)}</div>
        <div>${unos('vrijednost', 'Vrijednost', brojUTekst(d.vrijednost), 'inputmode="decimal"')}</div>
        <div>${unos('jedinica', 'Jedinica', d.jedinica)}</div>
      </div>${d.stiglo ? `<p class="tiho mali-tekst">Vrijeme iz diktata: ${kada(d.stiglo)}</p>` : ''}`;
    }
    if (pl.vrsta === 'terapija') {
      return `<div class="nacrt-mreza">
        <div>${unos('lijek', 'Lijek', d.lijek)}</div>
        <div>${unos('doza', 'Doza', d.doza)}</div>
        <div>
          <label for="${ime('promjena')}">Promjena</label>
          <select id="${ime('promjena')}" data-polje="${esc(pl.id)}" data-kljuc="promjena">
            ${PROMJENE.map((x) => `<option${x === d.promjena ? ' selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
      </div>${d.od ? `<p class="tiho mali-tekst">Vrijeme iz diktata: ${kada(d.od)}</p>` : ''}`;
    }
    if (pl.vrsta === 'zadatak') {
      return `<div class="nacrt-mreza">
        <div class="siroko">${unos('opis', 'Zadatak', d.opis)}</div>
        <div>${unos('rok', 'Rok' + (d.rok ? '' : ' (nije izgovoren, upišite)'), uLokalno(d.rok), 'type="datetime-local"')}</div>
      </div>`;
    }
    return `
      <label for="${ime('tekst')}" class="nevidljivo">Tekst bilješke</label>
      <textarea id="${ime('tekst')}" data-polje="${esc(pl.id)}" data-kljuc="tekst" rows="2">${esc(d.tekst)}</textarea>`;
  }

  // Provjera ispravljenih vrijednosti prije potvrde: vraća { podaci } ili { greska }
  function provjeriPolje(pl) {
    const d = pl.podaci;
    const tekst = (x) => String(x ?? '').trim();
    if (pl.vrsta === 'vitali') {
      const out = {};
      for (const [kljuc, oznaka] of VITALI_POLJA) {
        const x = uBroj(d[kljuc]);
        if (x === null) continue;
        if (!RZ.uRasponu(kljuc, x)) return { greska: `${oznaka}: vrijednost nije uvjerljiva.` };
        out[kljuc] = x;
      }
      if (('sys' in out) !== ('dia' in out)) return { greska: 'Upišite i sistolički i dijastolički tlak, ili nijedan.' };
      if ('sys' in out && out.sys <= out.dia) return { greska: 'Sistolički tlak mora biti viši od dijastoličkog.' };
      if (!Object.keys(out).length) return { greska: 'Upišite barem jedan vitalni znak ili odbacite polje.' };
      return { podaci: out };
    }
    if (pl.vrsta === 'nalaz') {
      const vrijednost = uBroj(d.vrijednost);
      if (!tekst(d.naziv)) return { greska: 'Upišite naziv nalaza.' };
      if (vrijednost === null || Number.isNaN(vrijednost)) return { greska: 'Vrijednost nalaza mora biti broj.' };
      // referentni raspon vrijedi samo ako naziv nije mijenjan
      const ref = pl.prvotno && tekst(d.naziv) === pl.prvotno.naziv ? pl.prvotno.ref : null;
      return { podaci: { naziv: tekst(d.naziv), vrijednost, jedinica: tekst(d.jedinica), ref, stiglo: d.stiglo || null } };
    }
    if (pl.vrsta === 'terapija') {
      if (!tekst(d.lijek)) return { greska: 'Upišite lijek.' };
      if (!PROMJENE.includes(d.promjena)) return { greska: 'Odaberite vrstu promjene.' };
      if (d.promjena !== 'ukinut' && !tekst(d.doza)) return { greska: 'Upišite dozu.' };
      return { podaci: { lijek: tekst(d.lijek), doza: tekst(d.doza), promjena: d.promjena, od: d.od || null } };
    }
    if (pl.vrsta === 'zadatak') {
      if (!tekst(d.opis)) return { greska: 'Upišite opis zadatka.' };
      const rok = d.rok ? new Date(d.rok) : null;
      if (!rok || Number.isNaN(rok.getTime())) return { greska: 'Upišite rok zadatka.' };
      return { podaci: { opis: tekst(d.opis), rok: rok.toISOString() } };
    }
    if (!tekst(d.tekst)) return { greska: 'Bilješka je prazna. Upišite tekst ili odbacite polje.' };
    return { podaci: { tekst: tekst(d.tekst) } };
  }

  function glasovniUnosHtml(p) {
    const tag = esc(p.tag);
    const slusa = slusaTag === p.tag && G.slusa();
    const n = nacrtZa(p.tag);
    const unosi = potvrdeniUnosi(p.tag);

    const kontrole = G.podrzan
      ? `<button type="button" class="gumb glas-gumb${slusa ? ' slusa' : ''}" data-akcija="glas-diktiraj" data-tag="${tag}" aria-pressed="${slusa}">
           ${slusa ? 'Zaustavi diktat' : 'Diktiraj'}
         </button>
         <span class="tiho mali-tekst" id="glas-stanje">${slusa ? 'Slušam… govorite hrvatski, jasno i ne prebrzo.' : 'Pritisnite i govorite. Kad stanete, tekst se razvrsta u polja.'}</span>`
      : `<p class="napomena mali-tekst">Ovaj preglednik ne pretvara govor u tekst (radi u Chromeu i Edgeu, uz internet). Tekst možete upisati ili zalijepiti.</p>`;

    const nacrtHtml = n ? `
      <div class="nacrt" id="nacrt">
        <h3>Nacrt za pregled: ${n.polja.length} ${n.polja.length === 1 ? 'polje' : 'polja'}</h3>
        <p class="mali-tekst">Polja su popunjena automatski i <strong>nisu spremljena u zapis</strong>. Pregledajte svako, ispravite ako treba, pa potvrdite ili odbacite.</p>
        ${n.napomene.length ? `<ul class="nacrt-napomene">${n.napomene.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <ul class="nacrt-polja">${n.polja.map((pl) => `
          <li class="nacrt-polje" id="nacrt-${esc(pl.id)}">
            <div class="nacrt-zaglavlje">
              <strong>${VRSTE_POLJA[pl.vrsta]}</strong>
              <span class="oznaka nepotvrdeno">Nepotvrđeno${pl.ureden ? ', ispravljeno' : ''}</span>
            </div>
            <p class="tiho mali-tekst">Iz diktata: „${esc(pl.izvor)}”</p>
            ${nacrtPoljeUnosi(pl)}
            <p class="greska" id="nacrt-greska-${esc(pl.id)}" role="alert"></p>
            <div class="nacrt-gumbi">
              <button type="button" class="gumb mali" data-akcija="glas-potvrdi" data-tag="${tag}" data-id="${esc(pl.id)}">Potvrdi</button>
              <button type="button" class="gumb sporedni mali" data-akcija="glas-odbaci" data-tag="${tag}" data-id="${esc(pl.id)}">Odbaci</button>
            </div>
          </li>`).join('')}
        </ul>
        <details class="nacrt-diktat">
          <summary>Izvorni diktat</summary>
          ${n.diktati.map((t) => `<p class="mali-tekst">„${esc(t)}”</p>`).join('')}
        </details>
        <button type="button" class="poveznica mali-tekst" data-akcija="glas-odbaci-sve" data-tag="${tag}">Odbaci cijeli nacrt</button>
      </div>` : '';

    const potvrdenoHtml = unosi.length ? `
      <div class="potvrdeno-glas">
        <h3>Potvrđeno iz glasovnog unosa (${unosi.length})</h3>
        <ul class="pregled-lista">${unosi.slice().reverse().map((u) => `
          <li><strong>${VRSTE_POLJA[u.vrsta]}:</strong> ${esc(RZ.opisPolja(u))}
            <span class="tiho mali-tekst">potvrdio/la ${esc(imeDjelatnika(u.potvrdio))} u ${kada(u.potvrdeno)}${u.ispravljeno ? ', ispravljeno' : ''}</span>
          </li>`).join('')}</ul>
      </div>` : '';

    return `
      <section class="glas" aria-labelledby="glas-naslov">
        <h2 id="glas-naslov">Glasovni unos</h2>
        <div class="glas-kontrole">${kontrole}</div>
        <p class="greska" id="glas-greska" role="alert"></p>
        <label for="glas-tekst">${G.podrzan ? 'Izgovoreni tekst (možete ga i upisati ili ispraviti)' : 'Tekst za razvrstavanje'}</label>
        <textarea id="glas-tekst" rows="3" data-tag="${tag}" placeholder="Npr. tlak 120 na 80, puls 88, uveden ceftriakson 2 g i.v., zadatak: kontrola GUK-a u 21 sat">${esc(diktat.tag === p.tag ? diktat.tekst : '')}</textarea>
        <div class="glas-akcije">
          <button type="button" class="gumb sporedni mali" data-akcija="glas-razvrstaj" data-tag="${tag}">Razvrstaj u polja</button>
          <details class="glas-primjeri">
            <summary>Primjeri diktata za demo</summary>
            ${PRIMJERI_DIKTATA.map((t, i) => `<button type="button" class="poveznica mali-tekst" data-akcija="glas-primjer" data-tag="${tag}" data-i="${i}">„${esc(t)}”</button>`).join('')}
          </details>
        </div>
        ${nacrtHtml}
        ${potvrdenoHtml}
      </section>`;
  }

  // Tekst -> nacrt (dodaje se postojećem nacrtu tog pacijenta)
  function razvrstajUNacrt(tag, tekst) {
    const p = pacijent(tag);
    const k = korisnik();
    if (!p || !vidiPacijenta(k, p) || !tekst.trim()) return 0;
    const r = RZ.razvrstaj(tekst, sadaZaZapis());
    if (!r.polja.length) return 0;
    const n = nacrtZa(tag) || { id: 'gn' + Date.now().toString(36), autor: k.id, vrijeme: sadaZaZapis(), diktati: [], napomene: [], polja: [] };
    const br = n.diktati.length;
    n.diktati.push(r.tekst);
    n.napomene.push(...r.napomene);
    r.polja.forEach((pl) => n.polja.push({
      ...pl, id: `${n.id}-${br}-${pl.id}`, prvotno: JSON.parse(JSON.stringify(pl.podaci)), ureden: false
    }));
    spremiNacrt(tag, n);
    zabiljezi('glasovni unos razvrstan u nacrt', tag, `${r.polja.length} ${r.polja.length === 1 ? 'polje' : 'polja'}, nepotvrđeno`);
    if (diktat.tag === tag) diktat.tekst = '';
    return r.polja.length;
  }

  function nakonRazvrstavanja(tag, broj) {
    const naKartici = ruta().ime === 'kartica' && ruta().tag === tag;
    if (!naKartici) return;
    if (!broj) {
      const el = document.getElementById('glas-greska');
      if (el) el.textContent = 'U tekstu nema ništa za razvrstati.';
      return;
    }
    render(true);
    obavijest(`Nacrt: ${broj} ${broj === 1 ? 'polje' : 'polja'} za pregled i potvrdu.`);
    const el = document.getElementById('nacrt');
    if (el) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  const PORUKE_GOVOR = {
    nepodrzano: 'Ovaj preglednik ne pretvara govor u tekst. Upišite tekst.',
    dozvola: 'Preglednik nema dozvolu za mikrofon. Dopustite mikrofon u postavkama stranice.',
    mikrofon: 'Mikrofon nije pronađen.',
    mreza: 'Prepoznavanje govora treba internet. Upišite tekst ručno.',
    tisina: 'Nije se čuo govor. Pokušajte ponovno, bliže mikrofonu.',
    greska: 'Prepoznavanje govora nije uspjelo. Upišite tekst ručno.'
  };

  function osvjeziGumbDiktata() {
    const b = document.querySelector('[data-akcija="glas-diktiraj"]');
    if (!b) return;
    const slusa = G.slusa();
    b.classList.toggle('slusa', slusa);
    b.setAttribute('aria-pressed', String(slusa));
    b.textContent = slusa ? 'Zaustavi diktat' : 'Diktiraj';
    const s = document.getElementById('glas-stanje');
    if (s) s.textContent = slusa ? 'Slušam… govorite hrvatski, jasno i ne prebrzo.' : 'Pritisnite i govorite. Kad stanete, tekst se razvrsta u polja.';
  }

  function diktiraj(tag) {
    if (G.slusa()) { G.zaustavi(); return; }
    const polje = document.getElementById('glas-tekst');
    const pocetni = polje ? polje.value.trim() : '';
    const greska = document.getElementById('glas-greska');
    if (greska) greska.textContent = '';
    diktat.tag = tag;
    diktat.tekst = pocetni;
    slusaTag = tag;
    G.pokreni({
      naTekst: (t) => {
        diktat.tekst = (pocetni ? pocetni + ' ' : '') + t;
        const el = document.getElementById('glas-tekst');
        if (el && el.dataset.tag === tag) el.value = diktat.tekst;
      },
      naKraj: () => {
        slusaTag = null;
        osvjeziGumbDiktata();
        // Diktat se ne gubi ni ako je djelatnik u međuvremenu otišao s kartice: ide u nacrt
        if (diktat.tag === tag && diktat.tekst.trim()) nakonRazvrstavanja(tag, razvrstajUNacrt(tag, diktat.tekst));
      },
      naGresku: (kod) => {
        const el = document.getElementById('glas-greska');
        if (el) el.textContent = PORUKE_GOVOR[kod] || PORUKE_GOVOR.greska;
      }
    });
    osvjeziGumbDiktata();
  }

  function potvrdiPolje(tag, id) {
    const k = korisnik();
    const p = pacijent(tag);
    const n = nacrtZa(tag);
    if (!p || !vidiPacijenta(k, p) || !n) return;
    const pl = n.polja.find((x) => x.id === id);
    if (!pl) return;
    const r = provjeriPolje(pl);
    if (r.greska) {
      const el = document.getElementById('nacrt-greska-' + id);
      if (el) el.textContent = r.greska;
      return;
    }
    const sve = store.get('unosi', {});
    const unos = {
      id: 'gu' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      vrsta: pl.vrsta, podaci: r.podaci, izvor: pl.izvor, nacrt: n.id,
      autor: n.autor, potvrdio: k.id, potvrdeno: sadaZaZapis(), ispravljeno: !!pl.ureden
    };
    (sve[tag] = sve[tag] || []).push(unos);
    store.set('unosi', sve);
    n.polja = n.polja.filter((x) => x.id !== id);
    spremiNacrt(tag, n);
    delete aiSazeci[tag];
    zabiljezi('potvrđen glasovni unos', tag, `${VRSTE_POLJA[unos.vrsta]}: ${RZ.opisPolja(unos)}${unos.ispravljeno ? ' (ispravljeno)' : ''}`);
    obavijest(`${VRSTE_POLJA[unos.vrsta]}: potvrđeno i spremljeno.`);
    render(true);
  }

  function odbaciPolje(tag, id) {
    const n = nacrtZa(tag);
    if (!n) return;
    const pl = n.polja.find((x) => x.id === id);
    if (!pl) return;
    n.polja = n.polja.filter((x) => x.id !== id);
    spremiNacrt(tag, n);
    zabiljezi('odbačen nacrt glasovnog unosa', tag, `${VRSTE_POLJA[pl.vrsta]}: ${RZ.opisPolja(pl)}`);
    render(true);
  }

  function ekranKartica(r, k) {
    const odbijeno = odbijenPristup(r, k);
    if (odbijeno) return odbijeno;
    const p = pacijent(r.tag);

    // Način pristupa: skeniranjem (pravim ili simuliranim) ili ručno. Bilježi se jednom po otvaranju.
    if (r.nfc) {
      pristup[p.tag] = { nacin: r.sim ? 'sim' : 'nfc', u: sadaZaZapis() };
      zabiljezi('skenirana narukvica', p.tag, r.sim ? SIM_DETALJ : '');
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
           ${NACIN_OPIS[pre.nacin] || NACIN_OPIS.rucno}.</p>
           <button type="button" class="poveznica" data-akcija="ponisti" data-tag="${esc(p.tag)}">Poništi preuzimanje</button>
         </div>`
      : `<button type="button" class="gumb preuzmi" data-akcija="preuzmi" data-tag="${esc(p.tag)}" ${sveSpremno ? '' : 'disabled'}>Preuzmi pacijenta</button>
         ${sveSpremno ? '' : `<p class="tiho mali-tekst">Potvrdite sva upozorenja (${brojPotvrdenih} od ${zaPotvrdu.length}).</p>`}
         ${nacin.nacin === 'rucno' ? '<p class="tiho mali-tekst">Kartica je otvorena ručno. Za potvrdu identiteta skenirajte narukvicu uz krevet.</p>' : ''}`;

    const pregledHtml = brziPregledHtml(p, dodatne, izvorGumb);
    const pristupiHtml = pristupiZapisuHtml(p);

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
            : nacin.nacin === 'sim'
              ? `Simulirano skeniranje narukvice u ${vr(nacin.u)} (demo bez NFC čitača)`
              : 'Otvoreno ručno, bez skeniranja narukvice'}
        </p>
        ${alergijeTrakaHtml(p)}
      </header>

      <main>
        ${pregledHtml}
        ${glasovniUnosHtml(p)}
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
        ${pristupiHtml}
      </main>`;
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

  // Simulacija skeniranja za demo bez NFC čitača: popis svih demo narukvica.
  // Narukvice s drugog odjela prikazuju se bez imena, za demo odbijenog pristupa.
  function simulacijaHtml(k) {
    const gumbi = D.pacijenti.map((p) => {
      const opis = p.odjel === k.odjel
        ? `Soba ${esc(p.soba)}, krevet ${esc(p.krevet)}: ${esc(p.ime)}`
        : 'Narukvica s drugog odjela';
      return `
        <li>
          <button type="button" class="gumb sporedni mali" data-akcija="simuliraj" data-tag="${esc(p.tag)}">
            <span>${opis}</span> <code>${esc(p.tag)}</code>
          </button>
        </li>`;
    }).join('');
    return `
      <p class="tiho mali-tekst">Odabir narukvice ponaša se kao skeniranje, a na kartici i u zapisniku piše da je skeniranje simulirano.</p>
      <ul class="sim-lista">${gumbi}</ul>`;
  }

  function pokreniSkeniranje() {
    const k = korisnik();
    if (N.podrzan) {
      otvoriSloj(`
        ${valovi(true)}
        <h2 id="sloj-naslov">Prislonite mobitel na narukvicu</h2>
        <p class="tiho">Stražnji dio mobitela, blizu kamere, držite uz narukvicu.</p>
        <p class="greska" id="sken-greska" role="alert"></p>
        <details class="sim">
          <summary>Nemate narukvicu? Simulirajte skeniranje</summary>
          ${simulacijaHtml(k)}
        </details>
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
        <h3 class="sim-naslov">Simulacija za demo: odaberite narukvicu</h3>
        ${simulacijaHtml(k)}
        <form id="forma-rucno">
          <label for="rucni-id">Ili upišite ID s narukvice (bilježi se kao ručno otvaranje)</label>
          <input id="rucni-id" name="tagid" autocomplete="off" required placeholder="npr. k7m2q9xa">
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
    } else if (a === 'simuliraj') {
      zatvoriSloj();
      delete pristup[tag];
      idi(`p=${encodeURIComponent(tag)}&nfc=1&sim=1`);
    } else if (a === 'otvori') {
      delete pristup[tag];
      idi('p=' + encodeURIComponent(tag));
    } else if (a === 'potvrdi' || a === 'odpotvrdi') {
      const set = potvrde[tag] || (potvrde[tag] = new Set());
      if (a === 'potvrdi') set.add(b.dataset.id); else set.delete(b.dataset.id);
      render(true);
    } else if (a === 'preuzmi') {
      const p = pacijent(tag);
      if (!p || !vidiPacijenta(k, p)) return;
      const pre = preuzimanja();
      const nacin = (pristup[tag] && pristup[tag].nacin) || 'rucno';
      pre[tag] = { tko: k.id, u: sadaZaZapis(), nacin, potvrdena: [...(potvrde[tag] || [])] };
      store.set('preuzimanja', pre);
      zabiljezi('preuzet pacijent', tag, NACIN_OPIS[nacin] || NACIN_OPIS.rucno);
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
    } else if (a === 'glas-diktiraj') {
      diktiraj(tag);
    } else if (a === 'glas-razvrstaj') {
      if (G.slusa()) { G.zaustavi(); return; }   // razvrstava se kad diktat stane
      const el = document.getElementById('glas-tekst');
      const tekst = el ? el.value : '';
      if (!tekst.trim()) {
        document.getElementById('glas-greska').textContent = 'Izgovorite ili upišite tekst.';
        return;
      }
      diktat.tag = tag;
      diktat.tekst = tekst;
      nakonRazvrstavanja(tag, razvrstajUNacrt(tag, tekst));
    } else if (a === 'glas-primjer') {
      const el = document.getElementById('glas-tekst');
      if (el) {
        el.value = PRIMJERI_DIKTATA[Number(b.dataset.i)] || '';
        diktat.tag = tag;
        diktat.tekst = el.value;
        el.focus();
      }
    } else if (a === 'glas-potvrdi') {
      potvrdiPolje(tag, b.dataset.id);
    } else if (a === 'glas-odbaci') {
      odbaciPolje(tag, b.dataset.id);
    } else if (a === 'glas-odbaci-sve') {
      const n = nacrtZa(tag);
      if (n && confirm(`Odbaciti cijeli nacrt (${n.polja.length} nepotvrđenih polja)? Ništa od toga neće ući u zapis.`)) {
        spremiNacrt(tag, null);
        zabiljezi('odbačen nacrt glasovnog unosa', tag, `cijeli nacrt, ${n.polja.length} polja`);
        render(true);
      }
    } else if (a === 'reset') {
      if (confirm('Obrisati sva preuzimanja, potvrde, bilješke uz krevet i glasovne unose iz ovog demoa? Zapisnik ostaje.')) {
        G.zaustavi();
        diktat.tag = null;
        diktat.tekst = '';
        store.set('preuzimanja', {});
        store.set('biljeske', {});
        store.set('nacrti', {});
        store.set('unosi', {});
        Object.keys(potvrde).forEach((x) => delete potvrde[x]);
        Object.keys(aiSazeci).forEach((x) => delete aiSazeci[x]);
        zabiljezi('nova primopredaja');
        render();
      }
    } else if (a === 'demo-podaci') {
      if (confirm('Vratiti početne demo podatke? Brišu se preuzimanja, potvrde, bilješke, glasovni unosi i zapisnik, a vi se odjavljujete.')) {
        G.zaustavi();
        ['sesija', 'preuzimanja', 'biljeske', 'nacrti', 'unosi', 'zapisnik', 'nakonPrijave']
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
      if (!p || !vidiPacijenta(k, p)) return;
      const sve = store.get('biljeske', {});
      (sve[tag] = sve[tag] || []).push({ id: 'bk' + Date.now().toString(36), vrijeme: sadaZaZapis(), autor: k.id, tekst, uzKrevet: true });
      store.set('biljeske', sve);
      delete aiSazeci[tag];
      zabiljezi('bilješka uz krevet', tag);
      obavijest('Bilješka je spremljena.');
      render(true);
    } else if (f.id === 'forma-rucno') {
      const tag = f.querySelector('#rucni-id').value.trim();
      if (!tag) return;
      zatvoriSloj();
      delete pristup[tag];
      idi('p=' + encodeURIComponent(tag));
    }
  });

  // Uređivanje nacrta: sprema se odmah, bez ponovnog crtanja (da se ne izgubi fokus)
  function urediNacrt(e) {
    const el = e.target;
    if (el.id === 'glas-tekst') {
      diktat.tag = el.dataset.tag;
      diktat.tekst = el.value;
      return;
    }
    if (!el.dataset || !el.dataset.polje) return;
    const r = ruta();
    if (r.ime !== 'kartica') return;
    const n = nacrtZa(r.tag);
    const pl = n && n.polja.find((x) => x.id === el.dataset.polje);
    if (!pl) return;
    pl.podaci[el.dataset.kljuc] = el.type === 'datetime-local'
      ? (el.value ? new Date(el.value).toISOString() : null)
      : el.value;
    if (!pl.ureden) {
      pl.ureden = true;
      const oznaka = document.querySelector(`#nacrt-${CSS.escape(pl.id)} .oznaka.nepotvrdeno`);
      if (oznaka) oznaka.textContent = 'Nepotvrđeno, ispravljeno';
    }
    spremiNacrt(r.tag, n);
    const greska = document.getElementById('nacrt-greska-' + pl.id);
    if (greska) greska.textContent = '';
  }
  document.addEventListener('input', urediNacrt);
  document.addEventListener('change', urediNacrt);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') zatvoriSloj();
  });

  window.addEventListener('hashchange', () => render());

  render();
  provjeriAI();
})();