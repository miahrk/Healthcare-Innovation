# Healthcare Innovation: primopredaja smjene uz NFC narukvicu

Prototip s AI2MED hackathona (izazov 12): prijenos informacija o pacijentu pri primopredaji smjene.

Dvije funkcionalnosti:
- **NFC narukvica:** skeniranje uz krevet otvara zapis pacijenta pripremljen za primopredaju (ključni podaci, zadnji nalazi, terapija, bilješke, otvoreni zadaci) i bilježi tko je i kada pristupio. Bez NFC čitača skeniranje se može simulirati.
- **Glasovni unos:** izgovoreno se razvrstava u polja zapisa kao nepotvrđeni nacrt; u zapis ulazi samo ono što djelatnik pregleda i potvrdi.

**Glavni repozitorij:** https://github.com/miahrk/Healthcare-Innovation

Aplikacija je u mapi [`files (1)/primopredaja-nfc/primopredaja-nfc`](files%20(1)/primopredaja-nfc/primopredaja-nfc). Upute za pokretanje, testove, scenarij za demo, NFC narukvice i glasovni unos su u [njezinom README-u](files%20(1)/primopredaja-nfc/primopredaja-nfc/README.md).

Demo PIN-ovi:

| PIN | Djelatnik |
|---|---|
| 2222 | dr. Luka Radić, liječnik, Interna B |
| 3333 | Ivana Tomić, medicinska sestra, Interna B |
| 4444 | dr. Marko Grgić, kirurg, Kirurgija A (test odbijenog pristupa) |

Puna verzija prototipa (raspored smjena, administracija, profili pacijenata, više uloga) čuva se na grani [`puna-verzija`](https://github.com/miahrk/Healthcare-Innovation/tree/puna-verzija).

> Svi podaci su izmišljeni. Prototip nije medicinski proizvod.

## Za članove tima

Detaljne upute (pristup, skriveni e-mail, kloniranje, pokretanje, rad s granama, česti problemi): **[UPUTE-ZA-TIM.md](UPUTE-ZA-TIM.md)**.

Ukratko:

```bash
git clone https://github.com/miahrk/Healthcare-Innovation.git
```

Ako imate stariju kopiju (klon `Algebra-Hackaton` ili fork `martasimic/Algebra-Hackaton`), povijest je u međuvremenu prepisana. Klonirajte ponovno ili u postojećoj kopiji pokrenite:

```bash
git remote set-url origin https://github.com/miahrk/Healthcare-Innovation.git
git fetch origin
git reset --hard origin/main   # briše lokalne nepushane promjene
```

Prije prvog commita postavite GitHub `noreply` adresu da vaš e-mail ne bude javan:

```bash
git config user.email "<ID>+<korisnik>@users.noreply.github.com"
```

(adresa je na GitHubu u Settings → Emails).
