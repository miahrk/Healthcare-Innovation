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
  let tjedanPomak = 0;       // raspored: 0 = ovaj tjedan, -1 = prošli, 1 = sljedeći
  let rasporedOdjel = null;  // raspored: odjel koji administrator gleda

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

  // Izmjene napravljene u demou (administracija, novi pacijenti, dopune profila) čuvaju se
  // u localStorage-u i primjenjuju na podatke iz data.js pri pokretanju.
  function primijeniIzmjene() {
    Object.assign(D.odjeli, store.get('odjeli', {}));
    const odjeliDj = store.get('odjeliDjelatnika', {});
    D.djelatnici.forEach((d) => { if (d.id in odjeliDj) d.odjel = odjeliDj[d.id]; });
    store.get('noviPacijenti', []).forEach((p) => { if (!pacijent(p.tag)) D.pacijenti.push(p); });
    const dodaci = store.get('profilDodaci', {});
    D.pacijenti.forEach((p) => {
      p.profil = Object.assign(prazanProfil(), p.profil);
      Object.entries(dodaci[p.tag] || {}).forEach(([sekcija, lista]) => {
        p.profil[sekcija] = [...(p.profil[sekcija] || []), ...lista];
      });
    });
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

    if (!k) {
      if (r.ime !== 'prijava' && r.ime !== 'odjel') store.set('nakonPrijave', location.hash);
      return prikazi(ekranPrijava());
    }
    if (r.ime === 'kartica') return prikazi(ekranKartica(r, k), zadrziPolozaj);
    if (r.ime === 'profil') return prikazi(ekranProfil(r, k), zadrziPolozaj);
    if (r.ime === 'zapisnik') return prikazi(ekranZapisnik(k));
    if (r.ime === 'raspored') return prikazi(ekranRaspored(k), zadrziPolozaj);
    // Administrator upravlja djelatnicima i odjelima, ali ne vidi pacijente.
    if (k.admin) return prikazi(ekranAdmin(k), zadrziPolozaj);
    if (r.ime === 'narukvice') return prikazi(ekranNarukvice(k));
    if (r.ime === 'novi-pacijent') return prikazi(ekranNoviPacijent(k));
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
          <p class="odjel">${esc(k.admin ? 'Administracija sustava' : (D.odjeli[k.odjel] || 'Bez dodijeljenog odjela'))}</p>
          <p class="tiho">${esc(k.ime)}, ${esc(k.uloga)}</p>
        </div>
        <nav aria-label="Glavni izbornik">
          ${k.admin
            ? veza('admin', 'Djelatnici i odjeli')
            : veza('odjel', 'Odjel') + veza('narukvice', 'Narukvice')}
          ${veza('raspored', 'Raspored')}
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
          Demo PIN-ovi: 1111 dr. Kovač (predaje smjenu), 2222 dr. Radić (dežurni),
          3333 sestra Tomić, 4444 dr. Grgić s kirurgije (za test odbijenog pristupa),
          9999 administratorica (odjeli i raspored smjena).
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
          <p class="tiho mali-tekst">Kraj smjene u ${vr(D.smjena.do)}. Poredano po hitnosti.</p>
          ${sljedecaSmjenaHtml(k.odjel)}
        </section>

        <div class="traka-alata">
          <h2>Pacijenti na odjelu</h2>
          <a class="gumb sporedni mali" href="#novi-pacijent">+ Novi pacijent</a>
        </div>
        ${lista.length ? `<ol class="pacijenti">${redovi}</ol>` : '<p class="tiho">Na odjelu nema pacijenata.</p>'}

        <p class="dno"><button type="button" class="poveznica" data-akcija="reset">Nova primopredaja (obriši potvrde i bilješke iz demoa)</button></p>
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
    if (!k.odjel || p.odjel !== k.odjel) {
      if (r.nfc || !pristup['odbijeno-' + p.tag]) {
        pristup['odbijeno-' + p.tag] = true;
        zabiljezi('odbijen pristup', p.tag, k.admin ? 'administrator nema pristup pacijentima' : `pacijent nije na odjelu ${k.odjel || '(bez odjela)'}`);
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
      naslov: 'Bolesti i kronična stanja', prazno: 'Nema zabilježenih bolesti.',
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

  function sekcijaProfilaHtml(p, kljuc) {
    const s = SEKCIJE[kljuc];
    const stavke = [...p.profil[kljuc]];
    if (s.sort) stavke.sort(s.sort);
    const lista = stavke.length
      ? `<ul class="povijest${s.sort ? ' s-datumom' : ''}">${stavke.map((x) => `
          <li>
            ${s.prikaz(x)}
            ${x.dodao ? `<span class="dodano tiho">dodao/la ${esc(imeDjelatnika(x.dodao))}
              <button type="button" class="poveznica" data-akcija="ukloni-profil" data-tag="${esc(p.tag)}"
                data-sekcija="${kljuc}" data-id="${esc(x.id)}">Ukloni</button></span>` : ''}
          </li>`).join('')}</ul>`
      : `<p class="tiho">${s.prazno}</p>`;
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
    const terapija = p.terapija.length
      ? `<ul class="povijest">${p.terapija.map((x) =>
          `<li><span><strong>${esc(x.lijek)}</strong> ${esc(x.doza)}${x.promjena ? ` <span class="tiho">(${esc(x.promjena)})</span>` : ''}</span></li>`).join('')}</ul>`
      : '<p class="tiho">Nema propisane terapije.</p>';

    return `
      ${zaglavlje(k, '')}
      <header class="profil-zaglavlje">
        <a href="#p=${encodeURIComponent(p.tag)}" class="natrag">Natrag na karticu za primopredaju</a>
        <p class="tiho">${esc(D.odjeli[p.odjel] || p.odjel)}, soba ${esc(p.soba)}, krevet ${esc(p.krevet)}</p>
        <h1 data-fokus tabindex="-1">${esc(p.ime)}, ${p.dob}</h1>
        <p>${p.spol === 'Ž' ? 'Žena' : 'Muškarac'}${pr.datumRodenja ? `, ${p.spol === 'Ž' ? 'rođena' : 'rođen'} ${datum(pr.datumRodenja)}` : ''}</p>
        ${alergijeTrakaHtml(p)}
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
            ${red('Upisano stanje', esc({ stabilan: 'stabilan', nadzor: 'pojačan nadzor', nestabilan: 'nestabilan' }[p.stanje] || p.stanje))}
            ${red('Zadnji vitalni znakovi', vit ? `${kada(vit.vrijeme)}: FP ${vit.fp}/min, RR ${vit.sys}/${vit.dia} mmHg, SpO2 ${vit.spo2} %, T ${String(vit.temp).replace('.', ',')} °C` : '')}
          </dl>
          <h3>Terapija u bolnici</h3>
          ${terapija}
        </section>

        ${Object.keys(SEKCIJE).map((s) => sekcijaProfilaHtml(p, s)).join('')}
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
      terapija: [], nalazi: [], vitali: [], biljeske: [], zadaci: [], akoOnda: [],
      dodao: k.id
    };
    D.pacijenti.push(p);
    store.set('noviPacijenti', [...store.get('noviPacijenti', []), p]);
    zabiljezi('primljen novi pacijent', tag, `soba ${soba}, krevet ${krevet}`);
    obavijest(`Pacijent ${p.ime} je dodan. Zapišite ID ${tag} na narukvicu.`);
    idi('profil=' + encodeURIComponent(tag));
  }

  // ---------- raspored smjena ----------
  const danasDemo = () => { const d = new Date(D.sada); d.setHours(0, 0, 0, 0); return d; };
  const osobljeOdjela = (odjel) => D.djelatnici.filter((d) => !d.admin && d.odjel === odjel);
  const DANI = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

  function daniTjedna(pomak) {
    const pon = danasDemo();
    pon.setDate(pon.getDate() - ((pon.getDay() + 6) % 7) + 7 * pomak);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(pon); d.setDate(pon.getDate() + i); return d; });
  }

  // Zadani raspored: svaka skupina (liječnici, sestre/tehničari) se vrti po ciklusu
  // dnevna -> noćna -> slobodan dan. Dan 0 je današnji dan demoa.
  function zadanaSmjena(odjel, d, smjena) {
    const dan = Math.round((d - danasDemo()) / 86400000);
    const poz = smjena === 'dnevna' ? 0 : 1;
    const osoblje = osobljeOdjela(odjel);
    const uSmjeni = (skupina) => skupina.filter((_, j) => (((dan + j) % 3) + 3) % 3 === poz).map((x) => x.id);
    return [
      ...uSmjeni(osoblje.filter((x) => x.vrsta === 'lijecnik')),
      ...uSmjeni(osoblje.filter((x) => x.vrsta !== 'lijecnik'))
    ];
  }

  const kljucSmjene = (odjel, d, smjena) => `${odjel}|${kljucDatuma(d)}|${smjena}`;

  function smjena(odjel, d, vrsta) {
    const spremljeno = store.get('raspored', {})[kljucSmjene(odjel, d, vrsta)];
    const ids = spremljeno || zadanaSmjena(odjel, d, vrsta);
    // prikazuju se samo djelatnici koji su trenutno na tom odjelu
    return ids.map(djelatnik).filter((x) => x && x.odjel === odjel);
  }

  function spremiSmjenu(kljuc, ids) {
    const sve = store.get('raspored', {});
    sve[kljuc] = ids;
    store.set('raspored', sve);
  }

  function sljedecaSmjenaHtml(odjel) {
    if (!odjel) return '';
    const s = D.smjene.nocna;
    const osobe = smjena(odjel, danasDemo(), 'nocna');
    return `<p class="mali-tekst">Noćnu smjenu (${s.od}–${s.do}) preuzima:
      ${osobe.length ? osobe.map((d) => esc(d.ime)).join(', ') : '<strong>nitko nije u rasporedu</strong>'}.
      <a href="#raspored">Raspored</a></p>`;
  }

  // Upozorenja za jednu smjenu: pokrivenost i odmor između smjena
  function provjeraSmjene(osobe, vrsta, istiDanDrugaSmjena, prethodnaNocna) {
    const out = [];
    if (!osobe.some((d) => d.vrsta === 'lijecnik')) out.push('Nema liječnika u smjeni.');
    if (!osobe.some((d) => d.vrsta !== 'lijecnik')) out.push('Nema medicinske sestre ni tehničara.');
    osobe.forEach((d) => {
      if (vrsta === 'nocna' && istiDanDrugaSmjena.includes(d.id)) out.push(`${d.ime} radi dnevnu i noćnu zaredom (24 h).`);
      if (vrsta === 'dnevna' && prethodnaNocna.includes(d.id)) out.push(`${d.ime} dolazi na dnevnu odmah nakon noćne.`);
    });
    return out;
  }

  function ekranRaspored(k) {
    const odjeli = Object.keys(D.odjeli);
    const odjel = k.admin ? (rasporedOdjel && D.odjeli[rasporedOdjel] ? rasporedOdjel : odjeli[0]) : k.odjel;
    if (!odjel) {
      return ekranPoruka(k, 'Raspored smjena', 'Niste raspoređeni ni na jedan odjel. Javite se administratoru.');
    }
    const dani = daniTjedna(tjedanPomak);
    const danas = kljucDatuma(danasDemo());
    const osoblje = osobljeOdjela(odjel);
    const moje = [];

    const daniHtml = dani.map((d) => {
      const juceri = new Date(d); juceri.setDate(d.getDate() - 1);
      const dnevna = smjena(odjel, d, 'dnevna');
      const nocna = smjena(odjel, d, 'nocna');
      const jucerNocna = smjena(odjel, juceri, 'nocna').map((x) => x.id);
      const jeDanas = kljucDatuma(d) === danas;
      const nazivDana = `${DANI[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;

      const smjenaHtml = (vrsta, osobe) => {
        const s = D.smjene[vrsta];
        const kljuc = kljucSmjene(odjel, d, vrsta);
        if (osobe.some((x) => x.id === k.id)) moje.push(`${nazivDana}, ${s.naziv.toLowerCase()} ${s.od}–${s.do}`);
        const upoz = provjeraSmjene(osobe, vrsta, dnevna.map((x) => x.id), jucerNocna);
        const slobodni = osoblje.filter((x) => !osobe.some((o) => o.id === x.id));
        return `
          <div class="smjena ${vrsta}">
            <p class="smjena-naziv"><strong>${s.naziv}</strong> <span class="tiho">${s.od}–${s.do}</span></p>
            <ul class="osobe">
              ${osobe.map((x) => `
                <li class="osoba ${x.vrsta === 'lijecnik' ? 'lijecnik' : 'sestra'}${x.id === k.id ? ' ja' : ''}">
                  <span>${esc(x.ime)}${x.id === k.id ? ' (vi)' : ''}</span>
                  ${k.admin ? `<button type="button" data-akcija="makni-iz-smjene" data-kljuc="${esc(kljuc)}" data-id="${esc(x.id)}"
                    aria-label="Ukloni ${esc(x.ime)} iz smjene: ${nazivDana}, ${s.naziv.toLowerCase()}">×</button>` : ''}
                </li>`).join('') || '<li class="tiho">nitko</li>'}
            </ul>
            ${upoz.length ? `<ul class="smjena-upoz">${upoz.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
            ${k.admin && slobodni.length ? `
              <select data-promjena="dodaj-u-smjenu" data-kljuc="${esc(kljuc)}" aria-label="Dodaj djelatnika: ${nazivDana}, ${s.naziv.toLowerCase()} smjena">
                <option value="">+ dodaj djelatnika</option>
                ${slobodni.map((x) => `<option value="${esc(x.id)}">${esc(x.ime)} (${esc(x.uloga)})</option>`).join('')}
              </select>` : ''}
          </div>`;
      };

      return `
        <li class="dan${jeDanas ? ' danas' : ''}">
          <h2>${nazivDana}${jeDanas ? ' <span class="oznaka ok">danas</span>' : ''}</h2>
          <div class="smjene">${smjenaHtml('dnevna', dnevna)}${smjenaHtml('nocna', nocna)}</div>
        </li>`;
    }).join('');

    const prvi = dani[0];
    const zadnji = dani[6];
    return `
      ${zaglavlje(k, 'raspored')}
      <main>
        <h1 data-fokus tabindex="-1">Raspored smjena</h1>
        ${k.admin ? `
          <label for="raspored-odjel">Odjel</label>
          <select id="raspored-odjel" data-promjena="raspored-odjel">
            ${odjeli.map((o) => `<option value="${esc(o)}" ${o === odjel ? 'selected' : ''}>${esc(D.odjeli[o])}</option>`).join('')}
          </select>
          <p class="tiho mali-tekst">Dodajte ili uklonite djelatnike iz smjene. Sustav upozorava na smjenu bez liječnika ili sestre i na rad bez odmora.</p>`
        : `<p class="tiho">${esc(D.odjeli[odjel])}. Raspored mijenja administrator.</p>`}

        <div class="tjedan-nav">
          <button type="button" class="gumb sporedni mali" data-akcija="tjedan" data-pomak="-1" aria-label="Prethodni tjedan">‹</button>
          <p><strong>${prvi.getDate()}. ${prvi.getMonth() + 1}. – ${zadnji.getDate()}. ${zadnji.getMonth() + 1}. ${zadnji.getFullYear()}.</strong>
            ${tjedanPomak !== 0 ? '<button type="button" class="poveznica" data-akcija="tjedan" data-pomak="0">ovaj tjedan</button>' : ''}</p>
          <button type="button" class="gumb sporedni mali" data-akcija="tjedan" data-pomak="1" aria-label="Sljedeći tjedan">›</button>
        </div>

        ${k.admin ? '' : `
          <section class="moje-smjene">
            <h2>Vaše smjene ovaj tjedan</h2>
            ${moje.length ? `<ul>${moje.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '<p class="tiho">Ovaj tjedan nemate smjena.</p>'}
          </section>`}

        <ol class="raspored">${daniHtml}</ol>
        <p class="tiho mali-tekst legenda"><span class="osoba lijecnik">liječnik</span> <span class="osoba sestra">sestra / tehničar</span></p>
      </main>`;
  }

  // 1 pacijent, 2 pacijenta, 5 pacijenata (21 pacijent, 12 pacijenata)
  function mnozina(n, jedan, dva, pet = dva) {
    const z = n % 10, zz = n % 100;
    const oblik = z === 1 && zz !== 11 ? jedan : z >= 2 && z <= 4 && (zz < 12 || zz > 14) ? dva : pet;
    return `${n} ${oblik}`;
  }

  // ---------- ekran: administracija (djelatnici i odjeli) ----------
  function ekranAdmin(k) {
    const odjeli = Object.entries(D.odjeli);
    const osoblje = D.djelatnici.filter((d) => !d.admin)
      .sort((a, b) => String(a.odjel || '').localeCompare(String(b.odjel || '')) || a.ime.localeCompare(b.ime, 'hr'));
    const bezOdjela = osoblje.filter((d) => !d.odjel || !D.odjeli[d.odjel]).length;

    return `
      ${zaglavlje(k, 'admin')}
      <main>
        <h1 data-fokus tabindex="-1">Djelatnici i odjeli</h1>
        <p class="tiho">Djelatnik vidi samo pacijente odjela na koji je raspoređen. Promjena vrijedi odmah i bilježi se u zapisniku.</p>

        <section class="admin-sekcija" aria-labelledby="a-odjeli">
          <h2 id="a-odjeli">Odjeli</h2>
          <ul class="odjeli-lista">
            ${odjeli.map(([sifra, naziv]) => `
              <li>
                <span><strong>${esc(naziv)}</strong> <code>${esc(sifra)}</code></span>
                <span class="tiho">${mnozina(osobljeOdjela(sifra).length, 'djelatnik', 'djelatnika')}, ${mnozina(D.pacijenti.filter((p) => p.odjel === sifra).length, 'pacijent', 'pacijenta', 'pacijenata')}</span>
              </li>`).join('')}
          </ul>
          <details class="dodaj">
            <summary>Dodaj novi odjel</summary>
            <form id="forma-odjel" class="forma" autocomplete="off">
              <label for="o-naziv">Naziv odjela</label>
              <input id="o-naziv" name="naziv" required placeholder="npr. Neurologija, odjel A">
              <label for="o-sifra">Šifra</label>
              <input id="o-sifra" name="sifra" required pattern="[A-Za-z0-9\\-]{2,10}" title="2 do 10 slova, brojeva ili crtica" placeholder="npr. NEU-A">
              <p class="greska" id="greska-odjel" role="alert"></p>
              <button type="submit" class="gumb mali">Dodaj odjel</button>
            </form>
          </details>
        </section>

        <section class="admin-sekcija" aria-labelledby="a-djelatnici">
          <h2 id="a-djelatnici">Raspored djelatnika po odjelima</h2>
          ${bezOdjela ? `<p class="napomena">${bezOdjela} ${bezOdjela === 1 ? 'djelatnik nema' : 'djelatnika nema'} dodijeljen odjel.</p>` : ''}
          <ul class="djelatnici-lista">
            ${osoblje.map((d) => `
              <li>
                <label for="odj-${esc(d.id)}">
                  <strong>${esc(d.ime)}</strong>
                  <span class="tiho">${esc(d.uloga)}</span>
                </label>
                <select id="odj-${esc(d.id)}" data-promjena="odjel-djelatnika" data-id="${esc(d.id)}">
                  <option value="" ${d.odjel ? '' : 'selected'}>bez odjela</option>
                  ${odjeli.map(([s, n]) => `<option value="${esc(s)}" ${s === d.odjel ? 'selected' : ''}>${esc(n)}</option>`).join('')}
                </select>
              </li>`).join('')}
          </ul>
        </section>

        <p class="dno"><button type="button" class="poveznica" data-akcija="reset-admin">Vrati početne demo podatke (odjeli, raspored, novi pacijenti, dopune profila)</button></p>
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
      const opis = p ? (p.odjel === k.odjel ? `${p.soba}/${p.krevet} ${p.ime}` : `drugi odjel (${z.tag})`) : (z.tag || '');
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
    } else if (a === 'potvrdi' || a === 'odpotvrdi') {
      const set = potvrde[tag] || (potvrde[tag] = new Set());
      if (a === 'potvrdi') set.add(b.dataset.id); else set.delete(b.dataset.id);
      render(true);
    } else if (a === 'preuzmi') {
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
    } else if (a === 'tjedan') {
      const pomak = Number(b.dataset.pomak);
      tjedanPomak = pomak === 0 ? 0 : tjedanPomak + pomak;
      render(true);
    } else if (a === 'makni-iz-smjene') {
      if (!k || !k.admin) return;
      const kljuc = b.dataset.kljuc;
      const [odjel, dat, vrsta] = kljuc.split('|');
      const d = new Date(dat + 'T00:00');
      const ids = smjena(odjel, d, vrsta).map((x) => x.id).filter((id) => id !== b.dataset.id);
      spremiSmjenu(kljuc, ids);
      zabiljezi('izmjena rasporeda', null, `${imeDjelatnika(b.dataset.id)} uklonjen/a: ${odjel}, ${datum(dat)}, ${D.smjene[vrsta].naziv.toLowerCase()}`);
      render(true);
    } else if (a === 'ukloni-profil') {
      const p = pacijent(tag);
      if (!p || !k || p.odjel !== k.odjel) return;
      const sek = b.dataset.sekcija;
      p.profil[sek] = p.profil[sek].filter((x) => x.id !== b.dataset.id);
      const dodaci = store.get('profilDodaci', {});
      if (dodaci[tag] && dodaci[tag][sek]) dodaci[tag][sek] = dodaci[tag][sek].filter((x) => x.id !== b.dataset.id);
      store.set('profilDodaci', dodaci);
      zabiljezi('izmjena profila', tag, `uklonjena stavka: ${SEKCIJE[sek].naslov.toLowerCase()}`);
      render(true);
    } else if (a === 'reset-admin') {
      if (!k || !k.admin) return;
      if (confirm('Vratiti početne demo podatke? Brišu se novi odjeli, promjene odjela djelatnika, izmjene rasporeda, novi pacijenti i dopune profila.')) {
        ['odjeli', 'odjeliDjelatnika', 'raspored', 'noviPacijenti', 'profilDodaci'].forEach((x) => store.remove(x));
        zabiljezi('vraćeni početni demo podaci');
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
      const sve = store.get('biljeske', {});
      (sve[tag] = sve[tag] || []).push({ id: 'bk' + Date.now().toString(36), vrijeme: sadaZaZapis(), autor: korisnik().id, tekst });
      store.set('biljeske', sve);
      delete aiSazeci[tag];
      zabiljezi('bilješka uz krevet', tag);
      obavijest('Bilješka je spremljena.');
      render(true);
    } else if (f.id === 'forma-novi') {
      const k = korisnik();
      if (k && k.odjel && !k.admin) spremiNovogPacijenta(f, k);
    } else if (f.classList.contains('forma-profil')) {
      const k = korisnik();
      const tag = f.dataset.tag;
      const sek = f.dataset.sekcija;
      const p = pacijent(tag);
      if (!p || !k || p.odjel !== k.odjel || !SEKCIJE[sek]) return;
      const stavka = { id: 'd' + Date.now().toString(36), dodao: k.id };
      SEKCIJE[sek].polja.forEach((x) => { stavka[x.k] = (f.elements[x.k].value || '').trim(); });
      p.profil[sek].push(stavka);
      const dodaci = store.get('profilDodaci', {});
      dodaci[tag] = dodaci[tag] || {};
      (dodaci[tag][sek] = dodaci[tag][sek] || []).push(stavka);
      store.set('profilDodaci', dodaci);
      zabiljezi('izmjena profila', tag, `dodano: ${SEKCIJE[sek].naslov.toLowerCase()}`);
      obavijest(sek === 'alergije' ? 'Alergija je zabilježena i provjerava se u terapiji.' : 'Spremljeno u profil.');
      render(true);
    } else if (f.id === 'forma-odjel') {
      const k = korisnik();
      if (!k || !k.admin) return;
      const sifra = f.sifra.value.trim().toUpperCase();
      const naziv = f.naziv.value.trim();
      if (D.odjeli[sifra]) {
        document.getElementById('greska-odjel').textContent = `Odjel sa šifrom ${sifra} već postoji.`;
        return;
      }
      D.odjeli[sifra] = naziv;
      store.set('odjeli', { ...store.get('odjeli', {}), [sifra]: naziv });
      zabiljezi('dodan odjel', null, `${naziv} (${sifra})`);
      obavijest(`Odjel ${naziv} je dodan.`);
      render(true);
    } else if (f.id === 'forma-rucno') {
      const tag = f.querySelector('#rucni-id').value.trim();
      if (!tag) return;
      zatvoriSloj();
      delete pristup[tag];
      idi('p=' + encodeURIComponent(tag));
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-promjena]');
    if (!el) return;
    const k = korisnik();
    if (!k || !k.admin) return;
    const vrsta = el.dataset.promjena;

    if (vrsta === 'odjel-djelatnika') {
      const d = djelatnik(el.dataset.id);
      if (!d || d.admin) return;
      const staro = d.odjel;
      d.odjel = el.value || null;
      store.set('odjeliDjelatnika', { ...store.get('odjeliDjelatnika', {}), [d.id]: d.odjel });
      zabiljezi('promjena odjela', null, `${d.ime}: ${staro || 'bez odjela'} → ${d.odjel || 'bez odjela'}`);
      obavijest(`${d.ime}: ${d.odjel ? D.odjeli[d.odjel] : 'bez odjela'}.`);
      render(true);
    } else if (vrsta === 'raspored-odjel') {
      rasporedOdjel = el.value;
      render(true);
    } else if (vrsta === 'dodaj-u-smjenu' && el.value) {
      const kljuc = el.dataset.kljuc;
      const [odjel, dat, smj] = kljuc.split('|');
      const ids = smjena(odjel, new Date(dat + 'T00:00'), smj).map((x) => x.id);
      spremiSmjenu(kljuc, [...ids, el.value]);
      zabiljezi('izmjena rasporeda', null, `${imeDjelatnika(el.value)} dodan/a: ${odjel}, ${datum(dat)}, ${D.smjene[smj].naziv.toLowerCase()}`);
      render(true);
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
