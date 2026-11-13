# Primopredaja smjene uz NFC narukvicu

Prototip s AI2MED hackathona, izazov 12: kako poboljšati prijenos informacija među zdravstvenim djelatnicima.

> **Svi podaci su izmišljeni.** Ovo je prototip za hackathon, nije medicinski proizvod i ne smije se koristiti sa stvarnim podacima o pacijentima.

## Problem

Pri primopredaji smjene informacije o pacijentu prenose se usmeno ili na papiru, u žurbi, pet minuta prije kraja smjene. Najčešće se izgubi upravo ono što se dogodilo zadnje: nalaz koji je stigao, a nitko ga nije pogledao, lijek uveden poslijepodne, pad tlaka u zadnjem mjerenju.

Aplikacija radi jednu stvar:

**Uz krevet skeniraj NFC narukvicu, vidi što se promijenilo i što ne smiješ propustiti, potvrdi upozorenja i preuzmi pacijenta.**

## I-PASS kartica

Svaki pacijent nosi NFC narukvicu s anonimnim ID-em. Kad djelatnik prisloni mobitel na narukvicu, otvori se kartica pacijenta u strukturi **I-PASS**:

| | Dio kartice | Što prikazuje |
|---|---|---|
| **I** | Težina stanja | stabilan, pojačan nadzor ili hitna pozornost; procjena raste ako postoje upozorenja |
| **P** | Sažetak pacijenta | kratki sažetak s poveznicama na izvorne zapise (iz pravila ili AI) |
| **A** | Akcijska lista | zadaci za sljedeću smjenu i nalazi na čekanju |
| **S** | Plan za moguće situacije | „ako se dogodi X, napravi Y“ |
| **S** | Provjera i preuzimanje | upozorenja koja treba potvrditi, bilješka uz krevet, preuzimanje |

- Kartica jasno pokazuje je li otvorena **skeniranjem narukvice** ili **ručno**.
- Uz svaku tvrdnju je gumb **izvor**, koji otvara izvorni zapis (nalaz, terapiju, vitalne znakove, bilješku).
- Alergije su prikazane na vrhu kartice.
- Pacijenta se **ne može preuzeti** dok se ne potvrde sva upozorenja. Sustav bilježi tko je, kada i kako (skeniranjem ili ručno) preuzeo pacijenta.
- Jedini upis je **bilješka uz krevet**. Svi ostali podaci dolaze iz bolničkog sustava (u prototipu iz `js/data.js`).

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

i otvorite http://localhost:8000. Radi sve osim AI sažetka. Bez NFC-a karticu otvarate dodirom na pacijenta ili upisom ID-a narukvice.

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

## Demo PIN-ovi

| PIN | Djelatnik | Odjel |
|---|---|---|
| 2222 | dr. Luka Radić, liječnik | Interna B |
| 3333 | Ivana Tomić, medicinska sestra | Interna B |
| 4444 | dr. Marko Grgić, kirurg | Kirurgija A (samo za test odbijenog pristupa) |

Liječnik i sestra imaju ista prava: otvoriti karticu, potvrditi upozorenja, napisati bilješku uz krevet i preuzeti pacijenta. Djelatnik vidi samo pacijente svog odjela.

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

## Scenarij za demo na pozornici

1. Član tima nosi narukvicu „pacijenta“ Ive Perića (`k7m2q9xa`).
2. Prijavite se kao dežurni liječnik (PIN 2222). Odjel pokazuje **0 od 6** preuzetih, Ivo je na vrhu, crveno.
3. Skenirajte narukvicu. Kartica potvrđuje identitet i pokazuje **kritično upozorenje: kalij 6,1 mmol/L stigao u 18:50, nitko ga nije pregledao**, uz uvedeni spironolakton koji nije spomenut i pad srčane frekvencije.
4. Klik na „izvor n2“ pokazuje izvorni nalaz.
5. Pokušajte preuzeti: gumb je zaključan dok se ne potvrde sva upozorenja. Potvrdite ih i preuzmite.
6. Natrag na odjelu: **1 od 6** preuzeto.
7. Za pitanje o privatnosti: prijavite se PIN-om 4444 (kirurg) i skenirajte istu narukvicu. Pristup je odbijen i zabilježen u **Zapisniku**.

Rezervni plan ako NFC zakaže: dodirnite pacijenta na popisu ili upišite ID ručno (gumb **Skeniraj narukvicu** na pregledniku bez NFC-a nudi upis). Kartica će pokazati da je otvorena bez skeniranja.

Prije svakog nastupa, na dnu ekrana odjela:
- **Nova primopredaja** briše preuzimanja, potvrde i bilješke uz krevet (zapisnik ostaje).
- **Vrati početne demo podatke** briše sve, i zapisnik, i odjavljuje korisnika.

## Struktura

```
index.html          ulazna stranica
css/style.css       izgled (svijetli i tamni način za noćnu smjenu)
js/data.js          izmišljeni pacijenti, djelatnici, nalazi
js/pravila.js       četiri upozorenja, procjena stanja, I-PASS dijelovi, izvorni zapisi
js/nfc.js           čitanje i zapisivanje NFC narukvica (Web NFC)
js/app.js           ekrani, prijava, preuzimanje, zapisnik
api/zdravlje        statični odgovor "AI nije dostupan" za statični poslužitelj i GitHub Pages
server/server.js    neobavezni poslužitelj za AI sažetak (Claude API)
```

Stanje demoa (prijava, preuzimanja, bilješke, zapisnik) sprema se u `localStorage` preglednika pod ključevima `primopredaja-demo-v2:`. Podaci starije verzije aplikacije brišu se pri pokretanju.

## Što bi trebalo za stvarnu upotrebu

- Povezivanje s bolničkim informacijskim sustavom umjesto `data.js`.
- Prijava preko bolničkog sustava ili službene kartice, a ne PIN-om u aplikaciji.
- Zapisnik na poslužitelju koji se ne može mijenjati.
- AI model unutar bolničke infrastrukture ili s ugovorom o obradi podataka, u skladu s GDPR-om.
- Klinička validacija pravila za upozorenja s liječnicima i medicinskim sestrama.

## Moguća proširenja

Prototip je namjerno sužen na trenutak primopredaje. Ova proširenja već su bila izrađena, a puna verzija čuva se na grani [`puna-verzija`](https://github.com/miahrk/Healthcare-Innovation/tree/puna-verzija):

- **Raspored smjena** po odjelu, s upozorenjima na smjenu bez liječnika ili sestre i rad bez odmora.
- **Administracija**: upis djelatnika, razine pristupa i odjeli.
- **Alergije kao pravilo**: upozorenje kad je u terapiji lijek na koji je zabilježena alergija.
- **Ostale uloge**: voditelj odjela, ravnatelj (pregled svih odjela) i administrator, uz različita prava liječnika i sestre.
- Profil pacijenta s poviješću bolesti, obrazac za novog pacijenta i upis kliničkih zapisa.

## Tim

AI2MED hackathon, studeni 2026.
