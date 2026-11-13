/*
 * Neobavezni lokalni poslužitelj.
 * - poslužuje aplikaciju (index.html, css/, js/)
 * - /api/zdravlje  -> javlja je li AI uključen
 * - /api/sazetak   -> šalje zapise pacijenta Claudeu i vraća sažetak s ID-evima izvora
 *
 * API ključ ostaje na poslužitelju i nikad ne ide u preglednik.
 * Pokretanje: vidi README.md. Treba Node.js 20.6 ili noviji, bez dodatnih paketa.
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OVDJE = path.dirname(fileURLToPath(import.meta.url));
const KORIJEN = path.resolve(OVDJE, "..");
const PORT = Number(process.env.PORT) || 3000;
const KLJUC = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SUSTAV = `Ti si asistent za primopredaju smjene na bolničkom odjelu.
Dobivaš zapise o jednom pacijentu; svaki zapis ima ID u uglatim zagradama.
Napiši sažetak pacijenta za kolegu koji preuzima smjenu: najviše tri kratke rečenice na hrvatskom.
Pravila:
- Koristi isključivo činjenice iz zapisa. Ništa ne izmišljaj i ne nagađaj.
- Ne postavljaj dijagnoze i ne predlaži terapiju.
- Istakni promjene stanja i ono što je nedovršeno.
Odgovori samo JSON objektom, bez ikakvog drugog teksta i bez markdowna:
{"sazetak": "...", "izvori": ["ID", "ID"]}
gdje su "izvori" ID-evi zapisa na kojima se sažetak temelji.`;

function posaljiJSON(res, status, podaci) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(podaci));
}

async function procitajTijelo(req, max = 200_000) {
  let ukupno = 0;
  const dijelovi = [];
  for await (const dio of req) {
    ukupno += dio.length;
    if (ukupno > max) throw new Error("Zahtjev je prevelik.");
    dijelovi.push(dio);
  }
  return JSON.parse(Buffer.concat(dijelovi).toString("utf8"));
}

async function napraviSazetak(tijelo) {
  const zapisi = Array.isArray(tijelo.zapisi) ? tijelo.zapisi.slice(0, 80) : [];
  if (!zapisi.length) throw new Error("Nema zapisa za sažetak.");

  const tekst = zapisi
    .map(
      (z) =>
        `[${String(z.id)}] ${String(z.vrsta)}, ${String(z.vrijeme)}: ${String(z.tekst)}`,
    )
    .join("\n");

  const odg = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KLJUC,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SUSTAV,
      messages: [
        {
          role: "user",
          content: `Pacijent: ${String(tijelo.opis || "")}\n\nZapisi:\n${tekst}`,
        },
      ],
    }),
  });

  if (!odg.ok) {
    const opis = (await odg.text()).slice(0, 300);
    throw new Error(`Claude API vratio je ${odg.status}: ${opis}`);
  }

  const podaci = await odg.json();
  const sirovo = (podaci.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  const json = JSON.parse(sirovo);
  const poznati = new Set(zapisi.map((z) => String(z.id)));
  const izvori = (Array.isArray(json.izvori) ? json.izvori : [])
    .map(String)
    .filter((id) => poznati.has(id));

  // Sažetak bez ijednog valjanog izvora odbacujemo: AI ne smije tvrditi ništa što se ne može provjeriti.
  if (
    typeof json.sazetak !== "string" ||
    !json.sazetak.trim() ||
    !izvori.length
  ) {
    throw new Error("AI je vratio sažetak bez valjanih izvora.");
  }
  return { sazetak: json.sazetak.trim(), izvori };
}

async function posluziDatoteku(req, res) {
  const url = new URL(req.url, "http://localhost");
  let put = decodeURIComponent(url.pathname);
  if (put === "/") put = "/index.html";

  const pun = path.normalize(path.join(KORIJEN, put));
  const relativno = path.relative(KORIJEN, pun);
  const zabranjeno =
    relativno.startsWith("..") ||
    relativno.split(path.sep).some((dio) => dio.startsWith(".")) ||
    relativno.split(path.sep)[0] === "server" ||
    relativno.split(path.sep)[0] === "node_modules";

  if (zabranjeno) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Nije pronađeno");
    return;
  }

  try {
    const sadrzaj = await readFile(pun);
    res.writeHead(200, {
      "content-type": MIME[path.extname(pun)] || "application/octet-stream",
    });
    res.end(sadrzaj);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Nije pronađeno");
  }
}

const posluzitelj = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/zdravlje" && req.method === "GET") {
      return posaljiJSON(res, 200, {
        ai: Boolean(KLJUC),
        model: KLJUC ? MODEL : null,
      });
    }
    if (req.url === "/api/sazetak" && req.method === "POST") {
      if (!KLJUC)
        return posaljiJSON(res, 503, {
          greska: "AI nije uključen: nedostaje ANTHROPIC_API_KEY.",
        });
      const tijelo = await procitajTijelo(req);
      return posaljiJSON(res, 200, await napraviSazetak(tijelo));
    }
    if (req.method === "GET") return posluziDatoteku(req, res);
    res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    posaljiJSON(res, 500, { greska: err.message });
  }
});

posluzitelj.listen(PORT, () => {
  console.log(`Primopredaja radi na http://localhost:${PORT}`);
  console.log(
    KLJUC
      ? `AI sažetak uključen (model ${MODEL}).`
      : "AI sažetak isključen: postavite ANTHROPIC_API_KEY u server/.env",
  );
});
