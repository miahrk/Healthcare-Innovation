# Upute za tim: kako se spojiti na repozitorij

Glavni repozitorij projekta je **https://github.com/miahrk/Healthcare-Innovation**.
Stari repozitoriji (`miahrk/Algebra-Hackaton`, `martasimic/Algebra-Hackaton`) se više ne koriste.

Upute su pisane za Windows; na macOS-u i Linuxu naredbe su iste, samo se terminal zove drugačije.

**Sadržaj**

1. [Što vam treba](#1-što-vam-treba)
2. [Prihvatite poziv u repozitorij](#2-prihvatite-poziv-u-repozitorij)
3. [Sakrijte svoj e-mail (obavezno prije prvog commita)](#3-sakrijte-svoj-e-mail-obavezno-prije-prvog-commita)
4. [Preuzmite repozitorij](#4-preuzmite-repozitorij)
5. [Imate li stariju kopiju? Prebacite je na novi repozitorij](#5-imate-li-stariju-kopiju-prebacite-je-na-novi-repozitorij)
6. [Pokrenite aplikaciju](#6-pokrenite-aplikaciju)
7. [Svakodnevni rad](#7-svakodnevni-rad)
8. [Pravila](#8-pravila)
9. [Česti problemi](#9-česti-problemi)
10. [Bez terminala: GitHub Desktop](#10-bez-terminala-github-desktop)

---

## 1. Što vam treba

| Što | Zašto | Gdje |
|---|---|---|
| GitHub račun | za pristup repozitoriju | https://github.com/signup |
| Git | preuzimanje i slanje promjena | https://git-scm.com/download/win (sve zadane opcije su u redu) |
| Uređivač koda | npr. VS Code | https://code.visualstudio.com |
| Python **ili** Node.js 20.6+ | za pokretanje aplikacije lokalno | https://www.python.org/downloads ili https://nodejs.org |

Provjera da je Git instaliran (u terminalu: **Git Bash**, PowerShell ili terminal u VS Codeu):

```bash
git --version
```

Ispis tipa `git version 2.4x...` znači da je sve u redu.

## 2. Prihvatite poziv u repozitorij

1. Pošaljite Miji svoje **GitHub korisničko ime** (ne e-mail).
2. Mia vas dodaje kao suradnika (Settings → Collaborators).
3. Stići će vam e-mail od GitHuba. Prihvatite poziv klikom na **Accept invitation**,
   ili otvorite https://github.com/miahrk/Healthcare-Innovation/invitations dok ste prijavljeni.

Dok poziv nije prihvaćen, ne možete slati promjene (a dok je repozitorij privatan, ne možete ga ni vidjeti).

## 3. Sakrijte svoj e-mail (obavezno prije prvog commita)

Svaki commit sadrži ime i e-mail autora, i ti su podaci javno vidljivi u povijesti repozitorija.
Zato koristimo GitHubovu skrivenu (`noreply`) adresu.

1. Na GitHubu otvorite **Settings → Emails** (https://github.com/settings/emails).
2. Uključite **Keep my email addresses private**.
3. Uključite **Block command line pushes that expose my email**.
4. Ispod prve opcije piše vaša skrivena adresa, oblika `12345678+korisnik@users.noreply.github.com`. Kopirajte je.
5. U terminalu postavite ime i tu adresu:

```bash
git config --global user.name "Ime Prezime"
git config --global user.email "12345678+korisnik@users.noreply.github.com"
```

Provjera:

```bash
git config --global user.email
```

## 4. Preuzmite repozitorij

Otvorite terminal u mapi u kojoj želite projekt (npr. `C:\Projekti`) i pokrenite:

```bash
git clone https://github.com/miahrk/Healthcare-Innovation.git
cd Healthcare-Innovation
```

Kod prvog spajanja Git na Windowsu otvara prozor preglednika za **prijavu na GitHub** (Git Credential Manager).
Prijavite se i potvrdite; lozinku više nećete morati upisivati.

> GitHub ne prihvaća lozinku računa u terminalu. Ako vas terminal ipak pita za lozinku,
> pogledajte [Česti problemi](#9-česti-problemi).

Struktura projekta:

```
Healthcare-Innovation/
├── README.md
├── UPUTE-ZA-TIM.md                     ← ove upute
└── files (1)/
    └── primopredaja-nfc/primopredaja-nfc/   ← APLIKACIJA
        ├── index.html
        ├── css/  js/                         ← sučelje i logika
        ├── server/                           ← neobavezni poslužitelj za AI sažetak
        └── README.md                         ← opis aplikacije, demo PIN-ovi, scenarij
```

Naziv mape `files (1)` sadrži razmak i zagrade, pa ga u terminalu uvijek pišite **pod navodnicima**:

```bash
cd "files (1)/primopredaja-nfc/primopredaja-nfc"
```

## 5. Imate li stariju kopiju? Prebacite je na novi repozitorij

Povijest repozitorija je prepisana (uklonjeni su e-mailovi iz commitova), pa se stare kopije ne poklapaju s novom.
Ovo vrijedi ako ste ranije klonirali `Algebra-Hackaton` ili radite u forku `martasimic/Algebra-Hackaton`.

**Najjednostavnije:** obrišite (ili preimenujte) staru mapu i napravite korak 4 ispočetka.

**Ako u staroj mapi imate promjene koje još niste poslali**, prvo ih sačuvajte:

```bash
# u staroj mapi projekta
git status                                   # što je promijenjeno
git stash push -u -m "moje promjene"         # privremeno spremi promjene
```

Zatim prebacite kopiju na novi repozitorij:

```bash
git remote set-url origin https://github.com/miahrk/Healthcare-Innovation.git
git fetch origin
git checkout main
git reset --hard origin/main                 # lokalni main = main na GitHubu
git stash pop                                # vrati svoje promjene
```

Ako ste imali **commitove koje niste pushali**, nemojte raditi `reset` dok ih ne spremite.
Najlakše je kopirati izmijenjene datoteke na stranu, napraviti svježi klon (korak 4) i vratiti ih,
ili se javiti Miji pa ćemo ih prenijeti zajedno.

**Nikad ne pushajte staru povijest** (`git push --force` iz stare kopije): vratili biste stare commitove s e-mailovima.

## 6. Pokrenite aplikaciju

Sve naredbe se pokreću iz mape aplikacije:

```bash
cd "files (1)/primopredaja-nfc/primopredaja-nfc"
```

**Varijanta A: bez AI sažetka (najbrže)**

```bash
python -m http.server 8000      # na nekim računalima: py -m http.server 8000
```

Otvorite http://localhost:8000. Zaustavljanje: `Ctrl + C`.

**Varijanta B: s AI sažetkom (Node.js 20.6+)**

```bash
cd server
copy .env.example .env          # Git Bash / macOS / Linux: cp .env.example .env
```

U datoteku `server/.env` upišite API ključ (`ANTHROPIC_API_KEY=...`), pa:

```bash
npm start
```

Otvorite http://localhost:3000.

Bez ključa poslužitelj se može pokrenuti s `npm run start:bez-ai`.

**Demo prijava** (PIN-ovi; svi podaci su izmišljeni):

| PIN | Uloga |
|---|---|
| 2222 | liječnik (Interna B) |
| 3333 | medicinska sestra (Interna B) |
| 4444 | liječnik s drugog odjela (test odbijenog pristupa) |

Detaljan opis aplikacije je u `files (1)/primopredaja-nfc/primopredaja-nfc/README.md`.

## 7. Svakodnevni rad

### Prije nego počnete raditi: preuzmite najnovije promjene

```bash
git checkout main
git pull
```

### Radite na svojoj grani

Za svaku novu funkciju ili ispravak napravite granu s opisnim imenom:

```bash
git checkout -b ispravak-upozorenja
```

### Spremite i pošaljite promjene

```bash
git status                       # pregled promijenjenih datoteka
git add <datoteka>               # ili: git add .   (sve promjene)
git commit -m "Kratak opis što ste napravili"
git push -u origin ispravak-upozorenja
```

Nakon pusha terminal ispisuje poveznicu za **pull request**. Otvorite je (ili na GitHubu kliknite
**Compare & pull request**), opišite promjenu i pošaljite. Netko iz tima je pregleda i spoji u `main`.

### Nakon što je pull request spojen

```bash
git checkout main
git pull
git branch -d ispravak-upozorenja
```

### Dobri commitovi

- Jedan commit = jedna logična promjena.
- Poruka na hrvatskom, kratko i konkretno: `Dodano upozorenje za nisku saturaciju`, ne `izmjene` ili `fix`.
- Prije commita provjerite `git status` da ne šaljete nešto slučajno.

## 8. Pravila

1. **Nikad ne commitajte tajne**: API ključeve, lozinke, tokene, datoteku `.env`.
   `.env` je u `.gitignore`, ali ne zaobilazite to (`git add -f`). Ako ključ slučajno završi u commitu,
   **odmah javite timu** i opozovite ključ (`https://console.anthropic.com` → API keys): brisanje iz povijesti nije dovoljno.
2. **Nikad ne unosite stvarne podatke o pacijentima.** Svi podaci u aplikaciji su izmišljeni i tako mora ostati.
3. **Ne pushajte izravno na `main`** veće promjene; koristite granu i pull request.
4. **Ne koristite `git push --force`** na `main`.
5. Koristite skrivenu GitHub e-mail adresu (korak 3).

## 9. Česti problemi

| Poruka / problem | Uzrok | Rješenje |
|---|---|---|
| `Repository not found` ili `403` | niste prihvatili poziv ili niste prijavljeni pravim računom | korak 2; u Windowsu otvorite **Credential Manager → Windows Credentials**, obrišite unos `git:https://github.com` i ponovite naredbu |
| Terminal traži lozinku | stara verzija Gita bez Credential Managera | ažurirajte Git, ili umjesto lozinke upišite **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained, pristup repozitoriju *Contents: Read and write*) |
| `GH007: Your push would publish a private email address` | commit je napravljen sa stvarnim e-mailom | napravite korak 3, zatim `git commit --amend --reset-author --no-edit` i ponovite push |
| `rejected ... (fetch first)` ili `non-fast-forward` | na GitHubu ima novih promjena | `git pull --rebase`, pa ponovno `git push` |
| Konflikt (`CONFLICT ...`) nakon pulla | ista mjesta su mijenjana s dvije strane | otvorite datoteke s oznakama `<<<<<<<`, `=======`, `>>>>>>>`, ostavite ispravnu verziju, pa `git add <datoteka>` i `git rebase --continue` (ili `git commit` ako ste radili merge). VS Code ima gumbe *Accept Current / Incoming / Both* |
| `refusing to merge unrelated histories` | radite u staroj kopiji s prepisanom poviješću | korak 5 |
| `cd: files: No such file or directory` | razmak u nazivu mape | stavite putanju pod navodnike: `cd "files (1)/..."` |
| `warning: LF will be replaced by CRLF` | razlika u završecima redaka (Windows) | bezopasno, može se zanemariti |
| `python` nije prepoznat | Python nije instaliran ili nije u PATH-u | probajte `py -m http.server 8000` ili instalirajte Python uz opciju *Add to PATH* |
| Aplikacija prikazuje stare podatke | demo sprema stanje u preglednik | na dnu ekrana odjela kliknite *Vrati početne demo podatke* |

## 10. Bez terminala: GitHub Desktop

Ako vam je terminal nespretan, isto se može napraviti u **GitHub Desktopu** (https://desktop.github.com):

1. **File → Options → Accounts**: prijavite se na GitHub.
2. **File → Options → Git**: provjerite da je e-mail skrivena `noreply` adresa (korak 3).
3. **File → Clone repository → URL**: `https://github.com/miahrk/Healthcare-Innovation.git`.
4. Na vrhu: **Current branch → New branch** za novu granu.
5. Nakon izmjena: lijevo dolje upišite opis, **Commit to ...**, pa **Push origin**.
6. **Create Pull Request** otvara pull request na GitHubu.
7. **Fetch origin / Pull origin** preuzima promjene ostalih.

---

Pitanja i problemi: javite se Miji ili otvorite *Issue* na https://github.com/miahrk/Healthcare-Innovation/issues.
