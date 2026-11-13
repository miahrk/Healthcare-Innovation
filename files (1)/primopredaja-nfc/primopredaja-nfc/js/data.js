/*
 * SINTETIČKI PODACI ZA DEMO.
 * Svi pacijenti, djelatnici i nalazi su izmišljeni. Ne unosite stvarne podatke o pacijentima.
 *
 * Vrijeme demo smjene je fiksno: danas 18:55, pet minuta prije kraja dnevne smjene,
 * kako bi demo uvijek izgledao isto bez obzira kada ga pokrenete.
 */
(function () {
  const danas = new Date();

  // t('18:50') = danas u 18:50; t('06:00', 1) = sutra u 06:00; t('08:00', -2) = prekjučer
  function t(hhmm, dan = 0) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(danas);
    d.setDate(d.getDate() + dan);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  // Datum (YYYY-MM-DD) prije n dana, za povijest bolesti
  function prije(n) {
    const d = new Date(danas);
    d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Datum rođenja koji odgovara zadanoj dobi danas
  function rodjen(dob, mj, dan) {
    const rodjendanProsao = (danas.getMonth() + 1) * 100 + danas.getDate() >= mj * 100 + dan;
    const god = danas.getFullYear() - dob - (rodjendanProsao ? 0 : 1);
    return god + '-' + String(mj).padStart(2, '0') + '-' + String(dan).padStart(2, '0');
  }

  window.APP_DATA = {
    sada: t('18:55'),
    smjena: { od: t('07:00'), do: t('19:00') },

    odjeli: {
      'INT-B': 'Interna klinika, odjel B',
      'KIR-A': 'Kirurgija, odjel A'
    },

    // PIN-ovi su samo za demo. U stvarnom sustavu prijava ide preko bolničkog sustava ili službene kartice.
    // vrsta: 'lijecnik' ili 'sestra' (za raspored smjena); admin nema odjel ni pristup pacijentima.
    djelatnici: [
      { id: 'S00', ime: 'Sanja Lovrić', uloga: 'administratorica sustava', odjel: null, pin: '9999', admin: true },
      { id: 'S01', ime: 'dr. Ana Kovač', uloga: 'odjelna liječnica', odjel: 'INT-B', pin: '1111', vrsta: 'lijecnik' },
      { id: 'S02', ime: 'dr. Luka Radić', uloga: 'dežurni liječnik', odjel: 'INT-B', pin: '2222', vrsta: 'lijecnik' },
      { id: 'S03', ime: 'Ivana Tomić', uloga: 'medicinska sestra', odjel: 'INT-B', pin: '3333', vrsta: 'sestra' },
      { id: 'S04', ime: 'dr. Marko Grgić', uloga: 'kirurg', odjel: 'KIR-A', pin: '4444', vrsta: 'lijecnik' },
      { id: 'S05', ime: 'Petra Horvat', uloga: 'medicinska sestra', odjel: 'INT-B', pin: '5555', vrsta: 'sestra' },
      { id: 'S06', ime: 'Tomislav Babić', uloga: 'medicinski tehničar', odjel: 'INT-B', pin: '6666', vrsta: 'sestra' },
      { id: 'S07', ime: 'dr. Nina Perković', uloga: 'specijalizantica interne medicine', odjel: 'INT-B', pin: '7777', vrsta: 'lijecnik' },
      { id: 'S08', ime: 'dr. Ivan Matić', uloga: 'kirurg', odjel: 'KIR-A', pin: '8888', vrsta: 'lijecnik' },
      { id: 'S09', ime: 'Maja Knežević', uloga: 'medicinska sestra', odjel: 'KIR-A', pin: '1212', vrsta: 'sestra' },
      { id: 'S10', ime: 'Dario Vuković', uloga: 'medicinski tehničar', odjel: 'KIR-A', pin: '1313', vrsta: 'sestra' },
      { id: 'S11', ime: 'Lucija Pavić', uloga: 'medicinska sestra', odjel: 'KIR-A', pin: '1414', vrsta: 'sestra' },
      { id: 'S12', ime: 'dr. Helena Šarić', uloga: 'kirurginja', odjel: 'KIR-A', pin: '1515', vrsta: 'lijecnik' }
    ],

    // Smjene po 12 sati. Zadani raspored je rotacija dnevna -> noćna -> slobodan dan,
    // posebno za liječnike i za sestre/tehničare, redom kojim su navedeni gore. Tako danas
    // dr. Kovač i sestra Tomić predaju smjenu, a dr. Radić preuzima noćnu.
    // Administrator može raspored mijenjati na stranici Raspored.
    smjene: {
      dnevna: { naziv: 'Dnevna', od: '07:00', do: '19:00' },
      nocna: { naziv: 'Noćna', od: '19:00', do: '07:00' }
    },

    // "tag" je anonimni ID zapisan na NFC narukvici. Na narukvici nema imena ni medicinskih podataka.
    pacijenti: [
      {
        tag: 'k7m2q9xa', odjel: 'INT-B', soba: '4', krevet: '1',
        ime: 'Ivo Perić', dob: 78, spol: 'M',
        dg: 'Kronično srčano zatajenje, kronična bubrežna bolest 4. stadija',
        stanje: 'nadzor',
        profil: {
          datumRodenja: rodjen(78, 3, 14), mbo: '100000101', krvnaGrupa: 'A+', mjesto: 'Zagreb',
          prijem: t('10:30', -3),
          kontakt: { ime: 'Marina Perić', odnos: 'kći', telefon: '091 000 0101' },
          alergije: [{ id: 'al1', tvar: 'Penicilin', reakcija: 'urtikarija', tezina: 'umjerena' }],
          bolesti: [
            { id: 'bo1', naziv: 'Kronično srčano zatajenje (EF 35 %)', od: '2018' },
            { id: 'bo2', naziv: 'Kronična bubrežna bolest, 4. stadij', od: '2021' },
            { id: 'bo3', naziv: 'Arterijska hipertenzija', od: '2005' },
            { id: 'bo4', naziv: 'Giht', od: '2015' }
          ],
          kucnaTerapija: [
            { id: 'kt1', lijek: 'Furosemid', doza: '40 mg p.o. ujutro' },
            { id: 'kt2', lijek: 'Bisoprolol', doza: '2,5 mg p.o. 1x dnevno' },
            { id: 'kt3', lijek: 'Ramipril', doza: '2,5 mg p.o. (ukinut pri prijemu zbog bubrežne funkcije)' },
            { id: 'kt4', lijek: 'Alopurinol', doza: '100 mg p.o. 1x dnevno' }
          ],
          hospitalizacije: [
            { id: 'ho1', od: prije(210), do: prije(201), mjesto: 'Interna klinika, odjel B', razlog: 'Akutna dekompenzacija srčanog zatajenja' },
            { id: 'ho2', od: prije(540), do: prije(533), mjesto: 'Interna klinika, odjel A', razlog: 'Pneumonija lijevo' }
          ],
          pregledi: [
            { id: 'pr1', datum: prije(60), vrsta: 'Kardiolog', nalaz: 'EF 35 %, NYHA III. Optimizirana diuretska terapija.' },
            { id: 'pr2', datum: prije(95), vrsta: 'Nefrolog', nalaz: 'eGFR 22 mL/min. Razmotriti pripremu za dijalizu.' }
          ],
          operacije: [{ id: 'op1', godina: '2012', naziv: 'Totalna endoproteza kuka desno' }],
          navike: 'Bivši pušač (prestao 2010.). Alkohol ne konzumira.',
          napomena: 'Nagluh na lijevo uho. Pokretan uz hodalicu.'
        },
        terapija: [
          { id: 't1', lijek: 'Furosemid', doza: '40 mg i.v. svakih 12 h', od: t('08:00', -2) },
          { id: 't2', lijek: 'Bisoprolol', doza: '2,5 mg p.o. 1x dnevno', od: t('08:00', -5) },
          { id: 't3', lijek: 'Spironolakton', doza: '25 mg p.o. 1x dnevno', od: t('14:20'), promjena: 'uveden' }
        ],
        nalazi: [
          { id: 'n1', naziv: 'Kreatinin', vrijednost: 312, jedinica: 'µmol/L', ref: [64, 104], naruceno: t('06:00'), stiglo: t('07:40'), pregledao: 'S01' },
          { id: 'n2', naziv: 'Kalij (K+)', vrijednost: 6.1, jedinica: 'mmol/L', ref: [3.5, 5.1], naruceno: t('15:00'), stiglo: t('18:50'), pregledao: null }
        ],
        vitali: [
          { id: 'v1', vrijeme: t('08:00'), fp: 82, sys: 128, dia: 76, spo2: 95, temp: 36.6, fd: 18 },
          { id: 'v2', vrijeme: t('14:00'), fp: 88, sys: 122, dia: 74, spo2: 95, temp: 36.8, fd: 18 },
          { id: 'v3', vrijeme: t('18:00'), fp: 56, sys: 108, dia: 66, spo2: 94, temp: 36.7, fd: 20 }
        ],
        biljeske: [
          { id: 'b1', vrijeme: t('09:10'), autor: 'S01', tekst: 'Bolesnik stabilan, eupnoičan. Diureza 1800 ml u zadnja 24 h. Nastaviti furosemid, kontrola elektrolita poslijepodne.' },
          { id: 'b2', vrijeme: t('15:00'), autor: 'S03', tekst: 'Uzeta krv za elektrolite. Bolesnik se žali na umor.' }
        ],
        zadaci: [
          { id: 'z1', opis: 'Kontrola elektrolita i kreatinina', rok: t('06:00', 1), gotovo: false },
          { id: 'z2', opis: 'Bilanca tekućine za 24 h', rok: t('07:00', 1), gotovo: false }
        ],
        akoOnda: [
          { id: 'a1', ako: 'diureza manja od 30 ml/h kroz 2 sata', onda: 'javiti dežurnom liječniku' },
          { id: 'a2', ako: 'srčana frekvencija ispod 50/min ili sistolički tlak ispod 95 mmHg', onda: 'snimiti EKG i hitno javiti dežurnom liječniku' }
        ]
      },
      {
        tag: 'p3c8w1rn', odjel: 'INT-B', soba: '4', krevet: '2',
        ime: 'Marija Šimić', dob: 64, spol: 'Ž',
        dg: 'Izvanbolnička pneumonija desno',
        stanje: 'nadzor',
        profil: {
          datumRodenja: rodjen(64, 9, 2), mbo: '100000102', krvnaGrupa: '0+', mjesto: 'Velika Gorica',
          prijem: t('19:40', -1),
          kontakt: { ime: 'Ante Šimić', odnos: 'suprug', telefon: '091 000 0102' },
          alergije: [{ id: 'al1', tvar: 'Sulfonamidi', reakcija: 'makulopapulozni osip', tezina: 'blaga' }],
          bolesti: [
            { id: 'bo1', naziv: 'Hipotireoza', od: '2016' },
            { id: 'bo2', naziv: 'Astma, blaga perzistentna', od: 'djetinjstva' }
          ],
          kucnaTerapija: [
            { id: 'kt1', lijek: 'Levotiroksin', doza: '75 µg p.o. ujutro natašte' },
            { id: 'kt2', lijek: 'Salbutamol', doza: 'inhalator po potrebi' }
          ],
          hospitalizacije: [],
          pregledi: [
            { id: 'pr1', datum: prije(300), vrsta: 'Pulmolog', nalaz: 'Spirometrija uredna, astma dobro kontrolirana.' },
            { id: 'pr2', datum: prije(120), vrsta: 'Endokrinolog', nalaz: 'TSH u referentnom rasponu, doza levotiroksina nepromijenjena.' }
          ],
          operacije: [{ id: 'op1', godina: '1985', naziv: 'Apendektomija' }],
          navike: 'Nepušačica.',
          napomena: ''
        },
        terapija: [
          { id: 't1', lijek: 'Ceftriakson', doza: '2 g i.v. 1x dnevno', od: t('20:00', -1) },
          { id: 't2', lijek: 'Azitromicin', doza: '500 mg p.o. 1x dnevno', od: t('20:00', -1) }
        ],
        nalazi: [
          { id: 'n1', naziv: 'CRP', vrijednost: 148, jedinica: 'mg/L', ref: [0, 5], naruceno: t('06:00'), stiglo: t('08:10'), pregledao: 'S01' },
          { id: 'n2', naziv: 'Hemokultura (2 seta)', vrijednost: null, opis: 'u obradi', naruceno: t('17:30'), stiglo: null, pregledao: null }
        ],
        vitali: [
          { id: 'v1', vrijeme: t('08:00'), fp: 92, sys: 124, dia: 78, spo2: 95, temp: 37.2, fd: 20 },
          { id: 'v2', vrijeme: t('14:00'), fp: 98, sys: 120, dia: 74, spo2: 93, temp: 38.1, fd: 22 },
          { id: 'v3', vrijeme: t('18:00'), fp: 108, sys: 116, dia: 70, spo2: 91, temp: 38.7, fd: 24 }
        ],
        biljeske: [
          { id: 'b1', vrijeme: t('12:00'), autor: 'S01', tekst: 'Afebrilna ujutro, auskultatorno krepitacije desno bazalno. Nastaviti ceftriakson i azitromicin.' },
          { id: 'b2', vrijeme: t('17:30'), autor: 'S03', tekst: 'Febrilna 38,1 °C u 14 h, uzete hemokulture. Dan paracetamol 1 g p.o.' }
        ],
        zadaci: [
          { id: 'z1', opis: 'Ceftriakson 2 g i.v.', rok: t('20:00'), gotovo: false },
          { id: 'z2', opis: 'Kontrolni CRP i KKS', rok: t('06:00', 1), gotovo: false }
        ],
        akoOnda: [
          { id: 'a1', ako: 'saturacija ispod 90 % uz kisik 2 L/min', onda: 'povećati protok kisika, plinska analiza, javiti dežurnom liječniku' }
        ]
      },
      {
        tag: 'h5v1t6ze', odjel: 'INT-B', soba: '5', krevet: '1',
        ime: 'Josip Kovačević', dob: 55, spol: 'M',
        dg: 'Šećerna bolest tip 2, regulacija glikemije',
        stanje: 'stabilan',
        profil: {
          datumRodenja: rodjen(55, 6, 21), mbo: '100000103', krvnaGrupa: 'B+', mjesto: 'Samobor',
          prijem: t('09:15', -4),
          kontakt: { ime: 'Vesna Kovačević', odnos: 'supruga', telefon: '091 000 0103' },
          alergije: [],
          bolesti: [
            { id: 'bo1', naziv: 'Šećerna bolest tip 2', od: '2014' },
            { id: 'bo2', naziv: 'Hiperlipidemija', od: '2016' },
            { id: 'bo3', naziv: 'Pretilost (ITM 33)', od: '' }
          ],
          kucnaTerapija: [
            { id: 'kt1', lijek: 'Metformin', doza: '1000 mg p.o. 2x dnevno' },
            { id: 'kt2', lijek: 'Atorvastatin', doza: '20 mg p.o. navečer' }
          ],
          hospitalizacije: [],
          pregledi: [
            { id: 'pr1', datum: prije(90), vrsta: 'Dijabetolog', nalaz: 'HbA1c 9,8 %. Preporuka uvođenja bazalnog inzulina.' },
            { id: 'pr2', datum: prije(200), vrsta: 'Oftalmolog', nalaz: 'Bez znakova dijabetičke retinopatije.' }
          ],
          operacije: [],
          navike: 'Pušač, 20 cigareta dnevno. Alkohol povremeno.',
          napomena: ''
        },
        terapija: [
          { id: 't1', lijek: 'Inzulin glargin', doza: '18 j. s.c. navečer', od: t('21:00', -3) },
          { id: 't2', lijek: 'Metformin', doza: '1000 mg p.o. 2x dnevno', od: t('08:00', -5) }
        ],
        nalazi: [
          { id: 'n1', naziv: 'GUK natašte', vrijednost: 8.4, jedinica: 'mmol/L', ref: [4.4, 7.0], naruceno: t('06:00'), stiglo: t('06:30'), pregledao: 'S01' }
        ],
        vitali: [
          { id: 'v1', vrijeme: t('08:00'), fp: 76, sys: 132, dia: 82, spo2: 98, temp: 36.5, fd: 16 },
          { id: 'v2', vrijeme: t('18:00'), fp: 78, sys: 130, dia: 80, spo2: 98, temp: 36.6, fd: 16 }
        ],
        biljeske: [
          { id: 'b1', vrijeme: t('10:30'), autor: 'S01', tekst: 'Glikemije u padu, bez hipoglikemija. Plan otpusta prekosutra uz edukaciju o inzulinu.' }
        ],
        zadaci: [
          { id: 'z1', opis: 'GUK profil', rok: t('21:00'), gotovo: false },
          { id: 'z2', opis: 'Edukacija o primjeni inzulina', rok: t('10:00', 1), gotovo: false }
        ],
        akoOnda: [
          { id: 'a1', ako: 'GUK ispod 4 mmol/L', onda: 'protokol za hipoglikemiju: 20 g glukoze p.o., kontrola GUK-a za 15 minuta' }
        ]
      },
      {
        tag: 'r9d4j2lu', odjel: 'INT-B', soba: '5', krevet: '2',
        ime: 'Ana Marić', dob: 82, spol: 'Ž',
        dg: 'Tranzitorna ishemijska ataka, opservacija',
        stanje: 'stabilan',
        profil: {
          datumRodenja: rodjen(82, 1, 30), mbo: '100000104', krvnaGrupa: 'A-', mjesto: 'Zagreb',
          prijem: t('16:20', -1),
          kontakt: { ime: 'Davor Marić', odnos: 'sin', telefon: '091 000 0104' },
          alergije: [{ id: 'al1', tvar: 'Jodno kontrastno sredstvo', reakcija: 'mučnina i crvenilo kože', tezina: 'blaga' }],
          bolesti: [
            { id: 'bo1', naziv: 'Arterijska hipertenzija', od: '2000' },
            { id: 'bo2', naziv: 'Osteoporoza', od: '2015' }
          ],
          kucnaTerapija: [
            { id: 'kt1', lijek: 'Amlodipin', doza: '5 mg p.o. 1x dnevno' },
            { id: 'kt2', lijek: 'Kalcij + vitamin D', doza: '1 tableta dnevno' }
          ],
          hospitalizacije: [
            { id: 'ho1', od: prije(400), do: prije(396), mjesto: 'Traumatologija', razlog: 'Prijelom distalnog radijusa lijevo nakon pada' }
          ],
          pregledi: [
            { id: 'pr1', datum: prije(30), vrsta: 'Neurolog', nalaz: 'Povremene vrtoglavice. Preporuka color doplera karotida.' }
          ],
          operacije: [{ id: 'op1', godina: '2019', naziv: 'Operacija katarakte obostrano' }],
          navike: 'Nepušačica.',
          napomena: 'Visok rizik od pada (Morse 55). Nosi naočale.'
        },
        terapija: [
          { id: 't1', lijek: 'Acetilsalicilna kiselina', doza: '100 mg p.o. 1x dnevno', od: t('17:00', -1) },
          { id: 't2', lijek: 'Atorvastatin', doza: '40 mg p.o. navečer', od: t('20:00', -1) }
        ],
        nalazi: [
          { id: 'n1', naziv: 'MSCT mozga', vrijednost: null, opis: 'čeka nalaz radiologa', naruceno: t('16:00'), stiglo: null, pregledao: null }
        ],
        vitali: [
          { id: 'v1', vrijeme: t('08:00'), fp: 72, sys: 148, dia: 84, spo2: 97, temp: 36.4, fd: 16 },
          { id: 'v2', vrijeme: t('18:00'), fp: 74, sys: 152, dia: 86, spo2: 96, temp: 36.5, fd: 16 }
        ],
        biljeske: [
          { id: 'b1', vrijeme: t('11:00'), autor: 'S01', tekst: 'Neurološki uredna, bez novih ispada. Visok rizik od pada, ograda kreveta podignuta.' }
        ],
        zadaci: [
          { id: 'z1', opis: 'Neurološki status', rok: t('22:00'), gotovo: false }
        ],
        akoOnda: [
          { id: 'a1', ako: 'novi neurološki ispad (govor, slabost, asimetrija lica)', onda: 'hitno javiti dežurnom liječniku i neurologu, aktivirati protokol za moždani udar' }
        ]
      },
      {
        tag: 'w2f7b3kc', odjel: 'INT-B', soba: '6', krevet: '1',
        ime: 'Zoran Jurić', dob: 70, spol: 'M',
        dg: 'Egzacerbacija KOPB-a',
        stanje: 'nadzor',
        profil: {
          datumRodenja: rodjen(70, 11, 5), mbo: '100000105', krvnaGrupa: '0-', mjesto: 'Sesvete',
          prijem: t('07:50', -2),
          kontakt: { ime: 'Ljiljana Jurić', odnos: 'supruga', telefon: '091 000 0105' },
          alergije: [],
          bolesti: [
            { id: 'bo1', naziv: 'KOPB, GOLD 3, kronična hiperkapnija', od: '2012' },
            { id: 'bo2', naziv: 'Arterijska hipertenzija', od: '2010' },
            { id: 'bo3', naziv: 'Benigna hiperplazija prostate', od: '2019' }
          ],
          kucnaTerapija: [
            { id: 'kt1', lijek: 'Tiotropij', doza: 'inhalacija 1x dnevno' },
            { id: 'kt2', lijek: 'Salmeterol/flutikazon', doza: 'inhalacija 2x dnevno' },
            { id: 'kt3', lijek: 'Tamsulozin', doza: '0,4 mg p.o. navečer' }
          ],
          hospitalizacije: [
            { id: 'ho1', od: prije(120), do: prije(112), mjesto: 'Interna klinika, odjel B', razlog: 'Egzacerbacija KOPB-a' },
            { id: 'ho2', od: prije(365), do: prije(352), mjesto: 'Jedinica intenzivnog liječenja', razlog: 'Egzacerbacija KOPB-a s hiperkapnijom, neinvazivna ventilacija' }
          ],
          pregledi: [
            { id: 'pr1', datum: prije(45), vrsta: 'Pulmolog', nalaz: 'FEV1 38 %. Kronična hiperkapnija, kućni kisik se ne preporučuje.' }
          ],
          operacije: [],
          navike: 'Bivši pušač, 50 kutija-godina.',
          napomena: 'Kronični retentor CO2: ciljna saturacija 88–92 %.'
        },
        ciljSpO2: [88, 92],
        terapija: [
          { id: 't1', lijek: 'Metilprednizolon', doza: '20 mg i.v. 1x dnevno', od: t('17:40'), promjena: 'doza smanjena s 40 mg' },
          { id: 't2', lijek: 'Ipratropij/salbutamol', doza: 'inhalacije 4x dnevno', od: t('08:00', -2) },
          { id: 't3', lijek: 'Kisik', doza: '1 L/min nosnim kateterom', od: t('08:00', -2) }
        ],
        nalazi: [
          { id: 'n1', naziv: 'Plinska analiza arterijske krvi', vrijednost: null, opis: 'pH 7,38, pO2 7,9 kPa, pCO2 6,4 kPa', naruceno: t('16:00'), stiglo: t('16:30'), pregledao: 'S01' }
        ],
        vitali: [
          { id: 'v1', vrijeme: t('08:00'), fp: 96, sys: 136, dia: 80, spo2: 88, temp: 36.9, fd: 22 },
          { id: 'v2', vrijeme: t('18:00'), fp: 90, sys: 132, dia: 78, spo2: 90, temp: 36.8, fd: 20 }
        ],
        biljeske: [
          { id: 'b1', vrijeme: t('17:45'), autor: 'S01', tekst: 'Klinički bolje, manje zaduhe. Metilprednizolon smanjen na 20 mg. Ciljna saturacija 88–92 %.' }
        ],
        zadaci: [
          { id: 'z1', opis: 'Inhalacije', rok: t('22:00'), gotovo: false }
        ],
        akoOnda: [
          { id: 'a1', ako: 'saturacija ispod 88 % ili pospanost', onda: 'plinska analiza (rizik hiperkapnije), ne povećavati kisik naslijepo, javiti dežurnom liječniku' }
        ]
      },
      {
        tag: 'n8s5e4dy', odjel: 'INT-B', soba: '6', krevet: '2',
        ime: 'Katarina Novak', dob: 47, spol: 'Ž',
        dg: 'Sideropenična anemija, transfuzija',
        stanje: 'stabilan',
        profil: {
          datumRodenja: rodjen(47, 4, 9), mbo: '100000106', krvnaGrupa: 'AB+', mjesto: 'Zagreb',
          prijem: t('11:00'),
          kontakt: { ime: 'Igor Novak', odnos: 'partner', telefon: '091 000 0106' },
          alergije: [{ id: 'al1', tvar: 'Ibuprofen', reakcija: 'bronhospazam', tezina: 'teška' }],
          bolesti: [
            { id: 'bo1', naziv: 'Miomatozni uterus s menoragijama', od: '2023' },
            { id: 'bo2', naziv: 'Sideropenična anemija', od: '2024' }
          ],
          kucnaTerapija: [{ id: 'kt1', lijek: 'Željezov sulfat', doza: '100 mg p.o. 1x dnevno' }],
          hospitalizacije: [],
          pregledi: [
            { id: 'pr1', datum: prije(20), vrsta: 'Ginekolog', nalaz: 'Miomatozni uterus. Planirati histerektomiju nakon korekcije anemije.' }
          ],
          operacije: [{ id: 'op1', godina: '2008', naziv: 'Carski rez' }],
          navike: 'Nepušačica.',
          napomena: 'Potpisan pristanak na transfuziju krvnih pripravaka.'
        },
        terapija: [
          { id: 't1', lijek: 'Koncentrat eritrocita', doza: '1 doza i.v.', od: t('13:00') }
        ],
        nalazi: [
          { id: 'n1', naziv: 'Hemoglobin', vrijednost: 72, jedinica: 'g/L', ref: [119, 157], naruceno: t('06:00'), stiglo: t('07:30'), pregledao: 'S01' }
        ],
        vitali: [
          { id: 'v1', vrijeme: t('08:00'), fp: 96, sys: 112, dia: 70, spo2: 98, temp: 36.6, fd: 16 },
          { id: 'v2', vrijeme: t('14:00'), fp: 88, sys: 118, dia: 72, spo2: 98, temp: 37.0, fd: 16 },
          { id: 'v3', vrijeme: t('18:00'), fp: 84, sys: 120, dia: 74, spo2: 98, temp: 36.7, fd: 16 }
        ],
        biljeske: [
          { id: 'b1', vrijeme: t('13:00'), autor: 'S03', tekst: 'Započeta transfuzija 1 doze koncentrata eritrocita, bez reakcije.' },
          { id: 'b2', vrijeme: t('15:10'), autor: 'S03', tekst: 'Transfuzija završena bez komplikacija.' }
        ],
        zadaci: [
          { id: 'z1', opis: 'Kontrolni KKS nakon transfuzije', rok: t('17:00'), gotovo: false },
          { id: 'z2', opis: 'Odluka o drugoj dozi transfuzije', rok: t('08:00', 1), gotovo: false }
        ],
        akoOnda: [
          { id: 'a1', ako: 'zimica, vrućica ili otežano disanje', onda: 'javiti dežurnom liječniku, kontrola vitalnih znakova' }
        ]
      },
      {
        // Pacijent s drugog odjela: služi za demo odbijenog pristupa.
        tag: 't1g6y8hp', odjel: 'KIR-A', soba: '2', krevet: '1',
        ime: 'Petar Babić', dob: 61, spol: 'M',
        dg: 'Stanje nakon laparoskopske kolecistektomije',
        stanje: 'stabilan',
        profil: {
          datumRodenja: rodjen(61, 8, 17), mbo: '100000107', krvnaGrupa: 'B-', mjesto: 'Zaprešić',
          prijem: t('07:30', -1),
          kontakt: { ime: 'Ružica Babić', odnos: 'supruga', telefon: '091 000 0107' },
          alergije: [],
          bolesti: [{ id: 'bo1', naziv: 'Simptomatska kolelitijaza', od: '2025' }],
          kucnaTerapija: [],
          hospitalizacije: [],
          pregledi: [{ id: 'pr1', datum: prije(40), vrsta: 'Abdominalni kirurg', nalaz: 'Indicirana elektivna kolecistektomija.' }],
          operacije: [],
          navike: '',
          napomena: ''
        },
        terapija: [], nalazi: [], vitali: [], biljeske: [], zadaci: [], akoOnda: []
      }
    ]
  };
})();
