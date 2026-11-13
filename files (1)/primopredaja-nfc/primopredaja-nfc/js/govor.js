/*
 * Govor u tekst: Web Speech API (SpeechRecognition), jezik hr-HR.
 *
 * Radi u Chromeu i Edgeu (računalo i Android), samo preko HTTPS-a ili na localhostu, i treba internet:
 * Chrome šalje zvuk na Googleove poslužitelje. Za demo s izmišljenim podacima to je prihvatljivo,
 * za stvarne pacijente nije (vidi README). Safari radi djelomično, Firefox ne radi;
 * tada se tekst upisuje ili lijepi ručno.
 */
(function () {
  const Prepoznavanje = window.SpeechRecognition || window.webkitSpeechRecognition;
  const podrzan = !!Prepoznavanje;
  let aktivno = null;

  // naTekst(tekst, gotovo): cijeli dosad izgovoreni tekst (konačni + privremeni dio)
  // naKraj(tekst): kad prepoznavanje stane (gumb, tišina ili greška)
  // naGresku(kod): 'dozvola' | 'mikrofon' | 'mreza' | 'tisina' | 'greska'
  function pokreni({ naTekst, naKraj, naGresku }) {
    if (!podrzan) { naGresku('nepodrzano'); return; }
    zaustavi();
    const r = new Prepoznavanje();
    r.lang = 'hr-HR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let zadnji = '';

    // Tekst se svaki put slaže iznova iz svih rezultata (izbjegava dupliciranje na Androidu)
    r.onresult = (e) => {
      let konacno = '';
      let privremeno = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) konacno += t + ' ';
        else privremeno += t + ' ';
      }
      zadnji = (konacno + privremeno).replace(/\s+/g, ' ').trim();
      naTekst(zadnji, !privremeno);
    };
    r.onerror = (e) => {
      const kod = {
        'not-allowed': 'dozvola', 'service-not-allowed': 'dozvola',
        'audio-capture': 'mikrofon', network: 'mreza', 'no-speech': 'tisina', aborted: null
      }[e.error];
      if (kod !== null) naGresku(kod || 'greska');
    };
    r.onend = () => {
      if (aktivno === r) aktivno = null;
      naKraj(zadnji);
    };
    aktivno = r;
    try { r.start(); } catch (e) { aktivno = null; naGresku('greska'); }
  }

  function zaustavi() {
    if (aktivno) { const r = aktivno; aktivno = null; try { r.stop(); } catch (e) { /* već stalo */ } }
  }

  const slusa = () => !!aktivno;

  window.GOVOR = { podrzan, pokreni, zaustavi, slusa };
})();
