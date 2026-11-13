/*
 * Web NFC: radi u Chromeu na Androidu, samo preko HTTPS-a (npr. GitHub Pages) ili na localhostu.
 *
 * Na narukvicu zapisujemo URL zapis oblika  https://<stranica>/#p=<ID>&nfc=1
 * - na Androidu ga aplikacija čita gumbom "Skeniraj narukvicu"
 * - na iPhoneu se poveznica otvori sama kad prislonite mobitel na narukvicu
 * Na narukvici je samo anonimni ID; bez prijave djelatnika on ne otkriva ništa o pacijentu.
 */
(function () {
  const podrzan = 'NDEFReader' in window;
  let kontroler = null;

  function tagIzZapisa(zapis) {
    try {
      const dekoder = new TextDecoder(zapis.encoding || 'utf-8');
      if (zapis.recordType === 'url' || zapis.recordType === 'absolute-url') {
        const m = dekoder.decode(zapis.data).match(/[#&?]p=([a-z0-9]+)/i);
        return m ? m[1] : null;
      }
      if (zapis.recordType === 'text') {
        const s = dekoder.decode(zapis.data).trim();
        return /^[a-z0-9]{4,32}$/i.test(s) ? s : null;
      }
    } catch (e) { /* neispravan zapis, preskačemo */ }
    return null;
  }

  async function skeniraj(naTag, naGresku) {
    if (!podrzan) { naGresku('nepodrzano'); return; }
    zaustavi();
    kontroler = new AbortController();
    try {
      const citac = new NDEFReader();
      citac.onreading = (dogadaj) => {
        let tag = null;
        for (const zapis of dogadaj.message.records) {
          tag = tagIzZapisa(zapis);
          if (tag) break;
        }
        if (tag) { zaustavi(); naTag(tag); } else { naGresku('prazan'); }
      };
      citac.onreadingerror = () => naGresku('citanje');
      await citac.scan({ signal: kontroler.signal });
    } catch (err) {
      naGresku(err && err.name === 'NotAllowedError' ? 'dozvola' : 'citanje');
    }
  }

  function zaustavi() {
    if (kontroler) { kontroler.abort(); kontroler = null; }
  }

  async function zapisi(url) {
    if (!podrzan) throw new Error('nepodrzano');
    const pisac = new NDEFReader();
    await pisac.write({ records: [{ recordType: 'url', data: url }] });
  }

  window.NFC = { podrzan, skeniraj, zaustavi, zapisi };
})();
