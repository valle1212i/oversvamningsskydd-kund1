// payments/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import getRawBody from "raw-body";
import makePayoutsRouter from "./routes/payouts.js";
// --- MongoDB ---
import { MongoClient, ServerApiVersion } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGO_DB = process.env.MONGO_DB || "kundportal";
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || "payments";

let mongoClient;
let paymentsCol;

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
  });

  await mongoClient.connect();
  const db = mongoClient.db(MONGO_DB);
  paymentsCol = db.collection(MONGO_COLLECTION);

  await paymentsCol.createIndex({ sessionId: 1 }, { unique: true });
  await paymentsCol.createIndex({ customer_email: 1, stripe_created: -1 });

  console.log(`✅ MongoDB ansluten: db=${MONGO_DB}, col=${MONGO_COLLECTION}`);
}

initMongo().catch((err) => {
  console.error("❌ Mongo init error:", err);
});

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
  "https://vattentrygg.se",
  "https://www.vattentrygg.se",
  "http://localhost:5500",
  "https://source-database.onrender.com",
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || ALLOWED.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-csrf-token", "authorization", "x-requested-with", "X-Internal-Auth", "X-Tenant"],
  optionsSuccessStatus: 204,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

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
    const key = process.env.STRIPE_SECRET_KEY || "";
    if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
    if (!key.startsWith("sk_live_") && process.env.NODE_ENV === "production") {
      throw new Error("Using a non-live STRIPE_SECRET_KEY in production");
    }
    if (!isHttpsUrl(SUCCESS_URL) || !isHttpsUrl(CANCEL_URL)) {
      throw new Error("SUCCESS_URL and CANCEL_URL must be valid HTTPS URLs");
    }

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

    const line_items = items.map((it, idx) => {
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
      if (
        it.price_data &&
        typeof it.price_data.currency === "string" &&
        Number.isInteger(it.price_data.unit_amount)
      ) {
        const qty = Number.isInteger(it.quantity) && it.quantity > 0 ? it.quantity : 1;
        return {
          price_data: {
            currency: it.price_data.currency,
            unit_amount: it.price_data.unit_amount,
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
        success_url: `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: CANCEL_URL,
        customer_email: customer_email || undefined,

        // ⭐ Adressinsamling
        billing_address_collection: "required",
        shipping_address_collection: {
          allowed_countries: ["SE", "NO", "DK", "FI", "DE"],
        },
         // 📞 Aktivera telefon-fält
    phone_number_collection: { enabled: true },

        metadata: { ...(metadata || {}), source: "oversvamningsskydd" },
      },
      {
        idempotencyKey:
          req.headers["idempotency-key"] ||
          `cs_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      }
    );

    return res.json({ success: true, url: session.url, id: session.id });
  } catch (err) {
    console.error("create-session error:", {
      message: err.message,
      code: err.code,
      type: err.type,
      raw: err.raw?.message,
      param: err.raw?.param,
      stack: err.stack,
    });
    const msg = err.raw?.message || err.message || "server error";
    const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 400;
    return res.status(status).json({ success: false, message: msg });
  }
}

/* ----------- Routes ----------- */

// Webhook
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

  // --- Hjälpare för adresser ---
  function pickAddress(a) {
    if (!a) return null;
    return {
      line1: a.line1 ?? null,
      line2: a.line2 ?? null,
      postal_code: a.postal_code ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      country: a.country ?? null,
    };
  }

  function pickBillingDetails(bd) {
    if (!bd) return null;
    return {
      name: bd.name ?? null,
      email: bd.email ?? null,
      phone: bd.phone ?? null,
      address: pickAddress(bd.address),
    };
  }

  async function upsertPaymentFromSession(session) {
    try {
      if (!paymentsCol) return;

      const full = await stripe.checkout.sessions.retrieve(session.id, {
        expand: [
          "line_items.data.price.product",
          "payment_intent",
          "payment_intent.latest_charge",
        ],
      });

      const pi =
        full.payment_intent && typeof full.payment_intent === "object"
          ? full.payment_intent
          : null;

      let pmDetails = null;
      let billingFromCharge = null;

      try {
        const chargeObj =
          pi?.latest_charge && typeof pi.latest_charge === "object"
            ? pi.latest_charge
            : null;

        if (chargeObj?.payment_method_details?.card) {
          const c = chargeObj.payment_method_details.card;
          pmDetails = {
            brand: c.brand || null,
            last4: c.last4 || null,
            exp_month: c.exp_month || null,
            exp_year: c.exp_year || null,
            funding: c.funding || null,
            country: c.country || null,
          };
        }

        if (chargeObj?.billing_details) {
          billingFromCharge = pickBillingDetails(chargeObj.billing_details);
        }
      } catch (e) {
        console.warn("Could not read latest_charge:", e.message);
      }

      const shippingFromSession = full.shipping_details
        ? {
            name: full.shipping_details.name ?? null,
            phone: full.shipping_details.phone ?? null,
            address: pickAddress(full.shipping_details.address),
          }
        : null;

      const billingFromSession = full.customer_details
        ? {
            name: full.customer_details.name ?? null,
            email: full.customer_details.email ?? full.customer_email ?? null,
            phone: full.customer_details.phone ?? null,
            address: pickAddress(full.customer_details.address),
          }
        : null;

      const finalBilling = billingFromCharge || billingFromSession || null;
      const finalShipping = shippingFromSession;

      const doc = {
        sessionId: full.id,
        status: full.status,
        mode: full.mode,
        amount_total: full.amount_total,
        currency: full.currency,
        customer_email: full.customer_details?.email || full.customer_email || null,
        created: new Date((full.created || Math.floor(Date.now() / 1000)) * 1000),
        stripe_created: full.created || null,

        payment_intent_id: pi?.id || null,
        payment_status: full.payment_status || pi?.status || null,
        charge_id: pi?.latest_charge || null,

        payment_method_details: pmDetails,

        // ⭐ NYTT: Adresser
        customer_details: full.customer_details || null,
        billing_details: finalBilling,
        shipping_details: finalShipping,

        metadata: full.metadata || {},
        line_items: (full.line_items?.data || []).map((li) => ({
          quantity: li.quantity,
          amount_subtotal: li.amount_subtotal,
          amount_total: li.amount_total,
          currency: li.currency,
          price_id: li.price?.id || null,
          product_id: li.price?.product || null,
          product_name:
            li.price?.product?.name || li.description || li.price?.nickname || null,
        })),

        source: "oversvamningsskydd",
        merchant: { email: "edward@vattentrygg.se", name: "Vattentrygg" },

        updatedAt: new Date(),
      };

      await paymentsCol.updateOne(
        { sessionId: doc.sessionId },
        { $set: doc, $setOnInsert: { insertedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.error("Mongo upsert error:", e);
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        await upsertPaymentFromSession(session);
        console.log("✅ Saved checkout.session.completed", session.id);
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        try {
          const sessions = await stripe.checkout.sessions.list({
            payment_intent: pi.id,
            limit: 1,
          });
          if (sessions.data[0]) {
            await upsertPaymentFromSession(sessions.data[0]);
            console.log("✅ Updated from PI", pi.id);
          }
        } catch (e) {
          console.warn("PI->Session lookup failed:", e.message);
        }
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

app.use(express.json());
app.use("/api/payouts", makePayoutsRouter({ stripe }));
// === Hämta en betalning ===
app.get("/api/payments/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: "sessionId krävs" });
    }

    if (!paymentsCol) {
      return res.status(500).json({ success: false, message: "Databas ej initierad" });
    }

    const payment = await paymentsCol.findOne({ sessionId });
    if (!payment) {
      return res.status(404).json({ success: false, message: "Betalning ej hittad" });
    }

    return res.json({ success: true, payment });
  } catch (err) {
    console.error("GET /api/payments/:sessionId error:", err);
    return res.status(500).json({ success: false, message: "Serverfel" });
  }
});

// === Refund endpoint ===
app.post("/api/payments/refund", async (req, res) => {
  try {
    const { sessionId, amount, reason } = req.body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ success: false, message: "sessionId krävs" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.latest_charge"],
    });

    const pi =
      session.payment_intent && typeof session.payment_intent === "object"
        ? session.payment_intent
        : null;

    const chargeId =
      typeof pi?.latest_charge === "string"
        ? pi.latest_charge
        : (pi?.latest_charge?.id || null);

    if (!chargeId) {
      return res.status(400).json({ success: false, message: "Ingen charge kopplad" });
    }

    const fullAmount =
      (typeof pi?.amount_received === "number" && pi.amount_received > 0)
        ? pi.amount_received
        : (session.amount_total || 0);

    const amountToRefund = Number.isInteger(amount) && amount > 0 ? amount : fullAmount;

    const refund = await stripe.refunds.create({
      charge: chargeId,
      amount: amountToRefund,
      reason: reason || "requested_by_customer",
      metadata: { source: "kundportal" }
    });

    if (paymentsCol) {
      await paymentsCol.updateOne(
        { sessionId },
        {
          $set: {
            updatedAt: new Date(),
            refund_last_id: refund.id,
            refund_last_status: refund.status
          },
          $push: {
            refunds: {
              id: refund.id,
              status: refund.status,
              amount: refund.amount,
              created: new Date(refund.created * 1000),
              charge: refund.charge,
              reason: refund.reason || null
            }
          },
          $inc: { refunded_amount: refund.amount }
        }
      );

      const doc = await paymentsCol.findOne({ sessionId });
      if (doc) {
        const targetTotal = doc.amount_total || fullAmount;
        const refundedSoFar = doc.refunded_amount || 0;
        if (Number.isFinite(targetTotal) && refundedSoFar >= targetTotal) {
          await paymentsCol.updateOne({ sessionId }, { $set: { status: "refunded" } });
        }
      }
    }

    return res.json({ success: true, refund });
  } catch (err) {
    console.error("POST /api/payments/refund error:", {
      message: err?.message,
      code: err?.code,
      type: err?.type,
      raw: err?.raw?.message
    });
    const msg = err?.raw?.message || err?.message || "refund error";
    return res.status(400).json({ success: false, message: msg });
  }  
});

// Checkout routes
app.post("/api/checkout/create-session", handleCreateSession);
app.post("/create-checkout-session", handleCreateSession);

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ----------- Server ----------- */
const PORT = process.env.PORT || 8081;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Payments API listening on ${PORT}`);
});
// TEMP: diagnostik – hjälper oss att se varför requireInternal 401:ar
app.get('/_diag/internal', (req, res) => {
  const provided = req.get('X-Internal-Auth') || null;
  const hasSecret = Boolean(process.env.X_PAYMENTS_SECRET);
  const providedLen = provided ? provided.length : 0;
  const match = hasSecret && provided && (provided === process.env.X_PAYMENTS_SECRET);
  return res.json({ hasSecret, providedLen, match });
});
