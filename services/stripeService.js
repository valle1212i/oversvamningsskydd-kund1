// services/stripeService.js  (ESM)
import Stripe from 'stripe';

// Hämtar en hemlig nyckel för tenant (dagens läge: Vattentryggs egen)
function getDirectKeyForTenant(tenant) {
  const TEN = String(tenant || '').toUpperCase();
  const candidates = [
    `STRIPE_SECRET__${TEN}`,
    `STRIPE_API_KEY__${TEN}`,
    `STRIPE_PRIVATE_KEY__${TEN}`,
    'STRIPE_SECRET',
    'STRIPE_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_PRIVATE_KEY',
  ];
  for (const k of candidates) {
    const v = process.env[k];
    if (v) return v;
  }
  throw new Error(
    `Stripe key saknas för tenant=${tenant}. Ange någon av: ${candidates.join(', ')}`
  );
}

// Lista utbetalningar (payouts) med enkel cursor
export async function listPayouts(tenant, { starting_after, limit = 30 } = {}) {
  if (!tenant) throw new Error('Tenant saknas');
  const key = getDirectKeyForTenant(tenant);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  const params = { limit, ...(starting_after ? { starting_after } : {}) };
  return stripe.payouts.list(params);
}
