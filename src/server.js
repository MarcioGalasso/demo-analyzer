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
// 1 = mapa de calor. 0 = desliga (só se Free estourar RAM)
const FRAME_INTERVAL = Number(process.env.FRAME_INTERVAL_SEC ?? 1);
const MAX_FRAMES = Number(process.env.MAX_FRAMES || 2500);

const uploadDir = path.join(__dirname, '../tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Aceita "800", "800MB", etc. NaN → 800
const MAX_UPLOAD_MB = (() => {
  const raw = String(process.env.MAX_UPLOAD_MB || '800').replace(/[^\d]/g, '');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 50 ? n : 800;
})();
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});
console.log(`[boot] MAX_UPLOAD_MB=${MAX_UPLOAD_MB} FRAME_INTERVAL_SEC=${FRAME_INTERVAL}`);

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

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

function sendJsonError(res, status, error, detail) {
  if (res.headersSent) return;
  res.status(status).json({
    ok: false,
    error,
    detail: detail || undefined,
  });
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
    frames_enabled: FRAME_INTERVAL > 0,
    frame_interval_sec: FRAME_INTERVAL,
    max_upload_mb: MAX_UPLOAD_MB,
  });
});

app.post('/parse', auth, (req, res) => {
  upload.single('demo')(req, res, async (uploadErr) => {
    if (uploadErr) {
      const code = uploadErr.code || '';
      let msg = uploadErr.message || String(uploadErr);
      if (code === 'LIMIT_FILE_SIZE' || /too large/i.test(msg)) {
        msg =
          `Arquivo .dem maior que o limite do parser (${MAX_UPLOAD_MB} MB). ` +
          'Teste local com: node src/parse-cli.js sua-demo.dem — ou aumente MAX_UPLOAD_MB no Render.';
      }
      console.error('[parse] upload fail', code, msg);
      return sendJsonError(res, 400, 'Falha no upload do .dem: ' + msg, code);
    }
    if (!req.file) {
      return sendJsonError(res, 400, 'Envie o arquivo .dem no campo "demo"');
    }
    if (parsing) {
      return sendJsonError(res, 429, 'Parser ocupado. Aguarde 1–2 min e tente de novo.');
    }

    const tmpPath = req.file.path;
    const finalPath = tmpPath + '.dem';
    parsing = true;
    const t0 = Date.now();

    try {
      res.setTimeout(0);
      req.setTimeout(0);
    } catch (_) {}

    try {
      fs.renameSync(tmpPath, finalPath);
      const sizeMb = (req.file.size / 1024 / 1024).toFixed(1);
      console.log(
        `[parse] start "${req.file.originalname}" (${sizeMb} MB) ` +
          `frames=${FRAME_INTERVAL > 0 ? FRAME_INTERVAL + 's' : 'off'} node=${process.version}`
      );

      const data = await parseDemoFile(finalPath, {
        frameIntervalSec: FRAME_INTERVAL,
        maxFrames: MAX_FRAMES,
      });

      const ms = Date.now() - t0;
      const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
      console.log(
        `[parse] ok mapa=${data.mapa} kills=${data.total_kills} ` +
          `frames=${data.frames.length} em ${ms}ms rss=${rss}MB`
      );

      return res.json({ ok: true, data });
    } catch (err) {
      console.error('[parse] fail', err);
      const msg = err && err.message ? err.message : String(err);
      let hint = msg;
      if (/out of memory|heap|ENOMEM|JavaScript heap/i.test(msg)) {
        hint =
          'Memória esgotada no Render Free. Mantenha FRAME_INTERVAL_SEC=0 ou suba o plano.';
      }
      return sendJsonError(res, 500, hint, msg);
    } finally {
      parsing = false;
      try {
        fs.unlinkSync(finalPath);
      } catch (_) {}
      try {
        fs.unlinkSync(tmpPath);
      } catch (_) {}
    }
  });
});

// Sempre JSON em erros do Express (evita HTML "Internal Server Error")
app.use((err, _req, res, _next) => {
  console.error('[express]', err);
  sendJsonError(res, 500, err.message || 'Internal Server Error');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `MouseTrap Demo Analyzer em 0.0.0.0:${PORT} (node ${process.version}) ` +
      `frames=${FRAME_INTERVAL > 0 ? FRAME_INTERVAL + 's' : 'OFF'}`
  );
});
