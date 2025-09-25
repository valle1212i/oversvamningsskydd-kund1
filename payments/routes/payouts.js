// payments/routes/payouts.js
import { Router } from 'express';
import requireInternal from '../middleware/requireInternal.js';

// Fabrik som tar in { stripe } från payments/server.js
export default function makePayoutsRouter({ stripe }) {
  const router = Router();

  // GET /api/payouts?starting_after=po_xxx
  router.get('/', requireInternal, async (req, res) => {
    try {
      const { starting_after } = req.query;
      const tenant = req.get('X-Tenant') || 'vattentrygg'; // sparas ev. för Connect i framtiden

      const params = { limit: 30 };
      if (starting_after) params.starting_after = starting_after;

      const page = await stripe.payouts.list(params);
      return res.json({ data: page.data, has_more: page.has_more, tenant });
    } catch (err) {
      console.error('GET /api/payouts error:', {
        msg: err?.message, code: err?.code, type: err?.type, statusCode: err?.statusCode
      });
      return res
        .status(err?.statusCode || 500)
        .json({ success: false, message: err?.message || 'server error' });
    }
  });

  // GET /api/payouts/:id → hämta en payout
  router.get('/:id', requireInternal, async (req, res) => {
    try {
      const { id } = req.params; // po_...
      const payout = await stripe.payouts.retrieve(id);
      return res.json({ payout });
    } catch (err) {
      console.error('GET /api/payouts/:id error:', {
        msg: err?.message, code: err?.code, type: err?.type, statusCode: err?.statusCode
      });
      return res
        .status(err?.statusCode || 500)
        .json({ success:false, message: err?.message || 'server error' });
    }
  });

  // GET /api/payouts/:id/transactions → balance transactions för utbetalningen
  router.get('/:id/transactions', requireInternal, async (req, res) => {
    try {
      const { id } = req.params; // po_...
      const { starting_after, limit } = req.query;

      const params = { payout: id, limit: Number(limit) || 100 };
      if (starting_after) params.starting_after = starting_after;

      const page = await stripe.balanceTransactions.list(params);
      return res.json({ data: page.data, has_more: page.has_more });
    } catch (err) {
      console.error('GET /api/payouts/:id/transactions error:', {
        msg: err?.message, code: err?.code, type: err?.type, statusCode: err?.statusCode
      });
      return res
        .status(err?.statusCode || 500)
        .json({ success:false, message: err?.message || 'server error' });
    }
  });

  return router;
}
