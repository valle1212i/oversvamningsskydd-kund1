import { Router } from 'express';
import requireInternal from '../middleware/requireInternal.js';

// OBS: Vi återanvänder Stripe-klienten som redan finns i payments/server.js.
// Därför exporterar vi en fabrik som tar in { stripe } från servern.
export default function makePayoutsRouter({ stripe }) {
  const router = Router();

  // GET /api/payouts?starting_after=po_xxx
  router.get('/', requireInternal, async (req, res) => {
    try {
      const { starting_after } = req.query;
      // Tenant-headen kan du spara för framtiden (Connect/multi-tenant).
      const tenant = req.get('X-Tenant') || 'vattentrygg';

      const params = { limit: 30 };
      if (starting_after) params.starting_after = starting_after;

      const page = await stripe.payouts.list(params);
      return res.json({ data: page.data, has_more: page.has_more, tenant });
    } catch (err) {
      console.error('GET /api/payouts error:', {
        msg: err?.message, code: err?.code, type: err?.type, statusCode: err?.statusCode
      });
      return res.status(err?.statusCode || 500).json({ success: false, message: err?.message || 'server error' });
    }
  });

  return router;
}
