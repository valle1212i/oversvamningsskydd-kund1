// server.js (utdrag) ✅ korrekt ordning
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import i18nRouter from './server/i18n-router.js';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ...läs products/faq...

const app = express();
app.use(express.json({ limit: '32kb' }));
app.set('trust proxy', true);

// --- CORS först ---
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5500',
  'https://oversvamningsskydd-kund1.onrender.com',
  'https://vattentrygg.se',
  'https://www.vattentrygg.se',
]);
const corsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- I18n + statiska filer efter CORS ---
app.use('/i18n', i18nRouter);                       // GET /i18n/:locale → i18n/strings.xx.json
app.use(express.static(join(__dirname, 'public'))); // /lang-switcher.js
app.use(express.static(join(__dirname, 'dist')));   // Webflow-export

// ...OpenAI, dina API-routes etc. följer som du har...


// ----------------------------------------------------
// OpenAI
// ----------------------------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ----------------------------------------------------
// Kontextbygge för Aurora
// ----------------------------------------------------
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

// ----------------------------------------------------
// Hjälpare: IP-hash & cooldown
// ----------------------------------------------------
function hashIp(ip, salt) {
  try {
    return crypto.createHash('sha256').update(`${ip}|${salt}`).digest('hex');
  } catch {
    return null;
  }
}

// Generell cooldown-karta (kan återanvändas av olika routes)
const lastSeen = new Map(); // ipHash -> timestamp(ms)
function hitCooldown(ipHash, ms = 10_000) {
  const now = Date.now();
  const prev = lastSeen.get(ipHash) || 0;
  if (now - prev < ms) return true;
  lastSeen.set(ipHash, now);
  return false;
}

// ----------------------------------------------------
// Hjälpare: POST JSON med timeout (för portal-webhook)
// Node 18+ har global fetch.
// ----------------------------------------------------
async function postJsonWithTimeout(url, { headers = {}, body = {}, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

// ----------------------------------------------------
// API: Aurora (chat)
// ----------------------------------------------------
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

// ----------------------------------------------------
// API: Visit-logg (kallas från CMP)
//  - Haschar IP (ingen klartext lagras)
//  - Enkel spam-skydd (cooldown)
//  - Skriver till JSON Lines-fil (visits.log)
// OBS: Disk på Render är ephemeral – loggen är mest för kortsiktig felsökning.
// ----------------------------------------------------
app.post('/api/visit', async (req, res) => {
  try {
    const rawIp =
      req.ip ||
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      'unknown';

    const ipSalt = process.env.IP_SALT || 'change-me';
    const ipHash = hashIp(String(rawIp), ipSalt) || 'na';

    const { path, ref, ua } = Object(req.body || {});
    const safePath = typeof path === 'string' ? path.slice(0, 300) : null;
    const safeRef = typeof ref === 'string' ? ref.slice(0, 1000) : null;
    const safeUa =
      typeof ua === 'string'
        ? ua.slice(0, 400)
        : (req.get('user-agent') || '').slice(0, 400);

    if (hitCooldown(ipHash, 10_000)) {
      return res.status(202).json({ ok: true, throttled: true });
    }

    const entry = {
      ts: new Date().toISOString(),
      ip_hash: ipHash,
      path: safePath,
      ref: safeRef,
      ua: safeUa,
    };

    await fs.appendFile(join(__dirname, 'visits.log'), JSON.stringify(entry) + '\n', 'utf8');
    return res.status(204).end();
  } catch (err) {
    console.error('visit error:', err);
    return res.status(500).json({ ok: false });
  }
});

// ----------------------------------------------------
// API: Contact → vidarebefordra till kundportalen
//  - Läser Webflow-fält (name-4, email-7, message-8)
//  - Rate-limit via IP-hash (10s)
//  - Skickar till PORTAL_WEBHOOK_URL med Bearer PORTAL_INBOUND_TOKEN
// ----------------------------------------------------
const CONTACT_HONEYPOT_FIELD = 'company'; // lägg ett osynligt fält i formuläret
const contactSeen = new Map(); // ipHash -> ts

function contactCooldown(ipHash, ms = 10_000) {
  const now = Date.now();
  const prev = contactSeen.get(ipHash) || 0;
  if (now - prev < ms) return true;
  contactSeen.set(ipHash, now);
  return false;
}

app.post('/api/contact', async (req, res) => {
  try {
    // IP-hash för enkel rate limit + minimal spårning
    const rawIp =
      req.ip ||
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      'unknown';
    const ipSalt = process.env.IP_SALT || 'change-me';
    const ipHash = hashIp(String(rawIp), ipSalt) || 'na';

    if (contactCooldown(ipHash, 10_000)) {
      return res.status(429).json({ success: false, message: 'För många förfrågningar. Försök igen strax.' });
    }

    const b = Object(req.body || {});
    const name = (b.name || b['name-4'] || '').toString().trim().slice(0, 150);
    const email = (b.email || b['email-7'] || '').toString().trim().slice(0, 200);
    const message = (b.message || b['message-8'] || '').toString().trim().slice(0, 5000);
    const phone = (b.phone || b['phone-number'] || '').toString().trim().slice(0, 50);

    // Honeypot: om ifyllt -> behandla som OK men gör inget
    if ((b[CONTACT_HONEYPOT_FIELD] || '').toString().trim()) {
      return res.status(202).json({ success: true, queued: true });
    }

    // Minimal validering
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ success: false, message: 'Ogiltig e-postadress' });
    }
    if (!message) {
      return res.status(400).json({ success: false, message: 'Meddelande krävs' });
    }

    const url = process.env.PORTAL_WEBHOOK_URL;
    const token = process.env.PORTAL_INBOUND_TOKEN;
    if (!url || !token) {
      return res.status(500).json({ success: false, message: 'Saknar portal-konfiguration' });
    }

    const payload = {
      email,
      name,
      message,
      phone,
      source: 'vattentrygg.se',
      page: req.get('referer') || null,
      ip_hash: ipHash,
      ua: req.get('user-agent') || null,
    };

    const { ok, status, data } = await postJsonWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}` },
      body: payload,
      timeoutMs: 8000,
    });

    if (!ok) {
      console.error('Portal webhook fel:', status, data);
      return res.status(502).json({ success: false, message: 'Kunde inte skicka till kundportalen' });
    }

    return res.json({ success: true, ticket: data.ticket || null });
  } catch (err) {
    console.error('contact error:', err);
    return res.status(500).json({ success: false, message: 'Serverfel' });
  }
});

// ----------------------------------------------------
// Healthcheck & rot
// ----------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) =>
  res.status(200).send('Aurora backend up. Use POST /api/aurora/ask')
);

// ----------------------------------------------------
// Start
// ----------------------------------------------------
const PORT = process.env.PORT || 8080;
// Debug: vilken version och vilka routes finns?
app.get('/_whoami', (req, res) => {
  res.json({ ok: true, version: 'contact-route-added' });
});

// Debug: skriv ut alla registrerade routes i loggen vid start
function dumpRoutes() {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods).join(',').toUpperCase();
      routes.push(`${methods.padEnd(6)} ${m.route.path}`);
    }
  });
  console.log('Registered routes:\n' + routes.sort().join('\n'));
}
dumpRoutes();

app.listen(PORT, () => console.log('Aurora API listening on', PORT));
