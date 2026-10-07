'use strict';

const { DemoReader, EntityMode } = require('cs2parser');

/**
 * FASE 1 — Análise espacial básica
 * - kills (com pos_vitima + pos_assassino)
 * - rounds (tick_start / tick_end)
 * - bomb_events
 * - frames: posição de cada jogador ~1x/s (calor / fundo / soft side depois)
 *
 * Granadas / replay 2D completo = fase 2.
 *
 * @param {string} demoPath
 * @param {{ frameIntervalSec?: number }} [opts]
 */
async function parseDemoFile(demoPath, opts = {}) {
  const frameIntervalSec = Math.max(0.5, Number(opts.frameIntervalSec) || 1);
  const parser = new DemoReader();
  const kills = [];
  const rounds = [];
  const bombEvents = [];
  const frames = [];
  const roundStarts = {}; // round -> tick

  let currentRound = 0;
  let tick = 0;
  let tickrate = 64;
  let mapName = null;
  let lastFrameTick = -Infinity;
  let inRound = false;

  const teamLabel = (n) => {
    if (n === 2) return 'TR';
    if (n === 3) return 'CT';
    return 'UNK';
  };

  const roundCoord = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(1) : null);

  const posOf = (entity) => {
    const p = entity?.position;
    if (!p) return null;
    return { x: roundCoord(p.x), y: roundCoord(p.y), z: roundCoord(p.z) };
  };

  const bumpTick = () => {
    if (typeof parser.currentTick === 'number' && parser.currentTick >= 0) {
      tick = parser.currentTick;
    }
  };

  const timeSec = () => +((tick || 0) / tickrate).toFixed(2);

  const sampleFrame = () => {
    bumpTick();
    if (!inRound || currentRound < 1) return;

    const intervalTicks = Math.max(1, Math.round(tickrate * frameIntervalSec));
    if (tick - lastFrameTick < intervalTicks) return;
    lastFrameTick = tick;

    const players = [];
    try {
      for (const p of parser.playerControllers || []) {
        if (!p || !p.name) continue;
        const team = p.teamNumber;
        if (team !== 2 && team !== 3) continue;
        const pos = posOf(p);
        if (!pos) continue;
        players.push({
          n: p.name,
          t: teamLabel(team),
          a: !!p.isAlive,
          x: pos.x,
          y: pos.y,
          z: pos.z,
        });
      }
    } catch (_) {
      return;
    }

    if (players.length === 0) return;

    frames.push({
      r: currentRound,
      t: tick,
      s: timeSec(),
      p: players,
    });
  };

  parser.on('tickend', (t) => {
    tick = typeof t === 'number' ? t : (t?.tick ?? tick);
    sampleFrame();
  });

  parser.gameEvents.on('round_start', () => {
    bumpTick();
    currentRound += 1;
    inRound = true;
    lastFrameTick = -Infinity;
    roundStarts[currentRound] = tick;
  });

  parser.gameEvents.on('round_end', (event) => {
    bumpTick();
    inRound = false;
    const winnerNum = event.winner ?? event.winnerTeam ?? null;
    const rn = currentRound || rounds.length + 1;
    rounds.push({
      round: rn,
      winner: teamLabel(winnerNum),
      winner_num: winnerNum,
      reason: event.reason ?? null,
      tick_start: roundStarts[rn] ?? null,
      tick_end: tick,
      time_sec: timeSec(),
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
      time_sec: timeSec(),
      pos: posOf(planter),
    });
  });

  parser.gameEvents.on('player_death', (event) => {
    bumpTick();
    const attacker = event.attackerPlayer;
    const victim = event.player;
    if (!attacker || !victim) return;

    let round = currentRound;
    if (!round && parser.gameRules?.roundsPlayed != null) {
      round = Number(parser.gameRules.roundsPlayed) + 1;
    }
    if (!round) round = null;

    const hs = !!(event.headshot ?? event.isHeadshot ?? event.headshoted);
    const startTick = round && roundStarts[round] != null ? roundStarts[round] : null;
    const roundTimeSec =
      startTick != null ? +(((tick - startTick) / tickrate)).toFixed(2) : null;

    kills.push({
      round,
      tick,
      time_sec: timeSec(),
      round_time_sec: roundTimeSec,
      assassino: attacker.name,
      time_assassino: teamLabel(attacker.teamNumber),
      vitima: victim.name,
      time_vitima: teamLabel(victim.teamNumber),
      arma: event.weapon || 'unknown',
      headshot: hs,
      headshot_label: hs ? 'Sim' : 'Não',
      pos_vitima: posOf(victim),
      pos_assassino: posOf(attacker),
    });
  });

  const startedAt = Date.now();
  await parser.parseDemo(demoPath, { entities: EntityMode.ALL });
  const parseMs = Date.now() - startedAt;

  if (parser.header?.mapName) mapName = parser.header.mapName;
  else if (parser.mapName) mapName = parser.mapName;
  else if (parser.header?.map_name) mapName = parser.header.map_name;

  if (parser.tickInterval && parser.tickInterval > 0) {
    tickrate = Math.round(1 / parser.tickInterval);
  } else if (parser.tickRate) {
    tickrate = parser.tickRate;
  }

  // Recalcula tempos com tickrate final
  for (const k of kills) {
    k.time_sec = +((k.tick || 0) / tickrate).toFixed(2);
    if (k.round && roundStarts[k.round] != null) {
      k.round_time_sec = +(((k.tick - roundStarts[k.round]) / tickrate)).toFixed(2);
    }
  }
  for (const r of rounds) {
    r.time_sec = +((r.tick_end || 0) / tickrate).toFixed(2);
    if (r.tick_start != null) {
      r.duration_sec = +(((r.tick_end - r.tick_start) / tickrate)).toFixed(2);
    }
  }
  for (const b of bombEvents) {
    b.time_sec = +((b.tick || 0) / tickrate).toFixed(2);
  }
  for (const f of frames) {
    f.s = +((f.t || 0) / tickrate).toFixed(2);
  }

  fillMissingRounds(kills);

  const players = {};
  for (const k of kills) {
    players[k.assassino] = true;
    players[k.vitima] = true;
  }

  return {
    fase: 1,
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
    frames,
    meta: {
      parse_ms: parseMs,
      frame_interval_sec: frameIntervalSec,
      total_frames: frames.length,
    },
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
    if (lastTick >= 0 && k.tick != null && k.tick - lastTick > 20 * 64) {
      inferred += 1;
    }
    k.round = inferred;
    lastTick = k.tick ?? lastTick;
  }
}

module.exports = { parseDemoFile };
