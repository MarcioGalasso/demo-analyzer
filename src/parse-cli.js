'use strict';

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
  const data = await parseDemoFile(abs);
  const out = path.join(path.dirname(abs), 'dados_partida.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log('Salvo em', out);
  console.log('Kills:', data.total_kills, '| Rounds:', data.total_rounds, '| Mapa:', data.mapa);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
