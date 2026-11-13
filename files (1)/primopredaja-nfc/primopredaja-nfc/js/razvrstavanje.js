/*
 * Razvrstavanje izgovorenog (ili upisanog) teksta u polja zapisa pacijenta.
 *
 * Namjerno pravila, a ne AI: prepoznaju se samo jasne fraze s brojevima ili poznatim
 * riječima ("tlak 120 na 80", "kalij 5,2", "uveden ceftriakson 2 g i.v.", "zadatak: ... u 22 sata").
 * Vrijednost izvan uvjerljivog raspona, dvosmislena ili nepotpuna fraza NE svrstava se
 * nego ostaje u općoj bilješci. Ništa se ne izmišlja: svaka vrijednost u polju postoji u
 * izgovorenom tekstu (polje "izvor" je doslovni dio teksta).
 *
 * Rezultat su samo NACRTI. Djelatnik ih mora pregledati, ispraviti i potvrditi (vidi app.js).
 *
 * Govor u tekst (Chrome) često vraća tekst bez interpunkcije, pa se fraze traže bilo gdje
 * u tekstu, a ne po rečenicama.
 */
(function () {
  const SAT = 3600 * 1000;
  const L = '\\p{L}';
  const PRIJE = `(?<![${L}\\d])`;       // početak riječi (radi i za č, ć, š, ž, đ)
  const POSLIJE = `(?![${L}])`;          // kraj riječi
  const BROJ = '(\\d+(?:[.,]\\d+)?)';
  const VEZA = '\\s*(?:je|iznosi|od|oko|:)?\\s*';

  const re = (izvor) => new RegExp(izvor, 'giu');
  const uBroj = (s) => Number(String(s).replace(',', '.'));
  const zarez = (x) => String(x).replace('.', ',');

  // ---------- vitalni znakovi ----------
  const VITALI = [
    {
      kljuc: 'tlak', naziv: 'Tlak',
      re: re(`${PRIJE}(?:krvni\\s+)?(?:tlak|rr)${POSLIJE}${VEZA}(\\d{2,3})\\s*(?:\\/|na|kroz|preko)\\s*(\\d{2,3})(?:\\s*(?:mmhg|mm\\s*hg|milimetara(?:\\s+žive)?))?`),
      vrijednosti: (m) => ({ sys: Number(m[1]), dia: Number(m[2]) }),
      uvjerljivo: (v) => v.sys >= 50 && v.sys <= 260 && v.dia >= 20 && v.dia <= 160 && v.sys > v.dia
    },
    {
      kljuc: 'fp', naziv: 'Srčana frekvencija',
      re: re(`${PRIJE}(?:puls|srčana\\s+frekvencija|frekvencija\\s+srca|fp|srce)${POSLIJE}${VEZA}(\\d{2,3})(?:\\s*(?:\\/\\s*min|u\\s+minuti|po\\s+minuti|otkucaja(?:\\s+u\\s+minuti)?))?`),
      vrijednosti: (m) => ({ fp: Number(m[1]) }),
      uvjerljivo: (v) => v.fp >= 20 && v.fp <= 250
    },
    {
      kljuc: 'spo2', naziv: 'Saturacija',
      re: re(`${PRIJE}(?:saturacija|spo2|sp\\s*o2|zasićenost(?:\\s+kisikom)?)${POSLIJE}${VEZA}(\\d{2,3})\\s*(?:%|posto)?`),
      vrijednosti: (m) => ({ spo2: Number(m[1]) }),
      uvjerljivo: (v) => v.spo2 >= 50 && v.spo2 <= 100
    },
    {
      kljuc: 'temp', naziv: 'Temperatura',
      re: re(`${PRIJE}(?:tjelesna\\s+temperatura|temperatura|temp|febrilan|febrilna|t(?=\\s*\\d{2}(?:[.,]\\d\\s*°|[.,]\\d|\\s*°)))${POSLIJE}${VEZA}(\\d{2}(?:[.,]\\d)?)\\s*(?:°\\s*c|°|stupnjeva(?:\\s+celzija)?|celzija)?`),
      vrijednosti: (m) => ({ temp: uBroj(m[1]) }),
      uvjerljivo: (v) => v.temp >= 33 && v.temp <= 43
    },
    {
      kljuc: 'fd', naziv: 'Frekvencija disanja',
      re: re(`${PRIJE}(?:frekvencija\\s+disanja|disanje|respiracija|respiracije|fd)${POSLIJE}${VEZA}(\\d{1,2})(?:\\s*(?:\\/\\s*min|u\\s+minuti|po\\s+minuti|udaha(?:\\s+u\\s+minuti)?))?`),
      vrijednosti: (m) => ({ fd: Number(m[1]) }),
      uvjerljivo: (v) => v.fd >= 4 && v.fd <= 60
    }
  ];

  // ---------- laboratorijski nalazi ----------
  // Referentni rasponi samo tamo gdje ih koriste i demo podaci (data.js); inače null, ne izmišljamo.
  // "raspon" je samo provjera uvjerljivosti (hvata i krivu jedinicu, npr. hemoglobin u g/dL).
  const NALAZI = [
    { naziv: 'Kalij (K+)', rijeci: 'kalij|kalija|kalijem', jedinica: 'mmol/L', ref: [3.5, 5.1], raspon: [1, 10] },
    { naziv: 'Natrij (Na+)', rijeci: 'natrij|natrija|natrijem', jedinica: 'mmol/L', ref: null, raspon: [100, 180] },
    { naziv: 'Kreatinin', rijeci: 'kreatinin|kreatinina', jedinica: 'µmol/L', ref: [64, 104], raspon: [10, 2000] },
    { naziv: 'CRP', rijeci: 'crp|c\\s+reaktivni\\s+protein', jedinica: 'mg/L', ref: [0, 5], raspon: [0, 600] },
    { naziv: 'Hemoglobin', rijeci: 'hemoglobin|hemoglobina|hb', jedinica: 'g/L', ref: null, raspon: [30, 250] },
    { naziv: 'GUK', rijeci: 'guk|glukoza|glukoze|glikemija|šećer', jedinica: 'mmol/L', ref: [4.4, 7.0], raspon: [1, 50] },
    { naziv: 'Leukociti', rijeci: 'leukociti|leukocita', jedinica: '×10⁹/L', ref: null, raspon: [0.1, 200] },
    { naziv: 'Troponin', rijeci: 'troponin|troponina', jedinica: 'ng/L', ref: null, raspon: [0, 100000] }
  ].map((n) => ({
    ...n,
    re: re(`${PRIJE}(?:${n.rijeci})${POSLIJE}(?:\\s+natašte)?${VEZA}${BROJ}(?![\\d])(?:\\s*(?:mmol\\/l|µmol\\/l|umol\\/l|mg\\/l|g\\/l|ng\\/l|milimola|mikromola))?`)
  }));

  // ---------- terapija ----------
  const OKIDACI_TERAPIJE = [
    { promjena: 'uveden', rijeci: 'uveden|uvedena|uvedeno|uvodim|uvodi\\s+se|započet|započeta|započinjem|ordiniran|ordinirana|ordiniram', trebaDozu: true },
    { promjena: 'ukinut', rijeci: 'ukinut|ukinuta|ukidam|ukida\\s+se|isključen|isključena|prekinut|prekinuta|obustavljen|obustavljena', trebaDozu: false },
    { promjena: 'doza povećana', rijeci: 'povećan|povećana|povećavam|povišen|povišena', trebaDozu: true },
    { promjena: 'doza smanjena', rijeci: 'smanjen|smanjena|smanjujem|snižen|snižena', trebaDozu: true },
    { promjena: 'jednokratno dan', rijeci: 'dan|dana|dano|primio|primila|apliciran|aplicirana|aplicirano', trebaDozu: true }
  ];
  const PUT = '(?:i\\.v\\.|iv|intravenski|p\\.o\\.|per\\s+os|oralno|s\\.c\\.|sc|supkutano|i\\.m\\.|im)';
  const UCESTALOST = '(?:\\d+\\s*x\\s*dnevno|\\d+\\s*puta\\s+dnevno|svakih\\s+\\d+\\s*(?:h|sati)|jednom\\s+dnevno|dvaput\\s+dnevno|navečer|ujutro)';
  const DOZA = `(\\d+(?:[.,]\\d+)?\\s*(?:mg|g|mcg|µg|ml|ij|i\\.j\\.|jedinica|j\\.?)${POSLIJE}(?:\\s*${PUT}${POSLIJE})?(?:\\s*${UCESTALOST})?)`;
  const NIJE_LIJEK = new Set(['je', 'se', 'mu', 'joj', 'na', 'u', 'i', 'bez', 'od', 'do', 'za', 'dan', 'dana', 'doza', 'dozu', 'terapija', 'terapiju', 'lijek', 'kisik']);
  const TERAPIJA = OKIDACI_TERAPIJE.map((o) => ({
    ...o,
    re: re(`${PRIJE}(${o.rijeci})${POSLIJE}\\s+(?:je\\s+|mu\\s+|joj\\s+)?(?:lijek\\s+)?(?:(?:doza|dozu)\\s+)?([${L}][${L}-]{2,})(?:\\s+(?:na\\s+)?${DOZA})?`)
  }));

  // ---------- zadaci ----------
  // "zadatak", "treba", "potrebno", "ne zaboraviti" su zadatak i bez vremena (rok se tada upisuje pri potvrdi).
  // "kontrola", "kontrolirati", "ponoviti", "provjeriti" su zadatak samo uz vrijeme; bez njega idu u bilješku.
  // "ne treba", "nije potrebno" nisu zadatak
  const ZADATAK_OKIDAC = re(`${PRIJE}(?<!(?:ne|nije)\\s)(zadatak|treba|potrebno\\s+je|potrebno|ne\\s+zaboraviti|kontrola|kontrolirati|ponoviti|provjeriti)${POSLIJE}\\s*:?\\s*`);
  const TREBA_VRIJEME = /^(kontrola|kontrolirati|ponoviti|provjeriti)$/i;
  const OPIS_BEZ_OKIDACA = /^(zadatak|treba|potrebno|potrebno\s+je|ne\s+zaboraviti)$/i;
  const VRIJEME_APS = new RegExp(`(?:(sutra)\\s+)?(?:(?:u|do|oko)\\s+)(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:sati|sata|sat|h)?${POSLIJE}(?:\\s+(ujutro|navečer|popodne|poslijepodne|noću))?(?:\\s+(sutra))?`, 'iu');
  const VRIJEME_REL = new RegExp(`(?:za)\\s+(\\d{1,2})\\s*(?:sati|sata|sat|h)${POSLIJE}`, 'iu');

  function izracunajRok(m, sada) {
    let h = Number(m[2]);
    const min = m[3] ? Number(m[3]) : 0;
    if (h > 23 || min > 59) return null;
    const dio = (m[4] || '').toLowerCase();
    if ((dio === 'navečer' || dio === 'popodne' || dio === 'poslijepodne') && h < 12) h += 12;
    const d = new Date(sada);
    d.setHours(h, min, 0, 0);
    if (m[1] || m[5]) d.setDate(d.getDate() + 1);
    else if (d.getTime() <= new Date(sada).getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  // Vrijeme odmah iza lijeka ili nalaza ("u 18 sati", "u 17:30"): kada je lijek dan ili nalaz stigao.
  // Uzima se samo vrijeme koje je danas već prošlo; buduće vrijeme ostaje u tekstu.
  const VRIJEME_IZA = new RegExp(`^\\s*,?\\s+(?:u|oko)\\s+(\\d{1,2})(?:[:.](\\d{2})\\s*(?:sati|sata|sat|h)?|\\s*(?:sati|sata|sat|h))${POSLIJE}`, 'iu');
  function vrijemeIza(tekst, poz, sada) {
    const m = tekst.slice(poz).match(VRIJEME_IZA);
    if (!m) return null;
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    const d = new Date(sada);
    d.setHours(h, min, 0, 0);
    if (d.getTime() > new Date(sada).getTime()) return null;
    return { kraj: poz + m[0].length, iso: d.toISOString() };
  }

  // ---------- pomoćno ----------
  function normaliziraj(tekst) {
    return String(tekst || '')
      .replace(/\s+/g, ' ')
      .replace(/(\d+)\s+(?:zarez|cijela|cijelih|točka)\s+(\d+)/giu, '$1,$2')
      .trim();
  }

  const preklapa = (a, zauzeto) => zauzeto.some((z) => a.od < z.do && z.od < a.do);
  const VEZNICI = /^(?:i|a|te|pa|zatim|onda|također|bilješka|napomena)(?![\p{L}])\s*:?\s*/iu;
  const VEZNICI_KRAJ = /\s+(?:i|a|te|pa|zatim|onda)$/iu;

  function ocisti(dio) {
    let s = dio.replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '');
    let prije;
    do {
      prije = s;
      s = s.replace(VEZNICI, '').replace(VEZNICI_KRAJ, '').replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '');
    } while (s !== prije);
    return /\p{L}{2,}/u.test(s) ? s : '';
  }

  // ---------- glavna funkcija ----------
  function razvrstaj(tekstUlaz, sada) {
    const tekst = normaliziraj(tekstUlaz);
    const polja = [];
    const napomene = [];
    const zauzeto = [];   // dijelovi teksta koji su svrstani u polje
    if (!tekst) return { tekst, polja, napomene };

    const isjecak = (m) => ({ od: m.index, do: m.index + m[0].length, izvor: m[0].trim() });

    // 1. vitalni znakovi: svi u jedno polje
    const vitali = {};
    const izvoriVitala = [];
    for (const v of VITALI) {
      const nadeno = [...tekst.matchAll(v.re)].map((m) => ({ ...isjecak(m), vrijednosti: v.vrijednosti(m) }));
      const uvjerljivi = nadeno.filter((n) => {
        if (v.uvjerljivo(n.vrijednosti)) return true;
        napomene.push(`${v.naziv} izvan uvjerljivog raspona („${n.izvor}”), ostavljeno u bilješci.`);
        return false;
      });
      const razlicite = new Set(uvjerljivi.map((n) => JSON.stringify(n.vrijednosti)));
      if (razlicite.size > 1) {
        napomene.push(`${v.naziv} je izgovoren više puta s različitim vrijednostima, ostavljeno u bilješci.`);
        continue;
      }
      uvjerljivi.forEach((n) => {
        if (preklapa(n, zauzeto)) return;
        zauzeto.push(n);
        Object.assign(vitali, n.vrijednosti);
        izvoriVitala.push(n);
      });
    }
    if (izvoriVitala.length) {
      izvoriVitala.sort((a, b) => a.od - b.od);
      polja.push({ vrsta: 'vitali', podaci: vitali, izvor: izvoriVitala.map((x) => x.izvor).join(' · '), od: izvoriVitala[0].od });
    }

    // 2. laboratorijski nalazi
    for (const n of NALAZI) {
      for (const m of tekst.matchAll(n.re)) {
        const s = isjecak(m);
        if (preklapa(s, zauzeto)) continue;
        const vrijednost = uBroj(m[1]);
        if (vrijednost < n.raspon[0] || vrijednost > n.raspon[1]) {
          napomene.push(`${n.naziv} izvan uvjerljivog raspona („${s.izvor}”), ostavljeno u bilješci.`);
          continue;
        }
        const kada = vrijemeIza(tekst, s.do, sada);
        if (kada) { s.do = kada.kraj; s.izvor = tekst.slice(s.od, s.do).trim(); }
        zauzeto.push(s);
        polja.push({
          vrsta: 'nalaz',
          podaci: { naziv: n.naziv, vrijednost, jedinica: n.jedinica, ref: n.ref, stiglo: kada ? kada.iso : null },
          izvor: s.izvor, od: s.od
        });
      }
    }

    // 3. terapija
    for (const t of TERAPIJA) {
      for (const m of tekst.matchAll(t.re)) {
        const lijekRijec = m[2];
        const doza = m[3] ? m[3].trim() : '';
        if (NIJE_LIJEK.has(lijekRijec.toLowerCase()) || /\d/.test(lijekRijec)) continue;
        if (t.trebaDozu && !doza) {
          if (t.promjena !== 'jednokratno dan') napomene.push(`Promjena terapije bez doze („${m[0].trim()}”), ostavljeno u bilješci.`);
          continue;
        }
        // bez doze uzimamo samo okidač i lijek, ne i ostatak
        let kraj = doza ? m.index + m[0].length : m.index + m[0].indexOf(lijekRijec) + lijekRijec.length;
        const kada = vrijemeIza(tekst, kraj, sada);
        if (kada) kraj = kada.kraj;
        const s = { od: m.index, do: kraj, izvor: tekst.slice(m.index, kraj).trim() };
        if (preklapa(s, zauzeto)) continue;
        zauzeto.push(s);
        polja.push({
          vrsta: 'terapija',
          podaci: { lijek: lijekRijec.charAt(0).toUpperCase() + lijekRijec.slice(1), doza, promjena: t.promjena, od: kada ? kada.iso : null },
          izvor: s.izvor, od: s.od
        });
      }
    }

    // 4. zadaci: opis do vremena, do kraja rečenice ili do sljedećeg svrstanog dijela
    for (const m of tekst.matchAll(ZADATAK_OKIDAC)) {
      if (preklapa({ od: m.index, do: m.index + m[0].length }, zauzeto)) continue;
      const pocetakOpisa = m.index + m[0].length;
      const krajRecenice = (() => {
        const r = tekst.slice(pocetakOpisa).search(/[.;!?]/);
        return r < 0 ? tekst.length : pocetakOpisa + r;
      })();
      const sljedeci = zauzeto.filter((z) => z.od >= pocetakOpisa).reduce((min, z) => Math.min(min, z.od), tekst.length);
      let kraj = Math.min(krajRecenice, sljedeci);
      const dio = tekst.slice(pocetakOpisa, kraj);

      let rok = null;
      let krajOpisa = dio.length;
      const aps = dio.match(VRIJEME_APS);
      const rel = dio.match(VRIJEME_REL);
      const prvo = [aps, rel].filter(Boolean).sort((a, b) => a.index - b.index)[0];
      if (prvo === aps) {
        rok = izracunajRok(aps, sada);
        // "sutra u 6 sati": "sutra" ispred vremena nije dio opisa
        if (rok) {
          krajOpisa = aps.index;
          kraj = pocetakOpisa + aps.index + aps[0].length;
        }
      } else if (prvo === rel) {
        const sati = Number(rel[1]);
        if (sati >= 1 && sati <= 48) {
          rok = new Date(new Date(sada).getTime() + sati * SAT).toISOString();
          krajOpisa = rel.index;
          kraj = pocetakOpisa + rel.index + rel[0].length;
        }
      }
      if (!rok && TREBA_VRIJEME.test(m[1])) continue;   // npr. "kontrola elektrolita" bez vremena ostaje bilješka

      const okidac = m[1].replace(/\s+/g, ' ');
      let opis = dio.slice(0, krajOpisa).replace(/\s+sutra\s*$/i, '').replace(/[\s,;:–-]+$/, '').trim();
      if (!OPIS_BEZ_OKIDACA.test(okidac)) opis = `${okidac} ${opis}`.trim();
      if (!/\p{L}{2,}/u.test(opis) || (OPIS_BEZ_OKIDACA.test(okidac) && !opis)) continue;
      opis = opis.charAt(0).toUpperCase() + opis.slice(1);

      const s = { od: m.index, do: kraj, izvor: tekst.slice(m.index, kraj).trim() };
      zauzeto.push(s);
      polja.push({ vrsta: 'zadatak', podaci: { opis, rok }, izvor: s.izvor, od: s.od });
    }

    // 5. sve što nije svrstano: opća bilješka
    zauzeto.sort((a, b) => a.od - b.od);
    const ostatak = [];
    let poz = 0;
    for (const z of zauzeto) {
      if (z.od > poz) ostatak.push(tekst.slice(poz, z.od));
      poz = Math.max(poz, z.do);
    }
    ostatak.push(tekst.slice(poz));
    const dijelovi = ostatak.map(ocisti).filter(Boolean);
    if (dijelovi.length) {
      // " … " pokazuje da je između dijelova bio tekst koji je svrstan u polja
      let biljeska = dijelovi.map((d) => d.replace(/[.]+$/, '')).join(' … ') + '.';
      biljeska = biljeska.charAt(0).toUpperCase() + biljeska.slice(1);
      polja.push({ vrsta: 'biljeska', podaci: { tekst: biljeska }, izvor: dijelovi.join(' … '), od: Infinity });
    }

    polja.sort((a, b) => a.od - b.od);
    polja.forEach((p, i) => { p.id = 'g' + (i + 1); delete p.od; });
    return { tekst, polja, napomene };
  }

  // Kratki opis polja za prikaz i zapisnik
  function opisPolja(p) {
    const d = p.podaci;
    if (p.vrsta === 'vitali') {
      const s = [];
      if (d.fp != null) s.push(`FP ${d.fp}/min`);
      if (d.sys != null) s.push(`RR ${d.sys}/${d.dia} mmHg`);
      if (d.spo2 != null) s.push(`SpO2 ${d.spo2} %`);
      if (d.temp != null) s.push(`T ${zarez(d.temp)} °C`);
      if (d.fd != null) s.push(`FD ${d.fd}/min`);
      return s.join(', ');
    }
    if (p.vrsta === 'nalaz') return `${d.naziv}: ${zarez(d.vrijednost)} ${d.jedinica}`;
    if (p.vrsta === 'terapija') return `${d.lijek}${d.doza ? ' ' + d.doza : ''} (${d.promjena})`;
    if (p.vrsta === 'zadatak') return d.opis;
    return d.tekst;
  }

  window.RAZVRSTAVANJE = { razvrstaj, opisPolja, normaliziraj };
})();
