// payments/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import getRawBody from "raw-body";
// --- MongoDB (NYTT) ---
import { MongoClient, ServerApiVersion } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGO_DB = process.env.MONGO_DB || "kundportal";
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || "payments";

let mongoClient;
let paymentsCol; // används senare i webhook + API

async function initMongo() {
  if (!MONGODB_URI) {
    console.warn("⚠️ Ingen MONGODB_URI satt; betalningar sparas inte i MongoDB.");
    return;
  }

  mongoClient = new MongoClient(MONGODB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    // valfria timeouts
    // connectTimeoutMS: 15000,
    // serverSelectionTimeoutMS: 15000,
  });

  await mongoClient.connect();
  const db = mongoClient.db(MONGO_DB);
  paymentsCol = db.collection(MONGO_COLLECTION);

  // Index (bra för sökning och unik sessionId)
  await paymentsCol.createIndex({ sessionId: 1 }, { unique: true });
  await paymentsCol.createIndex({ customer_email: 1, stripe_created: -1 });

  console.log(`✅ MongoDB ansluten: db=${MONGO_DB}, col=${MONGO_COLLECTION}`);
}

initMongo().catch((err) => {
  console.error("❌ Mongo init error:", err);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  try { await mongoClient?.close(); } catch {}
  process.exit(0);
});
process.on("SIGTERM", async () => {
  try { await mongoClient?.close(); } catch {}
  process.exit(0);
});


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
      // tillåt även curl/servrar utan Origin
      if (!origin || ALLOWED.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: false,
  })
);

// Preflight
app.options("*", (_req, res) => res.sendStatus(204));

/* --------------- Stripe klient --------------- */
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ Missing STRIPE_SECRET_KEY");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

/* ----------- Hjälpare & config ---------- */
const SUCCESS_URL = process.env.SUCCESS_URL || "";
const CANCEL_URL = process.env.CANCEL_URL || "";

// (valfritt) tillåt bara vissa price-id via env ALLOWED_PRICE_IDS="price_x,price_y"
const priceWhitelist = (process.env.ALLOWED_PRICE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isStripePriceId = (s) =>
  typeof s === "string" && /^price_[A-Za-z0-9]+$/.test(s);

const validateWhitelist = (priceId) =>
  priceWhitelist.length === 0 || priceWhitelist.includes(priceId);

const isHttpsUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:";
  } catch {
    return false;
  }
};

/* ----------- Checkout Handler ----------- */
async function handleCreateSession(req, res) {
  try {
    // 0) Env-validering
    const key = process.env.STRIPE_SECRET_KEY || "";
    if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
    if (!key.startsWith("sk_live_") && process.env.NODE_ENV === "production") {
      throw new Error("Using a non-live STRIPE_SECRET_KEY in production");
    }
    if (!isHttpsUrl(SUCCESS_URL) || !isHttpsUrl(CANCEL_URL)) {
      throw new Error("SUCCESS_URL and CANCEL_URL must be valid HTTPS URLs");
    }

    // 1) Body – tillåt två format
    let {
      items,
      priceId,
      quantity,
      customer_email,
      mode = "payment",
      metadata,
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      if (priceId && Number.isInteger(quantity) && quantity > 0) {
        items = [{ price: priceId, quantity }];
      }
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items[] required" });
    }

    // 2) Normalisera line_items
    const line_items = items.map((it, idx) => {
      // a) Referens till befintligt pris
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
      // b) price_data on-the-fly
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

    // 3) Skapa session
    const session = await stripe.checkout.sessions.create(
      {
        mode,
        line_items,
        // Lägg till session-id i success-url för ev. uppföljning
        success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: CANCEL_URL,
        customer_email: customer_email || undefined,
        metadata: { ...(metadata || {}), source: "oversvamningsskydd" },
      },
      {
        // Enkel idempotency – låt client skicka egen om du vill
        idempotencyKey:
          req.headers["idempotency-key"] ||
          `cs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      }
    );

    return res.json({ success: true, url: session.url, id: session.id });
  } catch (err) {
    // Logga Stripe-detaljer tydligt
    console.error("create-session error:", {
      message: err.message,
      code: err.code,
      type: err.type,
      raw: err.raw?.message,
      param: err.raw?.param,
      stack: err.stack,
    });

    // Skicka begripligt fel till frontend (utan känsliga detaljer)
    const msg = err.raw?.message || err.message || "server error";
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 400;
    return res.status(status).json({ success: false, message: msg });
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

// JSON body parser för alla övriga endpoints (efter webhook!)
app.use(express.json());

// Checkout – primär route
app.post("/api/checkout/create-session", handleCreateSession);

// Alias som matchar din frontend
app.post("/create-checkout-session", handleCreateSession);

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ----------- Server ----------- */
const PORT = process.env.PORT || 8081;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Payments API listening on ${PORT}`);
});
