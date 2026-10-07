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
const FRAME_INTERVAL = Number(process.env.FRAME_INTERVAL_SEC || 1);

const uploadDir = path.join(__dirname, '../tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
});

// Evita o Node derrubar o processo em rejeição não tratada durante parse pesado
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

// CORS: admin (Locaweb) sobe o .dem direto no browser → Render
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed =
    !origin ||
    /mousetrap\.com\.br$/i.test(origin) ||
    /websiteseguro\.com$/i.test(origin) ||
    /localhost/i.test(origin) ||
    /127\.0\.0\.1/i.test(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Demo-Secret');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

function auth(req, res, next) {
  const key = req.headers['x-demo-secret'] || req.query.secret;
  if (key !== SECRET) {
    return res.status(401).json({ error: 'Secret inválido' });
  }
  next();
}

let parsing = false;
const startedAt = Date.now();

app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: 'mousetrap-demo-analyzer',
    node: process.version,
    uptime_sec: Math.round((Date.now() - startedAt) / 1000),
    parsing,
    memory_mb: Math.round(mem.rss / 1024 / 1024),
  });
});

app.post('/parse', auth, upload.single('demo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Envie o arquivo .dem no campo "demo"' });
  }

  if (parsing) {
    return res.status(429).json({
      error: 'Parser ocupado com outra demo. Aguarde 1–2 min e tente de novo.',
    });
  }

  const tmpPath = req.file.path;
  const finalPath = tmpPath + '.dem';
  parsing = true;
  const t0 = Date.now();

  // Render free pode matar requests longas — avisa o cliente para não desistir cedo
  res.setTimeout(0);
  req.setTimeout(0);

  try {
    fs.renameSync(tmpPath, finalPath);
    const sizeMb = (req.file.size / 1024 / 1024).toFixed(1);
    console.log(`[parse] start "${req.file.originalname}" (${sizeMb} MB) node=${process.version}`);

    const data = await parseDemoFile(finalPath, { frameIntervalSec: FRAME_INTERVAL });
    const ms = Date.now() - t0;
    console.log(
      `[parse] ok mapa=${data.mapa} kills=${data.total_kills} frames=${data.frames?.length || 0} ` +
        `nades=${data.grenades?.length || 0} em ${ms}ms rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`
    );

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[parse] fail', err);
    const msg = err && err.message ? err.message : String(err);
    // Mensagem mais útil quando for OOM / Node antigo
    let hint = msg;
    if (/out of memory|heap|ENOMEM/i.test(msg)) {
      hint = 'Memória esgotada no servidor do parser. Tente de novo ou use plano com mais RAM.';
    } else if (/Cannot find module|ERR_REQUIRE_ESM|Unexpected token/i.test(msg)) {
      hint = 'Runtime do parser incompatível. Redeploy com Node 22+ (veja Dockerfile).';
    }
    res.status(500).json({ error: hint, detail: msg });
  } finally {
    parsing = false;
    try { fs.unlinkSync(finalPath); } catch (_) {}
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MouseTrap Demo Analyzer em 0.0.0.0:${PORT} (node ${process.version})`);
  if (!process.version.startsWith('v22') && !process.version.startsWith('v23') && !process.version.startsWith('v24')) {
    console.warn('[warn] cs2parser exige Node >= 22. Versão atual:', process.version);
  }
});
