// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Ladda JSON utan import-attributes (mest kompatibelt)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Datafiler ---
const products = JSON.parse(
  readFileSync(join(__dirname, 'data', 'products.json'), 'utf8')
);
const faq = JSON.parse(
  readFileSync(join(__dirname, 'data', 'faq.json'), 'utf8')
);

// --- App & middleware ---
const app = express();
app.use(express.json({ limit: '32kb' }));
app.set('trust proxy', true); // så att req.ip funkar bakom proxy (Render/Heroku etc.)

/* -----------------------------
   CORS (tillåt din frontend + lokalt)
-------------------------------- */
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5500',                             // Live Server (lokalt)
  'https://oversvamningsskydd-kund1.onrender.com',    // din statiska Render-sajt
  'https://vattentrygg.se',                        // ev. egen domän
]);

const corsOptions = {
  origin(origin, cb) {
    // tillåt även "no origin" (curl, Postman, health checks)
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // svara korrekt på preflight

/* -----------------------------
   OpenAI
-------------------------------- */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -----------------------------
   Kontextbygge (MVP)
-------------------------------- */
function buildContext() {
  const bullets = [
    'You are Aurora, an expert assistant for flood protection in Sweden.',
    'Answer in Swedish by default. Keep answers clear and concise.',
    'If a question involves safety or installation, give practical steps and when to contact a professional.',
    'If you do not know, say so and suggest contacting support.',
  ];

  const prodLines = products
    .map(
      (p) =>
        `• ${p.name}: ${p.type}, användning: ${p.use}, kapacitet: ${p.specs}, passar: ${p.suits}, artikel/id: ${p.sku}`
    )
    .join('\n');

  const faqLines = faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');

  return `${bullets.join('\n')}

FÖRETAGS-/PRODUKTINFO:
${prodLines}

FAQ & RIKTLINJER:
${faqLines}
`;
}

/* -----------------------------
   Hjälpare för IP-hash & cooldown
-------------------------------- */
function hashIp(ip, salt) {
  try {
    return crypto.createHash('sha256').update(`${ip}|${salt}`).digest('hex');
  } catch {
    return null;
  }
}

// Mycket enkel "cooldown" i minne: max 1 logg/10s per IP-hash
const lastSeen = new Map(); // ipHash -> timestamp (ms)
function hitCooldown(ipHash, ms = 10_000) {
  const now = Date.now();
  const prev = lastSeen.get(ipHash) || 0;
  if (now - prev < ms) return true;
  lastSeen.set(ipHash, now);
  return false;
}

/* -----------------------------
   API: Aurora (chat)
-------------------------------- */
app.post('/api/aurora/ask', async (req, res) => {
  try {
    const { question, history = [] } = req.body || {};
    if (!question) {
      return res.status(400).json({ success: false, message: 'question required' });
    }

    const system = buildContext();

    const messages = [
      { role: 'system', content: system },
      ...history.slice(-6),
      { role: 'user', content: question },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages,
    });

    const answer =
      completion.choices?.[0]?.message?.content?.trim() ||
      'Tyvärr, jag saknar ett svar just nu.';
    res.json({ success: true, answer });
  } catch (err) {
    console.error('aurora error:', err);
    res.status(500).json({ success: false, message: 'server error' });
  }
});

/* -----------------------------
   API: Visit-logg (kallas från CMP)
   - Haschar IP (ingen klartext lagras)
   - Enkel spam-skydd (cooldown)
   - Skriver till JSON Lines-fil (visits.log)
-------------------------------- */
app.post('/api/visit', async (req, res) => {
  try {
    // IP från proxy-kedja eller socket
    // Express med trust proxy ger req.ip som redan plockar korrekt ip från X-Forwarded-For
    const rawIp =
      req.ip ||
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      'unknown';

    // Hasha IP så att vi undviker klartext personuppgift
    const ipSalt = process.env.IP_SALT || 'change-me';
    const ipHash = hashIp(String(rawIp), ipSalt) || 'na';

    // Body från klienten (CMP skickar path/ref/ua)
    const { path, ref, ua } = Object(req.body || {});
    const safePath = typeof path === 'string' ? path.slice(0, 300) : null;
    const safeRef = typeof ref === 'string' ? ref.slice(0, 1000) : null;
    const safeUa =
      typeof ua === 'string'
        ? ua.slice(0, 400)
        : (req.get('user-agent') || '').slice(0, 400);

    // Throttla: max 1 logg / 10 sek per ipHash
    if (hitCooldown(ipHash, 10_000)) {
      return res.status(202).json({ ok: true, throttled: true });
    }

    // Bygg loggrad
    const entry = {
      ts: new Date().toISOString(),
      ip_hash: ipHash,
      path: safePath,
      ref: safeRef,
      ua: safeUa,
    };

    // Skriv en rad JSON (JSONL) — OBS: på Render/Heroku är disk ofta ephemeral
    await fs.appendFile(join(__dirname, 'visits.log'), JSON.stringify(entry) + '\n', 'utf8');

    return res.status(204).end();
  } catch (err) {
    console.error('visit error:', err);
    return res.status(500).json({ ok: false });
  }
});

/* -----------------------------
   Healthcheck & rot
-------------------------------- */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) =>
  res.status(200).send('Aurora backend up. Use POST /api/aurora/ask')
);

/* -----------------------------
   Start
-------------------------------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Aurora API listening on', PORT));
