# Primopredaja smjene uz NFC narukvicu

Prototip s AI2MED hackathona, izazov 12: kako poboljšati prijenos informacija među zdravstvenim djelatnicima.

Svaki pacijent nosi NFC narukvicu s anonimnim ID-em. Pri primopredaji smjene djelatnik uz krevet prisloni mobitel na narukvicu i otvori se kartica tog pacijenta u **I-PASS** strukturi:

| | Dio kartice | Što prikazuje |
|---|---|---|
| **I** | Težina stanja | stabilan, pojačan nadzor ili hitna pozornost; sustav podiže procjenu ako postoje upozorenja |
| **P** | Sažetak pacijenta | kratki sažetak s poveznicama na izvorne zapise (iz pravila ili AI) |
| **A** | Akcijska lista | zadaci za sljedeću smjenu i nalazi na čekanju |
| **S** | Plan za moguće situacije | "ako se dogodi X, napravi Y" |
| **S** | Provjera i preuzimanje | upozorenja koja treba potvrditi, bilješka uz krevet, potvrda preuzimanja |

Pacijenta se ne može preuzeti dok se ne potvrde sva upozorenja. Sustav bilježi tko je, kada i kako (skeniranjem ili ručno) preuzeo svakog pacijenta.

> **Svi podaci su izmišljeni.** Ovo je prototip za hackathon, nije medicinski proizvod i ne smije se koristiti sa stvarnim podacima o pacijentima.

## Što prototip pokazuje

- **Skeniranje NFC narukvice** (Web NFC) i otvaranje kartice pravog pacijenta.
- **Upozorenja iz pravila** koja hvataju ono što se najčešće izgubi pri primopredaji:
  - nalaz je stigao, a nitko ga nije pregledao (kritično ako je izvan referentnog raspona);
  - promjena terapije u zadnjih 12 h koja nije spomenuta ni u jednoj bilješci;
  - pad saturacije, febrilitet, nagla promjena srčane frekvencije, niski tlak;
  - zadatak kojem je prošao rok.
- **Izvor za svaku tvrdnju**: klik na „izvor“ otvara izvorni zapis.
- **Kontrola pristupa**: djelatnik vidi samo pacijente svog odjela; pokušaj pristupa tuđem pacijentu se odbija i bilježi.
- **Zapisnik** svih prijava, skeniranja, otvaranja kartica i preuzimanja.
- **Neobavezni AI sažetak** (Claude) preko lokalnog poslužitelja, uz provjeru da se sažetak poziva samo na postojeće zapise.

Upozorenja su namjerno pravila, a ne AI: moraju biti predvidljiva, pa AI ne može „zaboraviti“ kritičan nalaz. AI piše samo tekstualni sažetak, a odgovornost i odluka ostaju djelatniku.

## Pokretanje

### 1. Najbrže: samo otvoriti

U mapi projekta pokrenite bilo koji statični poslužitelj, npr.:

```bash
python3 -m http.server 8000
```

i otvorite http://localhost:8000. Radi sve osim AI sažetka. Bez NFC-a karticu otvarate dodirom na pacijenta ili upisom ID-a narukvice.

### 2. GitHub Pages: za NFC na mobitelu

Web NFC radi samo preko HTTPS-a, a GitHub Pages ga daje besplatno.

1. Stavite repozitorij na GitHub.
2. **Settings → Pages → Build and deployment → Deploy from a branch**, odaberite `main` i `/ (root)`.
3. Nakon minute-dvije aplikacija je na `https://<korisnik>.github.io/<repozitorij>/`.
4. Otvorite tu adresu u **Chromeu na Androidu**.

Na GitHub Pagesu AI sažetak ne radi (nema poslužitelja), pa se prikazuje sažetak iz pravila.

### 3. Lokalni poslužitelj s AI sažetkom

Treba Node.js 20.6 ili noviji, bez dodatnih paketa.

```bash
cd server
cp .env.example .env        # upišite ANTHROPIC_API_KEY u .env
npm start
```

Otvorite http://localhost:3000. Na kartici pacijenta pojavit će se gumb **Napravi AI sažetak**. API ključ ostaje na poslužitelju i nikad ne ide u preglednik; `.env` je u `.gitignore`.

Model se može promijeniti varijablom `CLAUDE_MODEL` u `.env`. Dokumentacija: https://docs.claude.com/en/api/overview

Za NFC i AI zajedno na mobitelu lokalni poslužitelj mora biti dostupan preko HTTPS-a, npr. tunelom (`ngrok http 3000`).

## Demo PIN-ovi

| PIN | Djelatnik | Odjel |
|---|---|---|
| 1111 | dr. Ana Kovač, odjelna liječnica | Interna B |
| 2222 | dr. Luka Radić, dežurni liječnik | Interna B |
| 3333 | Ivana Tomić, medicinska sestra | Interna B |
| 4444 | dr. Marko Grgić, kirurg | Kirurgija A (za test odbijenog pristupa) |

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
2. Prijavite se kao dežurni liječnik (PIN 2222). Odjel pokazuje 0 od 6 preuzetih, Ivo je na vrhu, crveno.
3. Skenirajte narukvicu. Kartica potvrđuje identitet i pokazuje **kritično upozorenje: kalij 6,1 mmol/L stigao u 18:50, nitko ga nije pregledao**, uz uvedeni spironolakton koji nije spomenut i pad srčane frekvencije.
4. Klik na „izvor n2“ pokazuje izvorni nalaz.
5. Pokušajte preuzeti: gumb je zaključan dok se ne potvrde sva upozorenja. Potvrdite ih i preuzmite.
6. Natrag na odjelu: 1 od 6 preuzeto.
7. Za pitanje o privatnosti: prijavite se PIN-om 4444 (kirurg) i skenirajte istu narukvicu. Pristup je odbijen i zabilježen u **Zapisniku**.

Rezervni plan ako NFC zakaže: dodirnite pacijenta na popisu ili upišite ID ručno. Kartica će pokazati da je otvorena bez skeniranja.

## Struktura

```
index.html          ulazna stranica
css/style.css       izgled (svijetli i tamni način za noćnu smjenu)
js/data.js          izmišljeni pacijenti, djelatnici, nalazi
js/pravila.js       upozorenja, procjena stanja, I-PASS dijelovi, izvorni zapisi
js/nfc.js           čitanje i zapisivanje NFC narukvica (Web NFC)
js/app.js           ekrani, prijava, preuzimanje, zapisnik
server/server.js    neobavezni poslužitelj za AI sažetak (Claude API)
```

Stanje demoa (preuzimanja, bilješke, zapisnik) sprema se u `localStorage` preglednika. Gumb **Nova primopredaja** na dnu odjela briše preuzimanja i bilješke.

## Što bi trebalo za stvarnu upotrebu

- Povezivanje s bolničkim informacijskim sustavom umjesto `data.js`.
- Prijava preko bolničkog sustava ili službene kartice, a ne PIN-om u aplikaciji.
- Zapisnik na poslužitelju koji se ne može mijenjati.
- AI model unutar bolničke infrastrukture ili s ugovorom o obradi podataka, u skladu s GDPR-om.
- Klinička validacija pravila za upozorenja s liječnicima i medicinskim sestrama.

## Tim

AI2MED hackathon, studeni 2026.
