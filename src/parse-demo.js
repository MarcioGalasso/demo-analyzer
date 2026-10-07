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
  // 0.5s default recomendado p/ replay fluido; mínimo 0.25s
  const intervalSec = collectFrames ? Math.max(0.25, frameIntervalSec) : 0;
  const maxFrames = Math.max(100, Number(opts.maxFrames) || 5000);

  const parser = new DemoReader();
  const kills = [];
  const rounds = [];
  const bombEvents = [];
  const frames = [];
  const shots = [];
  const roundStarts = {};
  const lastShotTickByNick = new Map();
  const MAX_SHOTS = Math.max(1000, Number(opts.maxShots) || 12000);
  const SHOT_GAP_TICKS = 4; // ~60ms @64 — evita milhares de tiros por spray

  let currentRound = 0;
  let tick = 0;
  let tickrate = 64;
  let mapName = null;
  let lastFrameTick = -Infinity;
  let inRound = false;
  let intervalTicks = 32; // atualizado depois

  const teamLabel = (n) => {
    if (n === 2) return 'TR';
    if (n === 3) return 'CT';
    return 'UNK';
  };

  const roundCoord = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(1) : null);

  const shortWeapon = (name) => {
    if (!name) return null;
    let n = String(name).toLowerCase().replace(/^weapon_/, '');
    n = n.replace(/_/g, '-');
    const map = {
      ak47: 'AK47',
      m4a1: 'M4A1',
      'm4a1-silencer': 'M4A1-S',
      m4a4: 'M4A4',
      awp: 'AWP',
      deagle: 'Deagle',
      usp_silencer: 'USP',
      'usp-silencer': 'USP',
      glock: 'Glock',
      elite: 'Dualies',
      fiveseven: 'Five-SeveN',
      tec9: 'Tec-9',
      p250: 'P250',
      cz75a: 'CZ75',
      revolver: 'R8',
      mp9: 'MP9',
      mac10: 'MAC-10',
      mp7: 'MP7',
      ump45: 'UMP',
      p90: 'P90',
      bizon: 'Bizon',
      mp5sd: 'MP5',
      nova: 'Nova',
      xm1014: 'XM1014',
      mag7: 'MAG-7',
      sawedoff: 'Sawed-Off',
      m249: 'M249',
      negev: 'Negev',
      galilar: 'Galil',
      famas: 'FAMAS',
      ssg08: 'Scout',
      aug: 'AUG',
      sg556: 'SG553',
      scar20: 'SCAR',
      g3sg1: 'G3SG1',
      knife: 'Knife',
      'knife-t': 'Knife',
      hegrenade: 'HE',
      flashbang: 'Flash',
      smokegrenade: 'Smoke',
      molotov: 'Molly',
      incgrenade: 'Inc',
      decoy: 'Decoy',
      c4: 'C4',
    };
    if (map[n]) return map[n];
    return n.toUpperCase();
  };

  const utilFromInventory = (inv) => {
    const u = { he: 0, fl: 0, sm: 0, mo: 0, de: 0 };
    if (!inv || !inv.items) return u;
    for (let i = 0; i < inv.items.length; i++) {
      const it = inv.items[i];
      const raw = String((it && (it.name || it.className)) || '').toLowerCase();
      const q = Math.max(1, Number(it && it.quantity) || 1);
      if (raw.indexOf('hegrenade') >= 0) u.he += q;
      else if (raw.indexOf('flashbang') >= 0) u.fl += q;
      else if (raw.indexOf('smokegrenade') >= 0) u.sm += q;
      else if (raw.indexOf('molotov') >= 0 || raw.indexOf('incgrenade') >= 0 || raw.indexOf('incendiary') >= 0) u.mo += q;
      else if (raw.indexOf('decoy') >= 0) u.de += q;
    }
    return u;
  };

  const isGunFire = (weapon) => {
    const w = String(weapon || '').toLowerCase();
    if (!w) return false;
    if (w.indexOf('knife') >= 0 || w.indexOf('bayonet') >= 0) return false;
    if (w.indexOf('grenade') >= 0 || w.indexOf('flash') >= 0) return false;
    if (w.indexOf('smoke') >= 0 || w.indexOf('molotov') >= 0 || w.indexOf('incendiary') >= 0) return false;
    if (w.indexOf('decoy') >= 0 || w.indexOf('c4') >= 0 || w.indexOf('taser') >= 0) return false;
    return true;
  };

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
          let weapon = null;
          let util = null;
          try {
            const inv = p.inventory;
            if (inv && inv.activeItem && inv.activeItem.name) {
              weapon = shortWeapon(inv.activeItem.name);
            }
            util = utilFromInventory(inv);
          } catch (_) {
            util = { he: 0, fl: 0, sm: 0, mo: 0, de: 0 };
          }
          players.push({
            n: p.name,
            t: teamLabel(team),
            a: !!p.isAlive,
            x: pos.x,
            y: pos.y,
            yaw: yaw,
            hp: hp,
            w: weapon,
            u: util,
          });
        }
        if (!players.length) return;
        frames.push({ r: currentRound, t: tick, p: players });
      });
    });

    // Tracers: tiros com pos + yaw (throttle por jogador)
    parser.gameEvents.on('weapon_fire', (event) => {
      safe(() => {
        bumpTick();
        if (!inRound || currentRound < 1) return;
        if (shots.length >= MAX_SHOTS) return;
        if (!isGunFire(event.weapon)) return;
        const pl = event.player;
        if (!pl || !pl.name) return;
        const nick = pl.name;
        const prev = lastShotTickByNick.get(nick);
        if (prev != null && tick - prev < SHOT_GAP_TICKS) return;
        lastShotTickByNick.set(nick, tick);
        const pos = posOf(pl);
        if (!pos || pos.x == null || pos.y == null) return;
        let yaw = null;
        try {
          const ea = pl.eyeAngles;
          if (ea && typeof ea.yaw === 'number' && Number.isFinite(ea.yaw)) {
            yaw = Math.round(ea.yaw);
          }
        } catch (_) {}
        shots.push({
          r: currentRound,
          t: tick,
          n: nick,
          x: pos.x,
          y: pos.y,
          yaw: yaw,
          w: shortWeapon(event.weapon),
        });
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
  for (const s of shots) {
    s.s = +((s.t || 0) / tickrate).toFixed(2);
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
    shots,
    meta: {
      parse_ms: parseMs,
      frames_enabled: collectFrames,
      frame_interval_sec: collectFrames ? intervalSec : 0,
      total_frames: frames.length,
      max_frames: maxFrames,
      total_shots: shots.length,
      max_shots: MAX_SHOTS,
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
