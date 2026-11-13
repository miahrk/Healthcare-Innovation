# Primopredaja smjene uz NFC narukvicu

Prototip s AI2MED hackathona, izazov 12: kako poboljšati prijenos informacija među zdravstvenim djelatnicima.

> **Svi podaci su izmišljeni.** Ovo je prototip za hackathon, nije medicinski proizvod i ne smije se koristiti sa stvarnim podacima o pacijentima.

## Problem

Pri primopredaji smjene informacije o pacijentu prenose se usmeno ili na papiru, u žurbi, pet minuta prije kraja smjene. Najčešće se izgubi upravo ono što se dogodilo zadnje: nalaz koji je stigao, a nitko ga nije pogledao, lijek uveden poslijepodne, pad tlaka u zadnjem mjerenju.

Prototip je usredotočen na dvije stvari:

1. **NFC narukvica:** uz krevet skeniraj narukvicu i odmah vidi zapis pacijenta pripremljen za primopredaju: što se promijenilo, što ne smiješ propustiti, tko je i kada pristupao zapisu.
2. **Glasovni unos:** izgovori nalaze, vitalne znakove, terapiju, zadatke i bilješke; sustav ih razvrsta u polja kao **nepotvrđeni nacrt**, a u zapis ulazi tek ono što djelatnik pregleda, ispravi i potvrdi.

## Kartica pacijenta

Svaki pacijent nosi NFC narukvicu s anonimnim ID-em. Kad djelatnik prisloni mobitel na narukvicu, otvori se kartica pacijenta. Na vrhu su ime, soba, dijagnoza, način otvaranja (skeniranjem, simulirano ili ručno) i alergije, a ispod:

**Pregled za primopredaju:** sve ključno na jednom mjestu.

| Blok | Što prikazuje |
|---|---|
| Vitalni znakovi | zadnje mjerenje, u zagradi vrijednost s početka smjene; odstupanja su crvena |
| Zadnji nalazi | tri najnovija, s oznakom *nije pregledan* ili *na čekanju* |
| Terapija | aktualna terapija; promjene (uveden, ukinut, doza) s vremenom |
| Zadnje bilješke | dvije najnovije, s autorom i vremenom |
| Otvoreni zadaci | po roku, zadaci koji kasne crveno |

**Glasovni unos** (vidi niže), pa struktura **I-PASS**:

| | Dio kartice | Što prikazuje |
|---|---|---|
| **I** | Težina stanja | stabilan, pojačan nadzor ili hitna pozornost; procjena raste ako postoje upozorenja |
| **P** | Sažetak pacijenta | kratki sažetak s poveznicama na izvorne zapise (iz pravila ili AI) |
| **A** | Akcijska lista | zadaci za sljedeću smjenu i nalazi na čekanju |
| **S** | Plan za moguće situacije | „ako se dogodi X, napravi Y“ |
| **S** | Provjera i preuzimanje | upozorenja koja treba potvrditi, bilješka uz krevet, preuzimanje |

- Kartica jasno pokazuje je li otvorena **skeniranjem narukvice**, **simuliranim skeniranjem** (demo bez čitača) ili **ručno**.
- Uz svaku tvrdnju je gumb **izvor**, koji otvara izvorni zapis (nalaz, terapiju, vitalne znakove, bilješku).
- Pacijenta se **ne može preuzeti** dok se ne potvrde sva upozorenja. Sustav bilježi tko je, kada i kako preuzeo pacijenta.
- Na dnu kartice je **Pristupi zapisu**: tko je i kada skenirao narukvicu, otvorio karticu, upisao ili potvrdio podatke, uključujući odbijene pristupe djelatnika s drugog odjela. Cijeli zapisnik je na stranici **Zapisnik**.
- Upisuju se samo **bilješka uz krevet** i **potvrđeni glasovni unosi**. Svi ostali podaci dolaze iz bolničkog sustava (u prototipu iz `js/data.js`).

## Glasovni unos

1. Djelatnik na kartici pacijenta pritisne **Diktiraj** i govori (ili tekst upiše ili zalijepi).
2. Kad stane, tekst se pravilima razvrsta u polja: **vitalni znakovi**, **nalaz**, **terapija** (uveden, ukinut, doza povećana ili smanjena, jednokratno dan), **zadatak** s rokom i **opća bilješka**.
3. Svako polje je **nacrt označen „Nepotvrđeno“**, uz doslovni dio diktata iz kojeg je nastalo. Djelatnik ga ispravi i **potvrdi** ili **odbaci**. Nacrt nije dio zapisa: ne vidi se u pregledu, ne utječe na upozorenja i ne briše se ponovnim učitavanjem stranice.
4. Tek potvrđeno polje ulazi u zapis pacijenta, s oznakom *glasovni unos* i imenom onoga tko ga je potvrdio, i od tada sudjeluje u pregledu, upozorenjima (npr. puls 128 daje kritično upozorenje), akcijskoj listi i sažetku. Potvrda, ispravak i odbacivanje bilježe se u zapisnik.

**Ništa se ne izmišlja.** Ono što se ne može pouzdano svrstati ide u opću bilješku:
- vrijednost izvan uvjerljivog raspona (npr. „tlak 300 na 80“, hemoglobin u krivoj jedinici), uz napomenu,
- isti vitalni znak izgovoren dvaput s različitim vrijednostima,
- nejasna fraza („frekvencija 88“: srčana ili disanja?),
- ukidanje ili promjena doze lijeka koji pacijent nema u terapiji, uz napomenu,
- sve što počinje s „bilješka:“ ili „napomena:“, do kraja rečenice.

Pri potvrdi se vrijednosti ponovno provjeravaju (npr. zadatak mora imati rok, tlak oba broja).

Razvrstavanje je u `js/razvrstavanje.js` i namjerno je **pravilima, a ne AI-jem**, iz istog razloga kao i upozorenja: predvidljivo je, radi bez poslužitelja i ne može izmisliti vrijednost.

### Govor u tekst: Web Speech API

Za pretvorbu govora koristi se ugrađeni **Web Speech API** preglednika (`js/govor.js`, jezik `hr-HR`).

| Prednosti | Nedostaci |
|---|---|
| nema paketa, ključeva ni poslužitelja; radi i na GitHub Pagesu | pouzdano radi samo u **Chromeu i Edgeu** (računalo i Android); Safari djelomično, Firefox ne |
| tekst se vidi dok djelatnik govori | **Chrome šalje zvuk Googleovim poslužiteljima** i treba internet: prihvatljivo za demo s izmišljenim podacima, **nije prihvatljivo za stvarne pacijente** |
| podržava hrvatski | osrednja točnost za medicinske izraze; često vraća tekst bez interpunkcije (pravila za razvrstavanje to podnose) |

Gdje govor ne radi, isti tok radi s upisanim tekstom, a na kartici su i **primjeri diktata za demo**. Mikrofon, kao i NFC, radi samo preko HTTPS-a ili na `localhost`.

Za stvarnu upotrebu prepoznavanje govora trebalo bi raditi unutar bolničke infrastrukture (npr. lokalni model tipa Whisper).

## Četiri upozorenja

Upozorenja su namjerno **pravila, a ne AI**: moraju biti predvidljiva i provjerljiva, pa AI ne može „zaboraviti“ kritičan nalaz.

1. **Nalaz je stigao, a nitko ga nije pregledao.** Kritično ako je izvan referentnog raspona.
2. **Promjena terapije u zadnjih 12 h** koja nije spomenuta ni u jednoj kasnijoj bilješci.
3. **Pogoršanje vitalnih znakova:** saturacija ispod ciljne, febrilitet, nagla promjena ili nesiguran raspon srčane frekvencije, niski sistolički tlak.
4. **Zadatak kojem je prošao rok.**

Pravila su u `js/pravila.js`. AI piše samo tekstualni sažetak; odgovornost i odluka ostaju djelatniku.

## Pokretanje

### 1. Najbrže: statični poslužitelj

U mapi aplikacije pokrenite:

```bash
python -m http.server 8000      # na nekim računalima: py -m http.server 8000
```

i otvorite http://localhost:8000. Radi sve osim AI sažetka, uključujući glasovni unos u Chromeu ili Edgeu. Bez NFC čitača skeniranje se simulira odabirom narukvice (vidi niže).

### 2. GitHub Pages: za NFC na mobitelu

Web NFC radi samo preko HTTPS-a, a GitHub Pages ga daje besplatno.

1. Na GitHubu: **Settings → Pages → Build and deployment → Deploy from a branch**, odaberite `main` i `/ (root)`.
2. Nakon minute-dvije aplikacija je na
   `https://<korisnik>.github.io/<repozitorij>/files%20(1)/primopredaja-nfc/primopredaja-nfc/`.
3. Otvorite tu adresu u **Chromeu na Androidu**.

Na GitHub Pagesu AI sažetak ne radi (nema poslužitelja), pa se prikazuje sažetak iz pravila.

### 3. Lokalni poslužitelj s AI sažetkom

Treba Node.js 20.6 ili noviji, bez dodatnih paketa.

```bash
cd server
cp .env.example .env        # Windows: copy .env.example .env, pa upišite ANTHROPIC_API_KEY
npm start
```

Otvorite http://localhost:3000. Na kartici se pojavi gumb **Napravi AI sažetak**. Poslužitelj odbacuje sažetak koji se poziva na zapise kojih nema, a aplikacija tada prikazuje sažetak iz pravila. API ključ ostaje na poslužitelju i nikad ne ide u preglednik; `.env` je u `.gitignore`.

Bez ključa: `npm run start:bez-ai` (poslužuje aplikaciju, a prikazuje se sažetak iz pravila).

Model se mijenja varijablom `CLAUDE_MODEL` u `.env`. Dokumentacija: https://docs.claude.com/en/api/overview

Za NFC i AI zajedno na mobitelu lokalni poslužitelj mora biti dostupan preko HTTPS-a, npr. tunelom (`ngrok http 3000`).

### Testovi

U mapi aplikacije (Node.js 20.6 ili noviji, bez paketa):

```bash
npm test
```

Testira pravila za upozorenja, pregled za primopredaju, razvrstavanje izgovorenog teksta i spajanje potvrđenih glasovnih unosa u zapis, te sintaksu svih skripti. Projekt nema build korak.

## Demo PIN-ovi

| PIN | Djelatnik | Odjel |
|---|---|---|
| 2222 | dr. Luka Radić, liječnik | Interna B |
| 3333 | Ivana Tomić, medicinska sestra | Interna B |
| 4444 | dr. Marko Grgić, kirurg | Kirurgija A (samo za test odbijenog pristupa) |

Liječnik i sestra imaju ista prava: otvoriti karticu, potvrditi upozorenja, napisati bilješku uz krevet, diktirati i potvrditi glasovni unos te preuzeti pacijenta. Djelatnik vidi samo pacijente svog odjela.

Vrijeme demo smjene je fiksno: danas u 18:55, pet minuta prije kraja dnevne smjene.

## NFC narukvice

Trebaju vam prazne NFC naljepnice ili narukvice tipa **NTAG213** ili **NTAG215**.

1. Prijavite se i otvorite **Narukvice**.
2. Kod pacijenta dodirnite **Zapiši na narukvicu** i prislonite praznu narukvicu (Chrome na Androidu).
   Bez Androida: **Kopiraj poveznicu** i zapišite je kao URL zapis aplikacijom NFC Tools.
3. Na narukvicu se zapisuje samo poveznica oblika `…/#p=k7m2q9xa&nfc=1`. Bez prijave djelatnika ona ne otkriva ništa.

Čitanje:
- **Android (Chrome):** gumb **Skeniraj narukvicu** u aplikaciji.
- **iPhone:** prislonite mobitel na narukvicu bez otvaranja aplikacije; otvorit će se poveznica, a nakon prijave kartica pacijenta.

ID-evi demo pacijenata: `k7m2q9xa`, `p3c8w1rn`, `h5v1t6ze`, `r9d4j2lu`, `w2f7b3kc`, `n8s5e4dy` (Interna B) i `t1g6y8hp` (Kirurgija A).

### Bez NFC čitača: simulacija skeniranja

Gumb **Skeniraj narukvicu** na pregledniku bez Web NFC-a (računalo, iPhone) nudi popis demo narukvica. Odabir se ponaša kao skeniranje, ali na kartici, pri preuzimanju i u zapisniku piše da je skeniranje **simulirano**. Narukvica s drugog odjela prikazana je bez imena, za demo odbijenog pristupa. Na Androidu je simulacija sklopljena ispod uputa za pravo skeniranje. Ručni upis ID-a i dodir na pacijenta na popisu i dalje se bilježe kao ručno otvaranje.

## Scenarij za demo na pozornici

1. Član tima nosi narukvicu „pacijenta“ Ive Perića (`k7m2q9xa`).
2. Prijavite se kao dežurni liječnik (PIN 2222). Odjel pokazuje **0 od 6** preuzetih, Ivo je na vrhu, crveno.
3. Skenirajte narukvicu (ili je odaberite u simulaciji). Kartica potvrđuje identitet; **Pregled za primopredaju** pokazuje pad pulsa s 82 na 56/min, kalij 6,1 *nije pregledan* i spironolakton uveden u 14:20.
4. Ispod su **kritično upozorenje: kalij 6,1 mmol/L stigao u 18:50, nitko ga nije pregledao**, uz uvedeni spironolakton koji nije spomenut i pad srčane frekvencije. Klik na „izvor n2“ pokazuje izvorni nalaz.
5. **Glasovni unos:** pritisnite **Diktiraj** i recite npr. *„Tlak 100 na 60, puls 52. Spironolakton ukinut. Zadatak: kontrola kalija u 22 sata. Bolesnik pospan, budi se na poziv.“* (ili odaberite prvi primjer diktata pa **Razvrstaj u polja**).
6. Pokažite nacrt: svako polje je **NEPOTVRĐENO**, uz doslovni dio diktata. Ispravite jednu vrijednost, potvrdite polja jedno po jedno. Tek sada se novi puls i ukinuti spironolakton vide u pregledu, s oznakom *glasovni unos*.
7. Pokušajte preuzeti: gumb je zaključan dok se ne potvrde sva upozorenja. Potvrdite ih i preuzmite. Natrag na odjelu: **1 od 6** preuzeto.
8. Za pitanje o privatnosti: prijavite se PIN-om 4444 (kirurg) i skenirajte istu narukvicu. Pristup je odbijen. Ponovno se prijavite s 2222: na Ivinoj kartici, u **Pristupi zapisu**, vidi se i odbijeni pokušaj.

Za pitanje „što ako je krivo čulo?“: treći primjer diktata ima „tlak 300 na 80“, koji se ne svrstava nego ostaje u bilješci uz napomenu.

Rezervni plan ako NFC ili mikrofon zakažu: simulirajte skeniranje i upišite ili odaberite primjer diktata.

Prije svakog nastupa, na dnu ekrana odjela:
- **Nova primopredaja** briše preuzimanja, potvrde, bilješke uz krevet te nacrte i potvrđene glasovne unose (zapisnik ostaje).
- **Vrati početne demo podatke** briše sve, i zapisnik, i odjavljuje korisnika.

## Struktura

```
index.html          ulazna stranica
css/style.css       izgled (svijetli i tamni način za noćnu smjenu)
js/data.js          izmišljeni pacijenti, djelatnici, nalazi
js/pravila.js       četiri upozorenja, procjena stanja, pregled za primopredaju, I-PASS dijelovi,
                    izvorni zapisi, spajanje potvrđenih glasovnih unosa u zapis
js/nfc.js           čitanje i zapisivanje NFC narukvica (Web NFC)
js/govor.js         govor u tekst (Web Speech API, hr-HR)
js/razvrstavanje.js razvrstavanje izgovorenog teksta u polja (pravila)
js/app.js           ekrani, prijava, simulacija skeniranja, glasovni unos, preuzimanje, zapisnik
tests/              testovi (npm test)
api/zdravlje        statični odgovor "AI nije dostupan" za statični poslužitelj i GitHub Pages
server/server.js    neobavezni poslužitelj za AI sažetak (Claude API)
```

Stanje demoa (prijava, preuzimanja, bilješke, nacrti i potvrđeni glasovni unosi, zapisnik) sprema se u `localStorage` preglednika pod ključevima `primopredaja-demo-v2:`. Podaci starije verzije aplikacije brišu se pri pokretanju.

## Što bi trebalo za stvarnu upotrebu

- Povezivanje s bolničkim informacijskim sustavom umjesto `data.js`.
- Prijava preko bolničkog sustava ili službene kartice, a ne PIN-om u aplikaciji.
- Zapisnik na poslužitelju koji se ne može mijenjati.
- AI model unutar bolničke infrastrukture ili s ugovorom o obradi podataka, u skladu s GDPR-om.
- Prepoznavanje govora unutar bolničke infrastrukture umjesto Web Speech API-ja (zvuk ne smije izaći iz bolnice).
- Potvrđeni glasovni unosi zapisani u bolnički sustav, a ne u preglednik; vrijeme mjerenja upisano, a ne vrijeme potvrde.
- Klinička validacija pravila za upozorenja i za razvrstavanje diktata s liječnicima i medicinskim sestrama.

## Moguća proširenja

Prototip je namjerno sužen na trenutak primopredaje. Ova proširenja već su bila izrađena, a puna verzija čuva se na grani [`puna-verzija`](https://github.com/miahrk/Healthcare-Innovation/tree/puna-verzija):

- **Raspored smjena** po odjelu, s upozorenjima na smjenu bez liječnika ili sestre i rad bez odmora.
- **Administracija**: upis djelatnika, razine pristupa i odjeli.
- **Alergije kao pravilo**: upozorenje kad je u terapiji lijek na koji je zabilježena alergija.
- **Ostale uloge**: voditelj odjela, ravnatelj (pregled svih odjela) i administrator, uz različita prava liječnika i sestre.
- Profil pacijenta s poviješću bolesti, obrazac za novog pacijenta i upis kliničkih zapisa.

## Tim

AI2MED hackathon, studeni 2026.
