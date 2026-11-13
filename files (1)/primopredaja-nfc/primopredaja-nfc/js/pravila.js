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

    // 2. Promjena terapije u zadnjih 12 h koja nije spomenuta ni u jednoj kasnijoj bilješci
    p.terapija
      .filter((x) => x.promjena && now - ms(x.od) < 12 * SAT)
      .forEach((x) => {
        const spomenuto = biljeske.some((b) =>
          ms(b.vrijeme) >= ms(x.od) && b.tekst.toLowerCase().includes(x.lijek.toLowerCase()));
        if (!spomenuto) {
          out.push({
            id: 'u-' + x.id,
            razina: 'upozorenje',
            naslov: 'Promjena terapije nije spomenuta u bilješkama',
            detalj: `${x.lijek} ${x.doza}: ${x.promjena} u ${vrijeme(x.od)}`,
            izvor: x.id
          });
        }
      });

    // 3. Vitalni znakovi: zadnje mjerenje i promjena od početka smjene
    const v = [...p.vitali].sort((a, b) => ms(a.vrijeme) - ms(b.vrijeme));
    if (v.length) {
      const z = v[v.length - 1];
      const prvi = v[0];
      const cilj = p.ciljSpO2 || [94, 100];
      const dodaj = (razina, naslov, detalj) =>
        out.push({ id: `u-${z.id}-${out.length}`, razina, naslov, detalj, izvor: z.id });

      if (z.spo2 < cilj[0]) {
        dodaj(z.spo2 < cilj[0] - 2 ? 'kriticno' : 'upozorenje', 'Saturacija ispod ciljne',
          `SpO2 ${z.spo2} % u ${vrijeme(z.vrijeme)} (cilj ${cilj[0]}–${cilj[1]} %, ranije ${prvi.spo2} %)`);
      }
      if (z.temp >= 38.5) {
        dodaj('upozorenje', 'Febrilitet', `${broj(z.temp)} °C u ${vrijeme(z.vrijeme)} (ranije ${broj(prvi.temp)} °C)`);
      }
      if (z.fp > 110 || z.fp < 50) {
        dodaj('kriticno', 'Srčana frekvencija izvan sigurnog raspona', `${z.fp}/min u ${vrijeme(z.vrijeme)}`);
      } else if (prvi.fp - z.fp >= 25) {
        dodaj('upozorenje', 'Nagli pad srčane frekvencije', `${prvi.fp}/min u ${vrijeme(prvi.vrijeme)}, ${z.fp}/min u ${vrijeme(z.vrijeme)}`);
      }
      if (z.sys < 100) {
        dodaj('upozorenje', 'Niski sistolički tlak', `${z.sys}/${z.dia} mmHg u ${vrijeme(z.vrijeme)}`);
      }
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
    if (p.terapija.length) dijelovi.push(`Terapija: ${p.terapija.map((x) => x.lijek).join(', ')}.`);
    return {
      tekst: dijelovi.join(' '),
      izvori: [zadnja && zadnja.id, ...p.terapija.map((x) => x.id)].filter(Boolean)
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
    p.terapija.forEach((x) => lista.push({
      id: x.id, vrsta: 'Terapija', vrijeme: x.od,
      tekst: `${x.lijek} ${x.doza}${x.promjena ? ` (${x.promjena})` : ''}`
    }));
    p.nalazi.forEach((x) => lista.push({
      id: x.id, vrsta: 'Nalaz', vrijeme: x.stiglo || x.naruceno,
      tekst: `${x.naziv}: ${x.stiglo ? opisNalaza(x) : 'na čekanju'}` +
        (x.stiglo ? (x.pregledao ? `, pregledao/la ${imeDjelatnika(x.pregledao)}` : ', NIJE PREGLEDAN') : '')
    }));
    p.vitali.forEach((x) => lista.push({
      id: x.id, vrsta: 'Vitalni znakovi', vrijeme: x.vrijeme,
      tekst: `FP ${x.fp}/min, RR ${x.sys}/${x.dia} mmHg, SpO2 ${x.spo2} %, T ${broj(x.temp)} °C, FD ${x.fd}/min`
    }));
    [...p.biljeske, ...dodatneBiljeske].forEach((x) => lista.push({
      id: x.id, vrsta: x.uzKrevet ? 'Bilješka uz krevet' : 'Bilješka', vrijeme: x.vrijeme,
      tekst: `${x.tekst} (${imeDjelatnika(x.autor)})`
    }));
    p.zadaci.forEach((x) => lista.push({
      id: x.id, vrsta: 'Zadatak', vrijeme: x.rok,
      tekst: `${x.opis}${x.gotovo ? ' (obavljeno)' : ''}`
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
    const z = v[v.length - 1];
    const prvi = v.length > 1 ? v[0] : null;
    const cilj = p.ciljSpO2 || [94, 100];
    const stavka = (oznaka, vrijednost, ranije, odstupa) => ({ oznaka, vrijednost, ranije, odstupa });

    const vitali = z ? {
      id: z.id,
      vrijeme: z.vrijeme,
      ranijeVrijeme: prvi ? prvi.vrijeme : null,
      stavke: [
        stavka('FP', `${z.fp}/min`, prvi && `${prvi.fp}/min`, z.fp > 110 || z.fp < 50 || (prvi && prvi.fp - z.fp >= 25)),
        stavka('RR', `${z.sys}/${z.dia} mmHg`, prvi && `${prvi.sys}/${prvi.dia}`, z.sys < 100),
        stavka('SpO2', `${z.spo2} %`, prvi && `${prvi.spo2} %`, z.spo2 < cilj[0]),
        stavka('T', `${broj(z.temp)} °C`, prvi && `${broj(prvi.temp)} °C`, z.temp >= 38.5),
        stavka('FD', `${z.fd}/min`, prvi && `${prvi.fd}/min`, false)
      ]
    } : null;

    const sviNalazi = [...p.nalazi]
      .sort((a, b) => ms(b.stiglo || b.naruceno) - ms(a.stiglo || a.naruceno))
      .map((n) => ({
        id: n.id,
        naziv: n.naziv,
        tekst: n.stiglo ? opisNalaza(n) : (n.opis || 'na čekanju'),
        vrijeme: n.stiglo || n.naruceno,
        status: !n.stiglo ? 'ceka' : n.pregledao ? 'pregledan' : 'nepregledan',
        izvanRef: izvanRef(n)
      }));

    const sveBiljeske = [...p.biljeske, ...dodatneBiljeske]
      .sort((a, b) => ms(b.vrijeme) - ms(a.vrijeme));

    return {
      vitali,
      nalazi: sviNalazi.slice(0, brojNalaza),
      nalaziJos: Math.max(0, sviNalazi.length - brojNalaza),
      terapija: p.terapija.map((x) => ({ id: x.id, lijek: x.lijek, doza: x.doza, od: x.od, promjena: x.promjena || null })),
      biljeske: sveBiljeske.slice(0, brojBiljeski)
        .map((b) => ({ id: b.id, vrijeme: b.vrijeme, autor: b.autor, tekst: b.tekst, uzKrevet: !!b.uzKrevet })),
      biljeskeJos: Math.max(0, sveBiljeske.length - brojBiljeski),
      zadaci: p.zadaci.filter((x) => !x.gotovo)
        .sort((a, b) => ms(a.rok) - ms(b.rok))
        .map((x) => ({ id: x.id, opis: x.opis, rok: x.rok, kasni: ms(x.rok) < now }))
    };
  }

  window.PRAVILA = { upozorenja, procjena, sazetak, akcije, zapisi, pregled, RAZINE, vrijeme, vrijemeDatum };
})();
