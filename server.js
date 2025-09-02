// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';

import products from './data/products.json' assert { type: 'json' };
import faq from './data/faq.json' assert { type: 'json' };

const app = express();
app.use(express.json());

/* -----------------------------
   CORS (tillåt din frontend + lokalt)
-------------------------------- */
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5500',                             // Live Server (lokalt)
  'https://oversvamningsskydd-kund1.onrender.com',    // din statiska Render-sajt
  // 'https://www.dindomän.se',                        // ev. egen domän
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
   API
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/', (_req, res) =>
  res.status(200).send('Aurora backend up. Use POST /api/aurora/ask')
);

/* -----------------------------
   Start
-------------------------------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Aurora API listening on', PORT));
