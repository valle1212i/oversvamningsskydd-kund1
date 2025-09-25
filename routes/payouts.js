const router = require('express').Router();
const requireInternal = require('../middleware/requireInternal');
const { listPayouts } = require('../services/stripeService'); 

router.get('/', requireInternal, async (req, res, next) => {
  try {
    const { starting_after } = req.query;
    const tenant = req.get('X-Tenant'); // t.ex. 'vattentrygg'
    const page = await listPayouts(tenant, { starting_after, limit: 30 });
    res.json({ data: page.data, has_more: page.has_more });
  } catch (e) { next(e); }
});

module.exports = router;
