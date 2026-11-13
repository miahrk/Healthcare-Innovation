/*
 * Pravila za upozorenja i I-PASS sažetak.
 *
 * Upozorenja su namjerno pravila, a ne AI: moraju biti predvidljiva i provjerljiva,
 * pa AI ne može "zaboraviti" kritičan nalaz. AI se koristi samo za tekstualni sažetak
 * (vidi server/), i to uz obavezne poveznice na izvorne zapise.
 */
(function () {
  const SAT = 3600 * 1000;
  const RANG = { stabilan: 0, nadzor: 1, nestabilan: 2 };
  const RAZINE = ['Stabilan', 'Pojačan nadzor', 'Zahtijeva hitnu pozornost'];
  const REDOSLIJED = { kriticno: 0, upozorenje: 1, info: 2 };

  const ms = (iso) => new Date(iso).getTime();
  const broj = (x) => String(x).replace('.', ',');

  function vrijeme(iso) {
    return new Date(iso).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
  }

  function vrijemeDatum(iso) {
    return new Date(iso).toLocaleString('hr-HR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function izvanRef(n) {
    return typeof n.vrijednost === 'number' && Array.isArray(n.ref) &&
      (n.vrijednost < n.ref[0] || n.vrijednost > n.ref[1]);
  }

  function opisNalaza(n) {
    if (typeof n.vrijednost === 'number') {
      const ref = n.ref ? ` (ref. ${broj(n.ref[0])}–${broj(n.ref[1])})` : '';
      return `${broj(n.vrijednost)} ${n.jedinica}${ref}`;
    }
    return n.opis || '';
  }

  // Za svaki vitalni znak: prvo i zadnje mjerenje u kojem taj znak postoji
  const ZNAKOVI = ['fp', 'sys', 'dia', 'spo2', 'temp', 'fd'];
  function poZnaku(vitali) {
    const v = [...vitali].sort((a, b) => ms(a.vrijeme) - ms(b.vrijeme));
    const out = {};
    ZNAKOVI.forEach((k) => {
      const s = v.filter((x) => typeof x[k] === 'number');
      if (s.length) out[k] = { z: s[s.length - 1], prvi: s[0] };
    });
    return out;
  }

  function opisVitala(x) {
    const d = [];
    if (typeof x.fp === 'number') d.push(`FP ${x.fp}/min`);
    if (typeof x.sys === 'number') d.push(`RR ${x.sys}/${x.dia} mmHg`);
    if (typeof x.spo2 === 'number') d.push(`SpO2 ${x.spo2} %`);
    if (typeof x.temp === 'number') d.push(`T ${broj(x.temp)} °C`);
    if (typeof x.fd === 'number') d.push(`FD ${x.fd}/min`);
    return d.join(', ');
  }

  function upozorenja(p, sada, dodatneBiljeske = []) {
    const now = ms(sada);
    const biljeske = [...p.biljeske, ...dodatneBiljeske];
    const out = [];

    // 1. Nalazi koji su stigli, a nitko ih nije pregledao
    p.nalazi.forEach((n) => {
      if (n.stiglo && !n.pregledao) {
        const abn = izvanRef(n);
        out.push({
          id: 'u-' + n.id,
          razina: abn ? 'kriticno' : 'upozorenje',
          naslov: abn ? `${n.naziv} izvan referentnog raspona, nalaz nije pregledan` : `${n.naziv} je stigao, nalaz nije pregledan`,
          detalj: `${opisNalaza(n)}, stigao u ${vrijeme(n.stiglo)}`,
          izvor: n.id
        });
      } else if (!n.stiglo) {
        out.push({
          id: 'u-' + n.id,
          razina: 'info',
          naslov: `Nalaz na čekanju: ${n.naziv}`,
          detalj: `Naručeno u ${vrijeme(n.naruceno)}${n.opis ? ', ' + n.opis : ''}`,
          izvor: n.id
        });
      }
    });

    // 2. Promjena terapije u zadnjih 12 h koja nije spomenuta ni u jednoj kasnijoj bilješci.
    //    Jednokratna doza nije promjena propisane terapije; zamijenjeni zapis (neaktivno) pokriva novi zapis.
    p.terapija
      .filter((x) => x.promjena && !x.jednokratno && !x.neaktivno && now - ms(x.od) < 12 * SAT)
      .forEach((x) => {
        const spomenuto = biljeske.some((b) =>
          ms(b.vrijeme) >= ms(x.od) && b.tekst.toLowerCase().includes(x.lijek.toLowerCase()));
        if (!spomenuto) {
          out.push({
            id: 'u-' + x.id,
            razina: 'upozorenje',
            naslov: 'Promjena terapije nije spomenuta u bilješkama',
            detalj: `${x.lijek}${x.doza ? ' ' + x.doza : ''}: ${x.promjena} u ${vrijeme(x.od)}`,
            izvor: x.id
          });
        }
      });

    // 3. Vitalni znakovi: zadnje mjerenje i promjena od početka smjene, za svaki znak posebno
    //    (glasovni unos može imati samo neke znakove, npr. samo puls)
    const pk = poZnaku(p.vitali);
    const cilj = p.ciljSpO2 || [94, 100];
    const dodaj = (z, razina, naslov, detalj) =>
      out.push({ id: `u-${z.id}-${out.length}`, razina, naslov, detalj, izvor: z.id });

    if (pk.spo2 && pk.spo2.z.spo2 < cilj[0]) {
      const { z, prvi } = pk.spo2;
      dodaj(z, z.spo2 < cilj[0] - 2 ? 'kriticno' : 'upozorenje', 'Saturacija ispod ciljne',
        `SpO2 ${z.spo2} % u ${vrijeme(z.vrijeme)} (cilj ${cilj[0]}–${cilj[1]} %, ranije ${prvi.spo2} %)`);
    }
    if (pk.temp && pk.temp.z.temp >= 38.5) {
      const { z, prvi } = pk.temp;
      dodaj(z, 'upozorenje', 'Febrilitet', `${broj(z.temp)} °C u ${vrijeme(z.vrijeme)} (ranije ${broj(prvi.temp)} °C)`);
    }
    if (pk.fp) {
      const { z, prvi } = pk.fp;
      if (z.fp > 110 || z.fp < 50) {
        dodaj(z, 'kriticno', 'Srčana frekvencija izvan sigurnog raspona', `${z.fp}/min u ${vrijeme(z.vrijeme)}`);
      } else if (prvi.fp - z.fp >= 25) {
        dodaj(z, 'upozorenje', 'Nagli pad srčane frekvencije', `${prvi.fp}/min u ${vrijeme(prvi.vrijeme)}, ${z.fp}/min u ${vrijeme(z.vrijeme)}`);
      }
    }
    if (pk.sys && pk.sys.z.sys < 100) {
      const { z } = pk.sys;
      dodaj(z, 'upozorenje', 'Niski sistolički tlak', `${z.sys}/${z.dia} mmHg u ${vrijeme(z.vrijeme)}`);
    }

    // 4. Zadaci kojima je prošao rok
    p.zadaci.filter((x) => !x.gotovo && ms(x.rok) < now).forEach((x) => {
      out.push({
        id: 'u-' + x.id,
        razina: 'upozorenje',
        naslov: 'Zadatak kasni',
        detalj: `${x.opis}, rok je bio ${vrijeme(x.rok)}`,
        izvor: x.id
      });
    });

    return out.sort((a, b) => REDOSLIJED[a.razina] - REDOSLIJED[b.razina]);
  }

  // Procjena težine stanja: stanje koje je upisao liječnik, podignuto ako postoje upozorenja
  function procjena(p, upoz) {
    let r = RANG[p.stanje] ?? 0;
    if (upoz.some((u) => u.razina === 'kriticno')) r = 2;
    else if (upoz.some((u) => u.razina === 'upozorenje')) r = Math.max(r, 1);
    return r;
  }

  // Sažetak iz pravila (radi bez AI-ja i bez interneta)
  function sazetak(p, dodatneBiljeske = []) {
    const bilj = [...p.biljeske, ...dodatneBiljeske].sort((a, b) => ms(a.vrijeme) - ms(b.vrijeme));
    const zadnja = bilj[bilj.length - 1];
    const dijelovi = [`${p.dob} god. ${p.dg}.`];
    if (zadnja) dijelovi.push(`Zadnja bilješka (${vrijeme(zadnja.vrijeme)}): ${zadnja.tekst}`);
    // samo terapija koja je i dalje propisana (bez ukinute, zamijenjene i jednokratne)
    const aktivna = p.terapija.filter((x) => !x.neaktivno && !x.jednokratno && x.promjena !== 'ukinut');
    if (aktivna.length) dijelovi.push(`Terapija: ${aktivna.map((x) => x.lijek).join(', ')}.`);
    return {
      tekst: dijelovi.join(' '),
      izvori: [zadnja && zadnja.id, ...aktivna.map((x) => x.id)].filter(Boolean)
    };
  }

  // Akcijska lista za sljedeću smjenu (13 h unaprijed) i nalazi koje treba provjeriti
  function akcije(p, sada) {
    const now = ms(sada);
    const granica = now + 13 * SAT;
    const zadaci = p.zadaci
      .filter((x) => !x.gotovo && ms(x.rok) <= granica)
      .sort((a, b) => ms(a.rok) - ms(b.rok))
      .map((x) => ({ tekst: x.opis, rok: x.rok, kasni: ms(x.rok) < now, izvor: x.id }));
    const nalazi = p.nalazi
      .filter((x) => !x.stiglo)
      .map((x) => ({ tekst: `Provjeriti nalaz: ${x.naziv}`, rok: null, kasni: false, izvor: x.id }));
    return [...zadaci, ...nalazi];
  }

  // Svi izvorni zapisi pacijenta, s ID-evima na koje se pozivaju sažetak i upozorenja
  function zapisi(p, dodatneBiljeske = [], imeDjelatnika = (id) => id) {
    const lista = [];
    // zapisi iz potvrđenog glasovnog unosa nose oznaku tko ih je potvrdio
    const glas = (x) => (x.glas ? `; glasovni unos, potvrdio/la ${imeDjelatnika(x.potvrdio)}` : '');
    p.terapija.forEach((x) => lista.push({
      id: x.id, vrsta: 'Terapija', vrijeme: x.od,
      tekst: `${x.lijek}${x.doza ? ' ' + x.doza : ''}${x.promjena ? ` (${x.promjena})` : ''}` +
        `${x.neaktivno ? ' (zamijenjeno kasnijim zapisom)' : ''}${glas(x)}`
    }));
    p.nalazi.forEach((x) => lista.push({
      id: x.id, vrsta: 'Nalaz', vrijeme: x.stiglo || x.naruceno,
      tekst: `${x.naziv}: ${x.stiglo ? opisNalaza(x) : 'na čekanju'}` +
        (x.glas ? glas(x) : x.stiglo ? (x.pregledao ? `, pregledao/la ${imeDjelatnika(x.pregledao)}` : ', NIJE PREGLEDAN') : '')
    }));
    p.vitali.forEach((x) => lista.push({
      id: x.id, vrsta: 'Vitalni znakovi', vrijeme: x.vrijeme,
      tekst: opisVitala(x) + glas(x)
    }));
    [...p.biljeske, ...dodatneBiljeske].forEach((x) => lista.push({
      id: x.id, vrsta: x.uzKrevet ? 'Bilješka uz krevet' : 'Bilješka', vrijeme: x.vrijeme,
      tekst: `${x.tekst} (${imeDjelatnika(x.autor)}${x.glas ? ', glasovni unos' : ''})`
    }));
    p.zadaci.forEach((x) => lista.push({
      id: x.id, vrsta: 'Zadatak', vrijeme: x.rok,
      tekst: `${x.opis}${x.gotovo ? ' (obavljeno)' : ''}${glas(x)}`
    }));
    const sTimom = lista.sort((a, b) => ms(b.vrijeme) - ms(a.vrijeme));
    p.akoOnda.forEach((x) => sTimom.push({
      id: x.id, vrsta: 'Plan', vrijeme: null, tekst: `Ako ${x.ako}: ${x.onda}`
    }));
    return sTimom;
  }

  // Brzi pregled za primopredaju: zadnji vitalni znakovi, zadnji nalazi, terapija,
  // zadnje bilješke i otvoreni zadaci. Pragovi za "odstupa" isti su kao u pravilima za upozorenja.
  function pregled(p, sada, dodatneBiljeske = [], brojNalaza = 3, brojBiljeski = 2) {
    const now = ms(sada);
    const v = [...p.vitali].sort((a, b) => ms(a.vrijeme) - ms(b.vrijeme));
    const zadnji = v[v.length - 1];
    const pk = poZnaku(v);
    const cilj = p.ciljSpO2 || [94, 100];
    // Svaki znak iz svog zadnjeg mjerenja; "ranije" samo ako postoji raniji zapis tog znaka.
    // vrijeme/izvor stavke razlikuju se od zajedničkih samo kod djelomičnih (glasovnih) mjerenja.
    const stavka = (kljuc, oznaka, fmt, odstupa) => {
      const m = pk[kljuc];
      if (!m) return null;
      const ranije = m.prvi !== m.z ? m.prvi : null;
      return {
        oznaka, vrijednost: fmt(m.z), ranije: ranije && fmt(ranije, true),
        odstupa: !!odstupa(m.z, m.prvi), vrijeme: m.z.vrijeme, izvor: m.z.id, glas: !!m.z.glas
      };
    };

    const vitali = zadnji ? {
      id: zadnji.id,
      vrijeme: zadnji.vrijeme,
      ranijeVrijeme: v.length > 1 ? v[0].vrijeme : null,
      stavke: [
        stavka('fp', 'FP', (x) => `${x.fp}/min`, (z, prvi) => z.fp > 110 || z.fp < 50 || prvi.fp - z.fp >= 25),
        stavka('sys', 'RR', (x, kratko) => `${x.sys}/${x.dia}${kratko ? '' : ' mmHg'}`, (z) => z.sys < 100),
        stavka('spo2', 'SpO2', (x) => `${x.spo2} %`, (z) => z.spo2 < cilj[0]),
        stavka('temp', 'T', (x) => `${broj(x.temp)} °C`, (z) => z.temp >= 38.5),
        stavka('fd', 'FD', (x) => `${x.fd}/min`, () => false)
      ].filter(Boolean)
    } : null;

    const sviNalazi = [...p.nalazi]
      .sort((a, b) => ms(b.stiglo || b.naruceno) - ms(a.stiglo || a.naruceno))
      .map((n) => ({
        id: n.id,
        naziv: n.naziv,
        tekst: n.stiglo ? opisNalaza(n) : (n.opis || 'na čekanju'),
        vrijeme: n.stiglo || n.naruceno,
        status: !n.stiglo ? 'ceka' : n.pregledao ? 'pregledan' : 'nepregledan',
        izvanRef: izvanRef(n),
        glas: !!n.glas
      }));

    const sveBiljeske = [...p.biljeske, ...dodatneBiljeske]
      .sort((a, b) => ms(b.vrijeme) - ms(a.vrijeme));

    return {
      vitali,
      nalazi: sviNalazi.slice(0, brojNalaza),
      nalaziJos: Math.max(0, sviNalazi.length - brojNalaza),
      // zamijenjeni zapisi (npr. stara doza) se ne prikazuju; ukinuti lijek se prikazuje s oznakom
      terapija: p.terapija.filter((x) => !x.neaktivno)
        .map((x) => ({ id: x.id, lijek: x.lijek, doza: x.doza, od: x.od, promjena: x.promjena || null, glas: !!x.glas })),
      biljeske: sveBiljeske.slice(0, brojBiljeski)
        .map((b) => ({ id: b.id, vrijeme: b.vrijeme, autor: b.autor, tekst: b.tekst, uzKrevet: !!b.uzKrevet, glas: !!b.glas })),
      biljeskeJos: Math.max(0, sveBiljeske.length - brojBiljeski),
      zadaci: p.zadaci.filter((x) => !x.gotovo)
        .sort((a, b) => ms(a.rok) - ms(b.rok))
        .map((x) => ({ id: x.id, opis: x.opis, rok: x.rok, kasni: ms(x.rok) < now, glas: !!x.glas }))
    };
  }

  // Potvrđeni glasovni unosi spojeni u zapis pacijenta (kopija; izvorni podaci se ne mijenjaju).
  // Ukidanje ili promjena doze lijeka koji već postoji označava stari zapis kao zamijenjen (neaktivno).
  const ZAMJENJUJE = ['ukinut', 'doza povećana', 'doza smanjena'];
  const istiLijek = (a, b) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    // "furosemida" (izgovoreno u genitivu) je isti lijek kao "Furosemid"
    return a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
  };

  function spojiUnose(p, unosi = []) {
    if (!unosi.length) return p;
    const q = {
      ...p,
      terapija: p.terapija.map((x) => ({ ...x })),
      nalazi: [...p.nalazi], vitali: [...p.vitali], biljeske: [...p.biljeske], zadaci: [...p.zadaci]
    };
    [...unosi].sort((a, b) => ms(a.potvrdeno) - ms(b.potvrdeno)).forEach((u) => {
      const d = u.podaci;
      const g = { glas: true, potvrdio: u.potvrdio, potvrdeno: u.potvrdeno };
      if (u.vrsta === 'vitali') {
        q.vitali.push({ id: u.id, vrijeme: u.potvrdeno, ...d, ...g });
      } else if (u.vrsta === 'nalaz') {
        const kada = d.stiglo || u.potvrdeno;
        q.nalazi.push({
          id: u.id, naziv: d.naziv, vrijednost: d.vrijednost, jedinica: d.jedinica, ref: d.ref || null,
          naruceno: kada, stiglo: kada, pregledao: u.potvrdio, ...g
        });
      } else if (u.vrsta === 'terapija') {
        if (ZAMJENJUJE.includes(d.promjena)) {
          q.terapija.forEach((t) => { if (!t.neaktivno && istiLijek(t.lijek, d.lijek)) t.neaktivno = true; });
        }
        q.terapija.push({
          id: u.id, lijek: d.lijek, doza: d.doza, od: d.od || u.potvrdeno, promjena: d.promjena,
          jednokratno: d.promjena === 'jednokratno dan', ...g
        });
      } else if (u.vrsta === 'zadatak') {
        q.zadaci.push({ id: u.id, opis: d.opis, rok: d.rok, gotovo: false, ...g });
      } else if (u.vrsta === 'biljeska') {
        q.biljeske.push({ id: u.id, vrijeme: u.potvrdeno, autor: u.potvrdio, tekst: d.tekst, ...g });
      }
    });
    return q;
  }

  window.PRAVILA = { upozorenja, procjena, sazetak, akcije, zapisi, pregled, spojiUnose, RAZINE, vrijeme, vrijemeDatum };
})();
