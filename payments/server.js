// payments/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import getRawBody from "raw-body";

const app = express();

/* ---------------- CORS ---------------- */
const ALLOWED = [
  "https://oversvamningsskydd-kund1.onrender.com",
  "http://localhost:5500",
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // tillåt även curl/servrar utan origin
      if (!origin || ALLOWED.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: false,
  })
);

// preflight (för säkerhets skull)
app.options("*", (_req, res) => res.sendStatus(204));

/* --------------- Stripe klient --------------- */
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ Missing STRIPE_SECRET_KEY");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

/* ----------- Hjälpare & config ---------- */

// (valfritt) tillåt bara vissa price-id via env ALLOWED_PRICE_IDS="price_x,price_y"
const priceWhitelist = (process.env.ALLOWED_PRICE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isStripePriceId(s) {
  return typeof s === "string" && /^price_[A-Za-z0-9]+$/.test(s);
}
function validateWhitelist(priceId) {
  if (priceWhitelist.length === 0) return true;
  return priceWhitelist.includes(priceId);
}

/* ----------- Checkout Handler ----------- */
async function handleCreateSession(req, res) {
  try {
    if (!process.env.SUCCESS_URL || !process.env.CANCEL_URL) {
      const msg = "Missing SUCCESS_URL/CANCEL_URL envs";
      if (process.env.NODE_ENV === "production") {
        return res.status(500).json({ success: false, message: "server error" });
      }
      return res.status(500).json({ success: false, message: msg });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      const msg = "Missing STRIPE_SECRET_KEY";
      if (process.env.NODE_ENV === "production") {
        return res.status(500).json({ success: false, message: "server error" });
      }
      return res.status(500).json({ success: false, message: msg });
    }

    // Tillåt två format:
    // A) { items:[{ price:"price_...", quantity:1 }], customer_email }
    // B) { priceId:"price_...", quantity:1, customer_email }
    let { items, priceId, quantity, customer_email, mode = "payment", metadata } =
      req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      if (priceId && Number.isInteger(quantity) && quantity > 0) {
        items = [{ price: priceId, quantity }];
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items[] required" });
    }

    // Normalisera till Stripe line_items – acceptera price eller price_data
    const line_items = items.map((it, idx) => {
      // 1) price string
      if (it.price) {
        const candidate = it.price;
        if (!isStripePriceId(candidate)) {
          throw new Error(`Invalid price at index ${idx}: ${it.price}`);
        }
        if (!validateWhitelist(candidate)) {
          throw new Error(`Price not allowed by whitelist: ${candidate}`);
        }
        const qty = Number.isInteger(it.quantity) && it.quantity > 0 ? it.quantity : 1;
        return { price: candidate, quantity: qty };
      }
      // 2) price_data object (on-the-fly)
      if (
        it.price_data &&
        typeof it.price_data.currency === "string" &&
        Number.isInteger(it.price_data.unit_amount)
      ) {
        const qty = Number.isInteger(it.quantity) && it.quantity > 0 ? it.quantity : 1;
        return {
          price_data: {
            currency: it.price_data.currency,
            unit_amount: it.price_data.unit_amount, // öre
            product_data: it.price_data.product_data ?? { name: "Item" },
          },
          quantity: qty,
        };
      }
      throw new Error(
        `Item at index ${idx} must have either 'price' (Stripe price id) or 'price_data'`
      );
    });

    const session = await stripe.checkout.sessions.create(
      {
        mode,
        line_items,
        success_url: process.env.SUCCESS_URL,
        cancel_url: process.env.CANCEL_URL,
        customer_email: customer_email || undefined,
        metadata: {
          ...(metadata || {}),
          source: "oversvamningsskydd",
        },
      },
      {
        // enkel idempotency, räcker för test
        idempotencyKey: `cs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      }
    );

    return res.json({ success: true, id: session.id, url: session.url });
  } catch (err) {
    console.error("create-session error:", err);
    const payload =
      process.env.NODE_ENV === "production"
        ? { success: false, message: "server error" }
        : {
            success: false,
            message: err.message,
            code: err.code,
            type: err.type,
          };
    return res.status(400).json(payload);
  }
}

/* ----------- Routes ----------- */

// Webhook (måste läsa rå body; ingen express.json här)
app.post("/api/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!whSecret) return res.status(500).send("Webhook secret not set");

  let event;
  try {
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, whSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send("Signature verification failed");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ checkout.session.completed", session.id, session.mode);
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        console.log("✅ payment_intent.succeeded", pi.id, pi.amount);
        break;
      }
      default:
        console.log("Unhandled event:", event.type);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).send("Webhook handler error");
  }
});

// JSON body parser för alla övriga endpoints
app.use(express.json());

// Checkout – primär route
app.post("/api/checkout/create-session", handleCreateSession);

// Alias som matchar din frontend (OBS: *utan* /checkout i vägen)
app.post("/create-checkout-session", handleCreateSession);

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ----------- Server ----------- */
const PORT = process.env.PORT || 8081;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Payments API listening on ${PORT}`);
});
