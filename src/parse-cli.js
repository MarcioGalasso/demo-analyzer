'use strict';

/**
 * Teste LOCAL do parser (sem Render).
 *
 * Uso:
 *   cd demo-analyzer
 *   npm install
 *   node src/parse-cli.js "C:\caminho\analise2.dem"
 *
 * Opcional — coletar frames (pesado):
 *   set FRAME_INTERVAL_SEC=2
 *   node src/parse-cli.js analise2.dem
 */
const path = require('path');
const fs = require('fs');
const { parseDemoFile } = require('./parse-demo');

async function main() {
  const demoPath = process.argv[2];
  if (!demoPath) {
    console.error('Uso: node src/parse-cli.js caminho/para/demo.dem');
    process.exit(1);
  }

  const abs = path.resolve(demoPath);
  if (!fs.existsSync(abs)) {
    console.error('Arquivo não encontrado:', abs);
    process.exit(1);
  }

  const sizeMb = (fs.statSync(abs).size / 1024 / 1024).toFixed(1);
  // Default 1s — necessário para mapa de calor / movimento (no Render Free continua 0)
  const frameInterval = Number(process.env.FRAME_INTERVAL_SEC ?? 1);

  console.log('Node', process.version);
  console.log('Demo:', abs, `(${sizeMb} MB)`);
  console.log('Frames:', frameInterval > 0 ? `a cada ${frameInterval}s` : 'OFF (recomendado)');
  console.log('Parseando…');

  const t0 = Date.now();
  const data = await parseDemoFile(abs, {
    frameIntervalSec: frameInterval,
    maxFrames: Number(process.env.MAX_FRAMES || 2500),
  });
  const ms = Date.now() - t0;

  const out = path.join(path.dirname(abs), 'dados_partida.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2));

  console.log('---');
  console.log('OK em', ms + 'ms');
  console.log('Mapa:', data.mapa);
  console.log('Kills:', data.total_kills, '| Rounds:', data.total_rounds);
  console.log('Players:', (data.players || []).join(', '));
  console.log('Frames:', (data.frames || []).length);
  console.log('Salvo em:', out);
  console.log('Tamanho JSON:', (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
}

main().catch((e) => {
  console.error('FALHA:', e);
  process.exit(1);
});
