// ESM
export default function requireInternal(req, res, next) {
    const expected = process.env.X_PAYMENTS_SECRET;
    if (!expected) {
      return res.status(500).json({ success: false, message: 'X_PAYMENTS_SECRET saknas i env' });
    }
    if (req.get('X-Internal-Auth') !== expected) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    next();
  }
  