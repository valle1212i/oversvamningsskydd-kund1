// server/i18n-router.js
import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// vilka språk som stöds
const locales = new Set(['sv', 'en', 'da', 'no']);

router.get('/:locale', async (req, res) => {
  try {
    const { locale } = req.params;

    if (!locales.has(locale)) {
      return res.status(404).json({ error: 'Unknown locale' });
    }

    const filePath = join(__dirname, '..', 'i18n', `strings.${locale}.json`);
    const raw = await readFile(filePath, 'utf8');
    const json = JSON.parse(raw);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // cache i 1 timme
    res.json(json);
  } catch (err) {
    console.error('i18n-router error:', err);
    res.status(500).json({ error: 'Failed to load translations' });
  }
});

export default router;
