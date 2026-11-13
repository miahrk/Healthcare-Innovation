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
    } else if (a === 'demo-podaci') {
      if (confirm('Vratiti početne demo podatke? Brišu se preuzimanja, potvrde, bilješke i zapisnik, a vi se odjavljujete.')) {
        ['sesija', 'preuzimanja', 'biljeske', 'zapisnik', 'nakonPrijave']
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') zatvoriSloj();
  });

  window.addEventListener('hashchange', () => render());

  render();
  provjeriAI();
})();
