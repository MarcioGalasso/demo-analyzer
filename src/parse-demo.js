'use strict';

const { DemoReader, EntityMode } = require('cs2parser');

/**
 * Parseia uma demo CS2 e devolve kills + rounds estruturados.
 * Usa estritamente cs2parser (DemoReader + EntityMode).
 */
async function parseDemoFile(demoPath) {
  const parser = new DemoReader();
  const kills = [];
  const rounds = [];
  const bombEvents = [];

  let currentRound = 0;
  let tick = 0;
  let tickrate = 64;
  let mapName = null;

  const teamLabel = (n) => {
    if (n === 2) return 'TR';
    if (n === 3) return 'CT';
    return 'UNK';
  };

  parser.on('tickend', (t) => {
    tick = typeof t === 'number' ? t : (t?.tick ?? tick);
  });

  // Alguns builds expõem tick via propriedade
  const bumpTick = () => {
    if (typeof parser.currentTick === 'number') tick = parser.currentTick;
    else if (typeof parser.tick === 'number') tick = parser.tick;
  };

  parser.gameEvents.on('round_start', () => {
    bumpTick();
    currentRound += 1;
  });

  parser.gameEvents.on('round_end', (event) => {
    bumpTick();
    const winnerNum = event.winner ?? event.winnerTeam ?? null;
    const winner = teamLabel(winnerNum);
    rounds.push({
      round: currentRound || rounds.length + 1,
      winner,
      winner_num: winnerNum,
      reason: event.reason ?? null,
      tick_end: tick,
      time_sec: +(tick / tickrate).toFixed(2),
    });
  });

  parser.gameEvents.on('bomb_planted', (event) => {
    bumpTick();
    const planter = event.player || event.useridPlayer || null;
    bombEvents.push({
      round: currentRound || null,
      site: event.site ?? event.bombsite ?? null,
      planter: planter?.name || null,
      tick,
      time_sec: +(tick / tickrate).toFixed(2),
    });
  });

  parser.gameEvents.on('player_death', (event) => {
    bumpTick();
    const attacker = event.attackerPlayer;
    const victim = event.player;
    if (!attacker || !victim) return;

    // Round: preferir contador interno; fallback gameRules
    let round = currentRound;
    if (!round && parser.gameRules?.roundsPlayed != null) {
      round = Number(parser.gameRules.roundsPlayed) + 1;
    }
    if (!round) round = null;

    const hs = !!(event.headshot ?? event.isHeadshot ?? event.headshoted);

    const posVictim = victim.position
      ? { x: victim.position.x, y: victim.position.y, z: victim.position.z }
      : null;

    kills.push({
      round,
      tick,
      time_sec: +(tick / tickrate).toFixed(2),
      assassino: attacker.name,
      time_assassino: teamLabel(attacker.teamNumber),
      vitima: victim.name,
      time_vitima: teamLabel(victim.teamNumber),
      arma: event.weapon || 'unknown',
      headshot: hs,
      headshot_label: hs ? 'Sim' : 'Não',
      pos_vitima: posVictim,
    });
  });

  await parser.parseDemo(demoPath, { entities: EntityMode.ALL });

  // Metadados pós-parse
  if (parser.header?.mapName) mapName = parser.header.mapName;
  else if (parser.mapName) mapName = parser.mapName;

  if (parser.tickInterval && parser.tickInterval > 0) {
    tickrate = Math.round(1 / parser.tickInterval);
  } else if (parser.tickRate) {
    tickrate = parser.tickRate;
  }

  // Recompute time_sec with final tickrate
  for (const k of kills) {
    k.time_sec = +((k.tick || 0) / tickrate).toFixed(2);
  }
  for (const r of rounds) {
    r.time_sec = +((r.tick_end || 0) / tickrate).toFixed(2);
  }

  // Infer round numbers if still null (group by gaps)
  fillMissingRounds(kills);

  const players = {};
  for (const k of kills) {
    players[k.assassino] = true;
    players[k.vitima] = true;
  }

  return {
    mapa: mapName,
    tickrate,
    total_kills: kills.length,
    total_rounds: Math.max(
      currentRound,
      rounds.length,
      ...kills.map((k) => Number(k.round) || 0),
      0
    ),
    players: Object.keys(players),
    kills,
    rounds,
    bomb_events: bombEvents,
  };
}

function fillMissingRounds(kills) {
  let inferred = 1;
  let lastTick = -1;
  for (const k of kills) {
    if (k.round != null && k.round !== 'Desconhecido') {
      inferred = Number(k.round) || inferred;
      lastTick = k.tick ?? lastTick;
      continue;
    }
    // Gap grande de ticks => provavelmente novo round
    if (lastTick >= 0 && k.tick != null && k.tick - lastTick > 20 * 64) {
      inferred += 1;
    }
    k.round = inferred;
    lastTick = k.tick ?? lastTick;
  }
}

module.exports = { parseDemoFile };
