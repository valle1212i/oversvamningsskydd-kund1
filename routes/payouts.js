// /routes/payouts.js  (Vattentrygg)
import { Router } from 'express';
import requireInternal from '../middleware/requireInternal.js';
import { listPayouts } from '../services/stripeService.js';

const router = Router();

// GET /api/payouts?starting_after=po_xxx
router.get('/', requireInternal, async (req, res, next) => {
  try {
    const { starting_after } = req.query;
    const tenant = req.get('X-Tenant'); // t.ex. 'vattentrygg'
    const page = await listPayouts(tenant, { starting_after, limit: 30 });
    res.json({ data: page.data, has_more: page.has_more });
  } catch (err) {
    next(err);
  }
});

export default router;   // <— viktigt
