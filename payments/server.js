// payments/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import getRawBody from 'raw-body';

const app = express();

/* ---- CORS ---- */
const ALLOWED = new Set([
  'https://oversvamningsskydd-kund1.onrender.com', // statiska siten
  'http://localhost:5500',
  process.env.FRONTEND_ORIGIN
].filter(Boolean));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  }
}));

/* ---- Stripe ---- */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

/* ---- Whitelist för Price IDs (valfritt) ---- */
const priceWhitelist = (process.env.ALLOWED_PRICE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isAllowedPrice(priceId) {
  if (priceWhitelist.length === 0) return true;   // tillåt allt i tidig test
  return priceWhitelist.includes(priceId);
}

/* ---- Gemensam handler för checkout ---- */
const createCheckoutHandler = async (req, res) => {
  try {
    // Tillåt två format på payload:
    // 1) { items: [{ price: 'price_x', quantity: 1 }], customer_email }
    // 2) { priceId: 'price_x', quantity: 1, customer_email }
    let { items, priceId, quantity, customer_email } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      if (priceId && Number.isInteger(quantity) && quantity > 0) {
        items = [{ price: priceId, quantity }];
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items required' });
    }

    for (const it of items) {
      if (!it.price || !isAllowedPrice(it.price)) {
        return res.status(400).json({ success: false, message: 'invalid price id' });
      }
      if (!Number.isInteger(it.quantity) || it.quantity < 1) {
        return res.status(400).json({ success: false, message: 'invalid quantity' });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: items.map(i => ({ price: i.price, quantity: i.quantity })),
      success_url: process.env.SUCCESS_URL,
      cancel_url: process.env.CANCEL_URL,
      customer_email: customer_email || undefined,
      metadata: { source: 'vattentrygg' }
    }, {
      idempotencyKey: `cs_${Date.now()}_${Math.random().toString(36).slice(2)}`
    });

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('create-session error:', err);
    return res.status(500).json({ success: false, message: 'server error' });
  }
};

// Mounta alias-routes (båda fungerar)
app.post('/api/checkout/create-session', express.json(), createCheckoutHandler);
app.post('/checkout/create-session',     express.json(), createCheckoutHandler);

/* ---- Webhook (rå body) ---- */
app.post('/api/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) return res.status(500).send('Webhook secret not set');

  let event;
  try {
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send('Signature verification failed');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('✅ checkout.session.completed', session.id, session.mode);
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        console.log('✅ payment_intent.succeeded', pi.id, pi.amount);
        break;
      }
      default:
        console.log('Unhandled event:', event.type);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Webhook handler error');
  }
});

/* ---- Health ---- */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => console.log('Payments API listening on', PORT));
