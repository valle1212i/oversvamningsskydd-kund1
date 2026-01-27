// server.js (utdrag) ✅ korrekt ordning
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import i18nRouter from './server/i18n-router.js';
import payoutsRoutes from './routes/payouts.js';


import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// Global Error Handlers - Prevent server crashes
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit - let Cloud Run handle health checks
  // Log error but keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - log and continue
});

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// --- Läs in products/faq (robust fallback) ---
function loadAuroraData() {
  // products.json
  try {
    const prodTxt = readFileSync(join(__dirname, 'dist', 'data', 'products.json'), 'utf8');
    try {
      globalThis.products = JSON.parse(prodTxt);
    } catch (e) {
      console.warn('Aurora: kunde inte JSON-parsa products.json – använder tom lista.', e?.message);
      globalThis.products = [];
    }
  } catch (e) {
    console.warn('Aurora: products.json saknas – använder tom lista.', e?.message);
    globalThis.products = [];
  }

  // faq.json
  try {
    const faqTxt = readFileSync(join(__dirname, 'dist', 'data', 'faq.json'), 'utf8');
    try {
      globalThis.faq = JSON.parse(faqTxt);
    } catch (e) {
      console.warn('Aurora: kunde inte JSON-parsa faq.json – använder tom lista.', e?.message);
      globalThis.faq = [];
    }
  } catch (e) {
    console.warn('Aurora: faq.json saknas – använder tom lista.', e?.message);
    globalThis.faq = [];
  }
}
loadAuroraData();



const app = express();
app.use(express.json({ limit: '32kb' }));
app.set('trust proxy', true);

// --- CORS först ---
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5500',
  'https://oversvamningsskydd-kund1.onrender.com',
  'https://vattentrygg.se',
  'https://www.vattentrygg.se',
  'https://source-database.onrender.com',
  'https://source-database.onrender.com/'
]);

// Funktion för att kontrollera om origin är tillåten (inklusive wildcard-mönster)
function isOriginAllowed(origin) {
  if (!origin) return true; // Tillåt requests utan origin (t.ex. Postman)
  
  // Exakt match i ALLOWED_ORIGINS
  if (ALLOWED_ORIGINS.has(origin)) return true;
  
  // Wildcard-mönster: *.run.app (Cloud Run)
  if (origin.startsWith('https://') && origin.includes('.run.app')) {
    return true;
  }
  
  return false;
}

const corsOptions = {
  origin: function(origin, callback) {
    if (isOriginAllowed(origin)) {
      // Returnera origin explicit för att sätta Access-Control-Allow-Origin korrekt
      callback(null, origin || '*');
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'X-Internal-Auth', 'X-Tenant'],
  exposedHeaders: [],
  credentials: false,
  optionsSuccessStatus: 204,
  maxAge: 86400, // Cache preflight requests för 24 timmar
  preflightContinue: false,
};

// CORS middleware FÖRE alla routes
app.use(cors(corsOptions));

// Explicit OPTIONS handler för alla routes
app.options('*', cors(corsOptions));

// Ytterligare explicit OPTIONS handler för /api/aurora/ask
app.options('/api/aurora/ask', cors(corsOptions));

// --- I18n + statiska filer efter CORS ---
app.use('/i18n', i18nRouter);                       // GET /i18n/:locale → i18n/strings.xx.json
app.use(express.static(join(__dirname, 'public'))); // /lang-switcher.js
app.use(express.static(join(__dirname, 'dist')));   // Webflow-export
app.use('/api/payouts', payoutsRoutes);


// ...OpenAI, dina API-routes etc. följer som du har...


// ----------------------------------------------------
// OpenAI (lazy initialization)
// ----------------------------------------------------
let openaiInstance = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  if (!openaiInstance) {
    openaiInstance = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiInstance;
}

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

  // Läs säkert från global scope om det finns, annars tomma listor
  const pList = Array.isArray(globalThis.products) ? globalThis.products : [];
  const fList = Array.isArray(globalThis.faq) ? globalThis.faq : [];

  if (pList.length === 0) console.warn('Aurora: products saknas (använder fallback).');
  if (fList.length === 0) console.warn('Aurora: faq saknas (använder fallback).');

  const prodLines = pList
    .map((p) =>
      `• ${p.name}: ${p.type}, användning: ${p.use}, kapacitet: ${p.specs}, passar: ${p.suits}, artikel/id: ${p.sku}`
    )
    .join('\n') || '• Produktkatalog saknas just nu.';

  const faqLines = fList
    .map((f) => `Q: ${f.q}\nA: ${f.a}`)
    .join('\n\n') || 'Inga FAQ-poster tillgängliga.';

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
    // Guard: kontrollera om OpenAI API-nyckel finns
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ 
        success: false, 
        message: 'OpenAI service is not configured. Please set OPENAI_API_KEY environment variable.' 
      });
    }

    const { question, history = [] } = req.body || {};
    if (!question) {
      return res.status(400).json({ success: false, message: 'question required' });
    }

    // Lazy-initialize OpenAI klient
    const openai = getOpenAI();

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
    // Returnera ett tydligt fel utan att krascha processen
    if (err.message && err.message.includes('OPENAI_API_KEY')) {
      return res.status(503).json({ 
        success: false, 
        message: 'OpenAI service is not configured. Please set OPENAI_API_KEY environment variable.' 
      });
    }
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

    // Forward to portal (non-blocking/best-effort)
    try {
      const portalUrl = process.env.PORTAL_PAGEVIEWS_URL || 'https://source-database.onrender.com/api/pageviews/track';
      const portalToken = process.env.PORTAL_INBOUND_TOKEN || process.env.PORTAL_PAGEVIEWS_TOKEN || '';
      // Map minimal fields to portal schema; server adds IP via request
      const body = {
        site: 'vattentrygg.se',
        url: safePath || '/',
        referrer: safeRef,
        title: null,
        ts: Date.now(),
        viewport: null,
        ua: safeUa,
        consent: true,
        ip_hash: ipHash
      };
      // Fire-and-forget; no await to avoid delaying response
      postJsonWithTimeout(portalUrl, {
        headers: portalToken ? { Authorization: `Bearer ${portalToken}` } : {},
        body,
        timeoutMs: 5000,
      }).catch(()=>{});
    } catch (_) {}

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
// Stripe Checkout Handler
// ----------------------------------------------------
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
}) : null;

const SUCCESS_URL = process.env.SUCCESS_URL || 'https://vattentrygg.se/success';
const CANCEL_URL = process.env.CANCEL_URL || 'https://vattentrygg.se/cancel';
const priceWhitelist = (process.env.ALLOWED_PRICE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isStripePriceId(s) {
  return typeof s === 'string' && /^price_[A-Za-z0-9]+$/.test(s);
}

function validateWhitelist(priceId) {
  return priceWhitelist.length === 0 || priceWhitelist.includes(priceId);
}

// Checkout handler function
async function handleCheckoutSession(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: 'Stripe not configured' });
    }

    const { items, priceId, quantity, customer_email, mode = 'payment', metadata } = req.body || {};

    let lineItems = [];
    if (Array.isArray(items) && items.length > 0) {
      lineItems = items.map((it, idx) => {
        if (it.price) {
          const candidate = String(it.price);
          if (!isStripePriceId(candidate)) {
            throw new Error(`Invalid price at index ${idx}: ${it.price}`);
          }
          if (!validateWhitelist(candidate)) {
            throw new Error(`Price not allowed by whitelist: ${candidate}`);
          }
          const qty = Number.isInteger(it.quantity) && it.quantity > 0 ? it.quantity : 1;
          return { price: candidate, quantity: qty };
        }
        throw new Error(`Item at index ${idx} must have 'price' field`);
      });
    } else if (priceId && Number.isInteger(quantity) && quantity > 0) {
      if (!isStripePriceId(String(priceId))) {
        throw new Error(`Invalid priceId: ${priceId}`);
      }
      if (!validateWhitelist(String(priceId))) {
        throw new Error(`Price not allowed by whitelist: ${priceId}`);
      }
      lineItems = [{ price: String(priceId), quantity }];
    } else {
      return res.status(400).json({ success: false, message: 'items[] or priceId+quantity required' });
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: lineItems,
      success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: CANCEL_URL,
      customer_email: customer_email || undefined,
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['SE', 'NO', 'DK', 'FI', 'DE'],
      },
      phone_number_collection: { enabled: true },
      metadata: { ...(metadata || {}), source: 'vattentrygg' },
    }, {
      idempotencyKey: req.headers['idempotency-key'] || `cs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    return res.json({ success: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('checkout error:', err);
    const msg = err.raw?.message || err.message || 'server error';
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 400;
    return res.status(status).json({ success: false, message: msg });
  }
}

app.post('/api/checkout/create-session', handleCheckoutSession);
app.post('/create-checkout-session', handleCheckoutSession);

// ----------------------------------------------------
// Healthcheck endpoints for Cloud Run
// ----------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'not set'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ============================================================
// Error Middleware - Catch all route errors
// ============================================================
app.use((err, req, res, next) => {
  console.error('Route error:', err);
  // Don't expose internal errors to clients
  res.status(err.status || 500).json({
    success: false,
    message: 'Server error occurred',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// ----------------------------------------------------
// Catch-all route för SPA-routing (EFTER alla API-routes)
// Returnerar index.html för alla GET-requests som inte matchar filer eller API-routes
// ----------------------------------------------------
app.get('*', (req, res) => {
  // Om requesten redan matchat en statisk fil (via express.static) kommer vi aldrig hit
  // Annars returnera index.html för SPA-routing
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

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
