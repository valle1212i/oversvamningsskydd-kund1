import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';

const app = express();
app.use(express.json());

// Lock CORS to your static site’s domain on Render (and your local dev)
const allowed = [
  'http://localhost:5500',                         // Live Server (local)
  'https://<your-static-site>.onrender.com',       // your Render static site
  'https://www.<your-domain>.se'                   // your custom domain (if any)
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: false
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Simple knowledge base (MVP) ---
 import products from './data/products.json' with { type: 'json' };
import faq from './data/faq.json' with { type: 'json' };

// Helper to build a compact context string
function buildContext() {
  const bullets = [
    'You are Aurora, an expert assistant for flood protection in Sweden.',
    'Answer in Swedish by default. Keep answers clear and concise.',
    'If a question involves safety or installation, give practical steps and when to contact a professional.',
    'If you do not know, say so and suggest contacting support.'
  ];
  const prodLines = products.map(p =>
    `• ${p.name}: ${p.type}, användning: ${p.use}, kapacitet: ${p.specs}, passar: ${p.suits}, artikel/id: ${p.sku}`
  ).join('\n');

  const faqLines = faq.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');

  return `${bullets.join('\n')}

FÖRETAGS-/PRODUKTINFO:
${prodLines}

FAQ & RIKTLINJER:
${faqLines}
`;
}

// POST /api/aurora/ask  { question, history? }
app.post('/api/aurora/ask', async (req, res) => {
  try {
    const { question, history = [] } = req.body || {};
    if (!question) return res.status(400).json({ success: false, message: 'question required' });

    const system = buildContext();

    // Build messages (keep small history for context)
    const messages = [
      { role: 'system', content: system },
      ...history.slice(-6),
      { role: 'user', content: question }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // good quality+cost balance
      temperature: 0.3,
      messages
    });

    const answer = completion.choices[0]?.message?.content?.trim() || 'Tyvärr, jag saknar ett svar just nu.';
    res.json({ success: true, answer });
  } catch (err) {
    console.error('aurora error:', err);
    res.status(500).json({ success: false, message: 'server error' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Aurora API listening on', PORT));
