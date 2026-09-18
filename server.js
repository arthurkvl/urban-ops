const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'), (err) => {
    if (err) res.sendFile(path.join(__dirname, 'play.html'));
  });
});

// ============================================================
// CALL OF THE TRENCHES - original tactical FPS prototype.
// Fictional generic desert town, no real place or faction.
// All currency is virtual ("$" is flavor text only, no real
// money, no stakes, no pooled entry fees).
// ============================================================

const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAP_HALF = 45;
const PLAYER_RADIUS = 0.6;

const MAX_HP = 150;
const RIFLE_DAMAGE = 28;
const FIRE_RATE_MS = 140;
const WEAPON_RANGE = 75;
const KILL_REWARD = 3;
const DEATH_PENALTY = 4;
const SPAWN_PROTECTION_MS = 4000;
const FREEZE_MS = 3000;
const SURVIVOR_BONUS = 10;

const BOT_SPEED = 5.2;
const BOT_FIRE_RATE_MS = 900;
const BOT_HIT_CHANCE = 0.5;
const BOT_ENGAGE_RANGE = 38;

const MAX_PLAYERS = 10;
const LOBBY_WAIT_MS = 20000;

const CALLSIGNS = ['GHOST', 'VIPER', 'WOLF', 'FALCON', 'COBRA', 'HAVOC', 'SPECTRE', 'RAVEN', 'JACKAL', 'REAPER'];

// Fictional generic desert town layout (original geometry).
const BUILDINGS = [
  { x: -25, z: -25, hx: 6, hz: 6, h: 5 },
  { x: -8, z: -26, hx: 5, hz: 5, h: 5 },
  { x: 12, z: -28, hx: 7, hz: 5, h: 6 },
  { x: 30, z: -20, hx: 5, hz: 6, h: 5 },
  { x: -32, z: -4, hx: 5, hz: 8, h: 5 },
  { x: -10, z: -4, hx: 4, hz: 4, h: 4 },
  { x: 14, z: -4, hx: 6, hz: 6, h: 6 },
  { x: 32, z: 2, hx: 6, hz: 8, h: 5 },
  { x: -27, z: 17, hx: 6, hz: 6, h: 5 },
  { x: -5, z: 20, hx: 5, hz: 5, h: 5 },
  { x: 17, z: 22, hx: 7, hz: 6, h: 6 },
  { x: 34, z: 24, hx: 5, hz: 5, h: 5 },
  { x: 0, z: 36, hx: 8, hz: 5, h: 5 },
  { x: -19, z: 33, hx: 5, hz: 5, h: 4 },
];

// 16 points, all clear of every building's footprint (checked by hand against BUILDINGS),
// comfortably more than MAX_PLAYERS so a full lobby never forces two entities onto the same point.
const SPAWN_POINTS = [
  { x: -40, z: -40 }, { x: 40, z: -40 }, { x: -40, z: 40 }, { x: 40, z: 40 },
  { x: 0, z: -40 }, { x: 0, z: 40 }, { x: -40, z: 0 }, { x: 40, z: 0 },
  { x: 42, z: 20 }, { x: 40, z: -20 }, { x: -40, z: 20 }, { x: -40, z: -20 },
  { x: 20, z: 40 }, { x: -20, z: 40 }, { x: 20, z: -40 }, { x: -20, z: -40 },
];

// Standalone barrels: low cover you can duck and shoot around, blocks movement and sightlines.
// Placed flush against building walls, not scattered in the open.
const BARREL_RADIUS = 0.55;
const BARRELS = [
  { x: 12, z: 3 }, { x: 13.4, z: 3.2 }, // south wall of the building at (14,-4)
  { x: -26, z: -6 }, { x: -26, z: -3.4 }, // east wall of the building at (-32,-4)
  { x: 9, z: 20 }, { x: 9, z: 22.5 }, // west wall of the building at (17,22)
  { x: 10, z: -21.5 }, { x: 11.4, z: -21 }, // south wall of the building at (12,-28)
];

// A messy barrel pile stacked in a corner: no collision, just a raised plateau for high ground.
const PLATFORMS = [
  { x: -16, z: -9, radius: 2.2, height: 1.15 },
];

function resolveCollisions(x, z, radius) {
  for (const b of BUILDINGS) {
    const minX = b.x - b.hx, maxX = b.x + b.hx, minZ = b.z - b.hz, maxZ = b.z + b.hz;
    const cx = Math.max(minX, Math.min(x, maxX));
    const cz = Math.max(minZ, Math.min(z, maxZ));
    const dx = x - cx, dz = z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const push = radius - dist;
      x += (dx / dist) * push;
      z += (dz / dist) * push;
    }
  }
  for (const b of BARRELS) {
    const dx = x - b.x, dz = z - b.z;
    const minDist = radius + BARREL_RADIUS;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist) {
      const distV = Math.sqrt(distSq) || 0.0001;
      const push = minDist - distV;
      x += (dx / distV) * push;
      z += (dz / distV) * push;
    }
  }
  const half = MAP_HALF - 1;
  x = Math.max(-half, Math.min(half, x));
  z = Math.max(-half, Math.min(half, z));
  return { x, z };
}

function dist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function pointInBuilding(x, z, b, margin) {
  return x > b.x - b.hx - margin && x < b.x + b.hx + margin && z > b.z - b.hz - margin && z < b.z + b.hz + margin;
}

function groundHeightAt(x, z) {
  let h = 0;
  for (const p of PLATFORMS) {
    if (dist(x, z, p.x, p.z) <= p.radius) h = Math.max(h, p.height);
  }
  return h;
}

function hasLineOfSight(ax, az, bx, bz) {
  const d = dist(ax, az, bx, bz);
  const steps = Math.max(1, Math.ceil(d / 1.5));
  for (const b of BUILDINGS) {
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (pointInBuilding(x, z, b, 0)) return false;
    }
  }
  for (const b of BARRELS) {
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (dist(x, z, b.x, b.z) < BARREL_RADIUS + 0.15) return false;
    }
  }
  return true;
}

function randomSpawn(avoid) {
  if (!avoid || avoid.length === 0) {
    return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  }
  let best = SPAWN_POINTS[0];
  let bestScore = -1;
  const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);
  for (const sp of shuffled) {
    let minD = Infinity;
    for (const p of avoid) minD = Math.min(minD, dist(sp.x, sp.z, p.x, p.z));
    if (minD > bestScore) {
      bestScore = minD;
      best = sp;
    }
  }
  return best;
}

// ---------- Game state ----------
const players = new Map(); // name (humans) or bot id -> player, persists across reconnects
const socketToName = new Map(); // socket.id -> player name, for routing incoming events
let botCounter = 0;
let killFeed = [];
let matchStartAt = Date.now();
const MATCH_DURATION_MS = 5 * 60 * 1000;

function pushLog(text) {
  killFeed.unshift({ text, ts: Date.now() });
  killFeed = killFeed.slice(0, 8);
}

function makePlayer(id, name, isBot) {
  const spawn = randomSpawn([...players.values()]);
  return {
    id,
    name,
    isBot: !!isBot,
    connected: !isBot,
    x: spawn.x,
    z: spawn.z,
    yaw: 0,
    pitch: 0,
    hp: MAX_HP,
    alive: false,
    roundParticipant: false,
    credits: 0,
    kills: 0,
    deaths: 0,
    lastKillerId: null,
    lastShotAt: 0,
    botMoveTarget: null,
    protectedUntil: 0,
  };
}

function spawnBots(count) {
  for (let i = 0; i < count; i++) {
    botCounter++;
    const name = `${CALLSIGNS[botCounter % CALLSIGNS.length]}-${botCounter}`;
    const id = `bot_${botCounter}`;
    players.set(id, makePlayer(id, name, true));
  }
}

function clearBots() {
  for (const [key, p] of players) {
    if (p.isBot) players.delete(key);
  }
}

function getOrCreatePlayer(name) {
  if (players.has(name)) return players.get(name);
  const p = makePlayer(name, name, false);
  players.set(name, p);
  return p;
}

function applyHit(shooter, target) {
  if (target.protectedUntil && Date.now() < target.protectedUntil) return false;
  target.hp -= RIFLE_DAMAGE;
  io.to(target.socketId || '').emit('hit_taken', { hp: Math.max(0, target.hp) });
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    target.hp = 0;
    target.deaths += 1;
    target.lastKillerId = shooter.id;
    target.credits = Math.round((target.credits - DEATH_PENALTY) * 100) / 100;
    shooter.kills += 1;
    shooter.credits = Math.round((shooter.credits + KILL_REWARD) * 100) / 100;
    pushLog(`${shooter.name} eliminated ${target.name} (+$${KILL_REWARD} / -$${DEATH_PENALTY})`);
    io.to(shooter.socketId || '').emit('feedback', { type: 'kill', amount: KILL_REWARD });
    io.to(target.socketId || '').emit('feedback', { type: 'death', amount: -DEATH_PENALTY, killerId: shooter.id, killerName: shooter.name });
    return true;
  }
  return false;
}

let phase = 'lobby';
let lobbyDeadline = Date.now() + LOBBY_WAIT_MS;
let matchFreezeUntil = 0;

function startMatch() {
  clearBots();
  const humanCount = [...players.values()].filter((p) => p.connected && !p.isBot).length;
  spawnBots(Math.max(0, MAX_PLAYERS - humanCount));

  // Assign spawns one at a time, each picked as far as possible from every
  // spawn already handed out this round — prevents several entities from
  // landing on (or right next to) the same point, which used to let a pack
  // of bots gun someone down the instant their spawn protection expired.
  const roster = [...players.values()].sort(() => Math.random() - 0.5);
  const takenSpawns = [];
  for (const p of roster) {
    const spawn = randomSpawn(takenSpawns);
    takenSpawns.push(spawn);
    p.hp = MAX_HP;
    p.alive = true;
    p.roundParticipant = true;
    p.lastKillerId = null;
    p.lastShotAt = 0;
    p.x = spawn.x;
    p.z = spawn.z;
    p.protectedUntil = Date.now() + SPAWN_PROTECTION_MS;
  }
  matchStartAt = Date.now();
  matchFreezeUntil = matchStartAt + FREEZE_MS;
  phase = 'active';
  pushLog('Round starting — good hunting.');
}

function endRound() {
  clearBots();
  for (const p of players.values()) {
    p.alive = false;
    p.roundParticipant = false;
  }
  phase = 'lobby';
  lobbyDeadline = Date.now() + LOBBY_WAIT_MS;
}

// ---------- Bot AI ----------
function updateBot(bot, dt) {
  const now = Date.now();
  if (!bot.alive) return;
  if (now < matchFreezeUntil) return;

  if (bot.stuckEscapeUntil && now < bot.stuckEscapeUntil) {
    // Wedged in a corner while chasing an unreachable target: break off the
    // chase and walk toward an arbitrary point until clear, then resume.
    if (!bot.botMoveTarget || dist(bot.x, bot.z, bot.botMoveTarget.x, bot.botMoveTarget.z) < 2) {
      bot.botMoveTarget = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    }
    moveBotToward(bot, bot.botMoveTarget.x, bot.botMoveTarget.z, dt);
    return;
  }

  let target = null;
  let bestD = Infinity;
  for (const other of players.values()) {
    if (other.id === bot.id || !other.alive) continue;
    if (other.protectedUntil && now < other.protectedUntil) continue;
    const d = dist(bot.x, bot.z, other.x, other.z);
    if (d < bestD) {
      bestD = d;
      target = other;
    }
  }

  const canSeeTarget = target && bestD <= BOT_ENGAGE_RANGE && hasLineOfSight(bot.x, bot.z, target.x, target.z);

  if (canSeeTarget) {
    bot.yaw = Math.atan2(target.x - bot.x, target.z - bot.z);
    if (now - bot.lastShotAt >= BOT_FIRE_RATE_MS) {
      bot.lastShotAt = now;
      const isHit = Math.random() < BOT_HIT_CHANCE;
      const missOffset = isHit ? 0 : 1.4;
      io.emit('tracer', {
        shooterId: bot.id,
        fromX: bot.x,
        fromZ: bot.z,
        toX: target.x + (Math.random() - 0.5) * missOffset,
        toZ: target.z + (Math.random() - 0.5) * missOffset,
      });
      if (isHit) applyHit(bot, target);
    }
    if (bestD > BOT_ENGAGE_RANGE * 0.5) {
      moveBotToward(bot, target.x, target.z, dt);
    }
  } else if (target) {
    moveBotToward(bot, target.x, target.z, dt);
  } else {
    if (!bot.botMoveTarget || dist(bot.x, bot.z, bot.botMoveTarget.x, bot.botMoveTarget.z) < 2) {
      const sp = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
      bot.botMoveTarget = sp;
    }
    moveBotToward(bot, bot.botMoveTarget.x, bot.botMoveTarget.z, dt);
  }
}

function moveBotToward(bot, tx, tz, dt) {
  const d = dist(bot.x, bot.z, tx, tz);
  if (d < 0.5) return;
  const vx = (tx - bot.x) / d;
  const vz = (tz - bot.z) / d;
  const prevX = bot.x;
  const prevZ = bot.z;
  const nx = bot.x + vx * BOT_SPEED * dt;
  const nz = bot.z + vz * BOT_SPEED * dt;
  const resolved = resolveCollisions(nx, nz, PLAYER_RADIUS);
  bot.x = resolved.x;
  bot.z = resolved.z;

  const actualMove = dist(prevX, prevZ, bot.x, bot.z);
  const expectedMove = BOT_SPEED * dt;
  bot.stuckTicks = actualMove < expectedMove * 0.35 ? (bot.stuckTicks || 0) + 1 : 0;

  if (bot.stuckTicks > 8) {
    // Blocked by a building or barrel with no pathfinding: sidestep around it.
    const side = bot.sideBias || (bot.sideBias = Math.random() < 0.5 ? 1 : -1);
    const perpX = -vz * side;
    const perpZ = vx * side;
    const sideResolved = resolveCollisions(bot.x + perpX * BOT_SPEED * dt, bot.z + perpZ * BOT_SPEED * dt, PLAYER_RADIUS);
    bot.x = sideResolved.x;
    bot.z = sideResolved.z;
    if (bot.stuckTicks > 30) {
      bot.stuckTicks = 0;
      bot.sideBias = null;
      bot.botMoveTarget = null;
      bot.stuckEscapeUntil = Date.now() + 1500;
    }
  }
}

// ---------- Main tick ----------
let roundEndCooldownUntil = 0;

function tick() {
  const now = Date.now();
  const dt = TICK_MS / 1000;

  if (phase === 'lobby') {
    const humanCount = [...players.values()].filter((p) => p.connected && !p.isBot).length;
    if (humanCount >= MAX_PLAYERS || now >= lobbyDeadline) {
      startMatch();
    }
    broadcastState();
    return;
  }

  for (const p of players.values()) {
    if (p.isBot) updateBot(p, dt);
  }

  const roster = [...players.values()].filter((p) => p.connected || p.isBot);
  const aliveCount = roster.filter((p) => p.alive).length;
  const timedOut = now - matchStartAt > MATCH_DURATION_MS;
  const lastStanding = roster.length > 1 && aliveCount <= 1 && now > roundEndCooldownUntil;

  if (timedOut || lastStanding) {
    const standings = [...roster].sort((a, b) => b.credits - a.credits);
    const survivor = roster.find((p) => p.alive);
    let winnerName;
    let winnerBonus = 0;
    let reason;
    if (lastStanding && survivor) {
      survivor.credits = Math.round((survivor.credits + SURVIVOR_BONUS) * 100) / 100;
      winnerName = survivor.name;
      winnerBonus = SURVIVOR_BONUS;
      reason = 'last_standing';
      pushLog(`ROUND OVER — ${survivor.name} is the last one standing (+$${SURVIVOR_BONUS}).`);
    } else {
      winnerName = standings[0] ? standings[0].name : null;
      reason = 'timeout';
      pushLog(`ROUND OVER — top operative: ${winnerName || 'none'}.`);
    }
    io.emit('round_end', {
      reason,
      winnerName,
      winnerBonus,
      standings: standings.slice(0, 6).map((p) => ({ name: p.name, credits: p.credits })),
    });
    endRound();
    roundEndCooldownUntil = now + 4000;
  }

  broadcastState();
}

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    connected: p.connected,
    x: p.x,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch || 0,
    hp: Math.max(0, Math.round(p.hp)),
    alive: p.alive,
    roundParticipant: p.roundParticipant,
    lastKillerId: p.lastKillerId,
    credits: Math.round(p.credits),
    kills: p.kills,
    deaths: p.deaths,
  };
}

function broadcastState() {
  const visible = [...players.values()].filter((p) => p.connected || p.isBot);
  const humanCount = [...players.values()].filter((p) => p.connected && !p.isBot).length;
  const payload = {
    phase,
    humanCount,
    maxPlayers: MAX_PLAYERS,
    lobbyTimeLeftMs: phase === 'lobby' ? Math.max(0, lobbyDeadline - Date.now()) : 0,
    freezeTimeLeftMs: phase === 'active' ? Math.max(0, matchFreezeUntil - Date.now()) : 0,
    players: visible.map(serializePlayer),
    killFeed,
    matchTimeLeftMs: Math.max(0, MATCH_DURATION_MS - (Date.now() - matchStartAt)),
    buildings: BUILDINGS,
    barrels: BARRELS,
    platforms: PLATFORMS,
    mapHalf: MAP_HALF,
  };
  io.emit('state', payload);
}

// ---------- Sockets ----------
io.on('connection', (socket) => {
  socket.on('join', (name) => {
    const cleanName = (name || 'OPERATIVE').trim().slice(0, 18) || 'OPERATIVE';
    const p = getOrCreatePlayer(cleanName);
    p.connected = true;
    p.socketId = socket.id;
    socketToName.set(socket.id, cleanName);
    socket.emit('joined', { id: p.id, name: cleanName, x: p.x, z: p.z });
  });

  socket.on('move', ({ x, z, yaw, pitch }) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const p = players.get(name);
    if (!p || !p.alive) return;
    if (Date.now() >= matchFreezeUntil && Number.isFinite(x) && Number.isFinite(z)) {
      const resolved = resolveCollisions(x, z, PLAYER_RADIUS);
      p.x = resolved.x;
      p.z = resolved.z;
    }
    if (Number.isFinite(yaw)) p.yaw = yaw;
    if (Number.isFinite(pitch)) p.pitch = pitch;
  });

  socket.on('shoot', ({ targetId, toX, toZ }) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const p = players.get(name);
    if (!p || !p.alive) return;
    if (Date.now() < matchFreezeUntil) return;
    const now = Date.now();
    if (now - p.lastShotAt < FIRE_RATE_MS) return;
    p.lastShotAt = now;

    io.emit('tracer', {
      shooterId: p.id,
      fromX: p.x,
      fromZ: p.z,
      toX: Number.isFinite(toX) ? toX : p.x,
      toZ: Number.isFinite(toZ) ? toZ : p.z,
    });

    if (!targetId) return;
    const target = players.get(targetId);
    if (!target || !target.alive) return;
    if (dist(p.x, p.z, target.x, target.z) > WEAPON_RANGE * 1.3) return;
    if (!hasLineOfSight(p.x, p.z, target.x, target.z)) return;
    applyHit(p, target);
  });

  socket.on('disconnect', () => {
    const name = socketToName.get(socket.id);
    if (name) {
      const p = players.get(name);
      if (p) p.connected = false;
    }
    socketToName.delete(socket.id);
  });
});

setInterval(tick, TICK_MS);

const PORT = process.env.PORT || 3130;
httpServer.listen(PORT, () => {
  console.log(`Call of the Trenches running on http://localhost:${PORT}`);
});
