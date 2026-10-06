'use strict';

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parseDemoFile } = require('./parse-demo');

const app = express();
const PORT = Number(process.env.PORT || 5055);
const SECRET = process.env.DEMO_ANALYZER_SECRET || 'mousetrap-demo-secret';

const uploadDir = path.join(__dirname, '../tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
});

function auth(req, res, next) {
  const key = req.headers['x-demo-secret'] || req.query.secret;
  if (key !== SECRET) {
    return res.status(401).json({ error: 'Secret inválido' });
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mousetrap-demo-analyzer' });
});

app.post('/parse', auth, upload.single('demo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Envie o arquivo .dem no campo "demo"' });
  }

  const tmpPath = req.file.path;
  const finalPath = tmpPath + '.dem';
  try {
    fs.renameSync(tmpPath, finalPath);
    console.log('Parseando', req.file.originalname, '...');
    const data = await parseDemoFile(finalPath);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    try { fs.unlinkSync(finalPath); } catch (_) {}
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MouseTrap Demo Analyzer ouvindo em 0.0.0.0:${PORT}`);
});
