'use strict';

const { DemoReader, EntityMode } = require('cs2parser');

/**
 * FASE 1 — Análise espacial básica (estável no Render Free)
 * - kills com pos_vitima / pos_assassino + round_time_sec
 * - rounds com tick_start / tick_end
 * - bomb_events
 * - frames OPCIONAIS (desligados por padrão — estouravam RAM no Free)
 *
 * @param {string} demoPath
 * @param {{ frameIntervalSec?: number, maxFrames?: number }} [opts]
 *   frameIntervalSec <= 0 → não coleta frames
 */
async function parseDemoFile(demoPath, opts = {}) {
  const frameIntervalSec = Number(opts.frameIntervalSec);
  const collectFrames = Number.isFinite(frameIntervalSec) && frameIntervalSec > 0;
  const intervalSec = collectFrames ? Math.max(1, frameIntervalSec) : 0;
  // ~1 frame/s em rounds vivos: partida longa cabe em ~2–3k amostras
  const maxFrames = Math.max(100, Number(opts.maxFrames) || 2500);

  const parser = new DemoReader();
  const kills = [];
  const rounds = [];
  const bombEvents = [];
  const frames = [];
  const roundStarts = {};

  let currentRound = 0;
  let tick = 0;
  let tickrate = 64;
  let mapName = null;
  let lastFrameTick = -Infinity;
  let inRound = false;
  let intervalTicks = 64; // atualizado depois; default 1s @ 64

  const teamLabel = (n) => {
    if (n === 2) return 'TR';
    if (n === 3) return 'CT';
    return 'UNK';
  };

  const roundCoord = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(1) : null);

  const posOf = (entity) => {
    try {
      const p = entity && entity.position;
      if (!p) return null;
      return { x: roundCoord(p.x), y: roundCoord(p.y), z: roundCoord(p.z) };
    } catch (_) {
      return null;
    }
  };

  const bumpTick = () => {
    try {
      if (typeof parser.currentTick === 'number' && parser.currentTick >= 0) {
        tick = parser.currentTick;
      }
    } catch (_) {}
  };

  const timeSec = () => +((tick || 0) / tickrate).toFixed(2);

  const safe = (fn) => {
    try {
      fn();
    } catch (err) {
      console.warn('[parse] listener error:', err && err.message ? err.message : err);
    }
  };

  // Frames: só se habilitado. Não roda lógica pesada em todo tick.
  if (collectFrames) {
    intervalTicks = Math.max(16, Math.round(64 * intervalSec));
    parser.on('tickend', (t) => {
      safe(() => {
        tick = typeof t === 'number' ? t : (t && t.tick != null ? t.tick : tick);
        if (!inRound || currentRound < 1) return;
        if (frames.length >= maxFrames) return;
        if (tick - lastFrameTick < intervalTicks) return;
        lastFrameTick = tick;

        const players = [];
        const list = parser.playerControllers;
        if (!list || !list.length) return;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (!p || !p.name) continue;
          const team = p.teamNumber;
          if (team !== 2 && team !== 3) continue;
          const pos = posOf(p);
          if (!pos) continue;
          let yaw = null;
          try {
            const ea = p.eyeAngles;
            if (ea && typeof ea.yaw === 'number' && Number.isFinite(ea.yaw)) {
              yaw = Math.round(ea.yaw);
            }
          } catch (_) {}
          let hp = null;
          try {
            if (typeof p.health === 'number' && Number.isFinite(p.health)) {
              hp = Math.max(0, Math.min(100, Math.round(p.health)));
            }
          } catch (_) {}
          players.push({
            n: p.name,
            t: teamLabel(team),
            a: !!p.isAlive,
            x: pos.x,
            y: pos.y,
            yaw: yaw,
            hp: hp,
          });
        }
        if (!players.length) return;
        frames.push({ r: currentRound, t: tick, p: players });
      });
    });
  } else {
    // Só atualiza tick barato (sem playerControllers)
    parser.on('tickend', (t) => {
      tick = typeof t === 'number' ? t : (t && t.tick != null ? t.tick : tick);
    });
  }

  parser.gameEvents.on('round_start', () =>
    safe(() => {
      bumpTick();
      currentRound += 1;
      inRound = true;
      lastFrameTick = -Infinity;
      roundStarts[currentRound] = tick;
    })
  );

  parser.gameEvents.on('round_end', (event) =>
    safe(() => {
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
    })
  );

  parser.gameEvents.on('bomb_planted', (event) =>
    safe(() => {
      bumpTick();
      const planter = event.player || event.useridPlayer || null;
      bombEvents.push({
        round: currentRound || null,
        site: event.site ?? event.bombsite ?? null,
        planter: planter && planter.name ? planter.name : null,
        tick,
        time_sec: timeSec(),
        pos: posOf(planter),
      });
    })
  );

  parser.gameEvents.on('player_death', (event) =>
    safe(() => {
      bumpTick();
      const attacker = event.attackerPlayer;
      const victim = event.player;
      if (!attacker || !victim) return;

      let round = currentRound;
      if (!round && parser.gameRules && parser.gameRules.roundsPlayed != null) {
        round = Number(parser.gameRules.roundsPlayed) + 1;
      }
      if (!round) round = null;

      const hs = !!(event.headshot ?? event.isHeadshot ?? event.headshoted);
      const startTick = round && roundStarts[round] != null ? roundStarts[round] : null;
      const roundTimeSec =
        startTick != null ? +((tick - startTick) / tickrate).toFixed(2) : null;

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
    })
  );

  const startedAt = Date.now();
  await parser.parseDemo(demoPath, { entities: EntityMode.ALL });
  const parseMs = Date.now() - startedAt;

  try {
    if (parser.header && parser.header.mapName) mapName = parser.header.mapName;
    else if (parser.mapName) mapName = parser.mapName;
    else if (parser.header && parser.header.map_name) mapName = parser.header.map_name;
  } catch (_) {}

  try {
    if (parser.tickInterval && parser.tickInterval > 0) {
      tickrate = Math.round(1 / parser.tickInterval);
    } else if (parser.tickRate) {
      tickrate = parser.tickRate;
    }
  } catch (_) {}

  for (const k of kills) {
    k.time_sec = +((k.tick || 0) / tickrate).toFixed(2);
    if (k.round && roundStarts[k.round] != null) {
      k.round_time_sec = +((k.tick - roundStarts[k.round]) / tickrate).toFixed(2);
    }
  }
  for (const r of rounds) {
    r.time_sec = +((r.tick_end || 0) / tickrate).toFixed(2);
    if (r.tick_start != null) {
      r.duration_sec = +((r.tick_end - r.tick_start) / tickrate).toFixed(2);
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
    if (k.assassino) players[k.assassino] = true;
    if (k.vitima) players[k.vitima] = true;
  }

  const roundNums = kills.map((k) => Number(k.round) || 0);
  const maxRound = roundNums.length ? Math.max.apply(null, roundNums) : 0;

  return {
    fase: 1,
    mapa: mapName,
    tickrate,
    total_kills: kills.length,
    total_rounds: Math.max(currentRound, rounds.length, maxRound, 0),
    players: Object.keys(players),
    kills,
    rounds,
    bomb_events: bombEvents,
    frames,
    meta: {
      parse_ms: parseMs,
      frames_enabled: collectFrames,
      frame_interval_sec: collectFrames ? intervalSec : 0,
      total_frames: frames.length,
      max_frames: maxFrames,
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
