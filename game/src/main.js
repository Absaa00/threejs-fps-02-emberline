// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. EMBERLINE — Kestrel Yard: Vanguard (player + 3 bots) attacks, Ashen (5 bots)
// defends two plant sites; first to 5 rounds wins. ?shot=start|play|buy|end with
// &seed=N sets up a deterministic frame for a capture, renders it twice, then
// freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSet, WEAPONS, GRENADE } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds, BUY_SECONDS, ROUND_SECONDS } from './rounds.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// Any runtime error is surfaced on the document so a headless check can see it.
window.addEventListener('error', (event) => {
  document.body.dataset.error = String(event.message || event.error || 'error');
});
window.addEventListener('unhandledrejection', (event) => {
  document.body.dataset.error = String(event.reason || 'rejection');
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.surface);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.surface), 18, 46);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const weapons = createWeaponSet(camera);
const combat = createCombat(scene, world);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, world, combat, seed);

const body = player.state;
let health = 100;
let playerAlive = true;
let started = false;
let frozen = false;
let elapsed = 0;
let buyOpen = false;
let prevFiring = false;
let prevKeys = new Set();
let stepCount = 0;
let footstepAt = 0;

const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpV = new THREE.Vector3();

// One stable view of the player for the bots: the object identity must not
// change, or the bots' reaction timer would reset on every perception tick.
const playerView = {
  position: body.position,
  alive: true,
  speed: 0,
  crouched: false,
};

// The player as a damageable actor, so grenades and bot fire share one path.
const playerActor = {
  get position() {
    return body.position;
  },
  get alive() {
    return playerAlive;
  },
  damage(amount) {
    damagePlayer(amount, null, false);
    return !playerAlive;
  },
};

function damagePlayer(amount, attacker, headshot) {
  if (!playerAlive) return;
  health -= amount;
  audio.hurt();
  hud.damageFlash();
  hud.setHealth(health);
  if (health <= 0) {
    health = 0;
    playerAlive = false;
    const name = attacker ? attacker.name : 'Blast';
    hud.killfeed(`${name} ▸ You${headshot ? ' (headshot)' : ''}`, false);
    hud.banner('You are down', 'Your squad fights on — next round you respawn.');
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function onBotKilled(victim, killer) {
  const killerIsPlayer = killer === 'player';
  const killerName = killerIsPlayer ? 'You' : killer.name;
  hud.killfeed(`${killerName} ▸ ${victim.name}`, killerIsPlayer || victim.team !== 'defend');
  rounds.registerKill(victim.team === 'defend' ? 'attack' : 'defend', killerIsPlayer, victim.name, killerName);
}

const rounds = createRounds((event) => {
  const s = event.state;
  if (event.type === 'roundStart') {
    playerAlive = true;
    health = 100;
    body.position.set(SPAWNS.attack[0].x, 0, SPAWNS.attack[0].z);
    body.yaw = SPAWNS.attack[0].yaw;
    body.pitch = 0;
    body.velocity.set(0, 0, 0);
    weapons.refill();
    weapons.state.grenades = s.grenades;
    combat.reset();
    bots.reset();
    hud.setHealth(100);
    hud.setScore(s.scoreV, s.scoreA, s.round);
    hud.banner(`Round ${s.round}`, 'Buy phase — press B for the buy menu.');
    hud.setMoney(s.money);
    hud.setGrenades(s.grenades);
  } else if (event.type === 'roundLive') {
    bots.assignAttackPlan(random() < 0.5 ? 'A' : 'B');
    hud.banner(`Round ${s.round} — Go`, 'Plant the spark cell at Site A or B.');
    audio.uiClick();
  } else if (event.type === 'roundEnd') {
    buyOpen = false;
    hud.showBuy(false, s.money, weapons.owned);
    hud.banner(event.winner === 'attack' ? 'Round to Vanguard' : 'Round to Ashen', event.reason, 3400);
    hud.setScore(s.scoreV, s.scoreA, s.round);
    hud.setMoney(s.money);
    if (event.winner === 'attack') audio.roundWin();
    else audio.roundLose();
  } else if (event.type === 'matchEnd') {
    hud.showOverlay('matchEnd', { winner: event.winner, scoreV: s.scoreV, scoreA: s.scoreA });
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (event.type === 'planted') {
    hud.banner('Spark cell planted', `Site ${event.site} — ${Math.round(40)}s to detonation.`, 3200);
    audio.planted();
  } else if (event.type === 'defused') {
    hud.banner('Spark cell defused', 'Ashen holds the site.', 3000);
  } else if (event.type === 'detonated') {
    hud.banner('Spark cell detonated', `Site ${event.site} is gone.`, 3000);
    audio.explosion();
  } else if (event.type === 'kill') {
    // Killfeed lines are written by the killer's own call site.
  } else if (event.type === 'buy') {
    audio.buy();
    hud.setMoney(s.money);
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    if (buyOpen) {
      buyOpen = false;
      hud.showBuy(false, rounds.state.money, weapons.owned);
    }
  } else if (rounds.state.phase === 'match') {
    hud.showOverlay('matchEnd', { winner: rounds.state.scoreV > rounds.state.scoreA ? 'attack' : 'defend', scoreV: rounds.state.scoreV, scoreA: rounds.state.scoreA });
  } else if (started && !buyOpen) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'match' || rounds.state.phase === 'idle') {
    rounds.startMatch();
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name.toUpperCase(), weapons.def().mag);
  }
  input.requestLock();
});

hud.onBuy((id) => {
  tryBuy(id);
});

function tryBuy(id) {
  if (rounds.state.phase !== 'buy') {
    hud.banner('Buy phase is over', 'Fight with what you have.');
    audio.denied();
    return;
  }
  if (id === 'grenade') {
    const result = rounds.buyGrenade();
    if (result.ok) {
      weapons.state.grenades += 1;
      hud.setGrenades(weapons.state.grenades);
    } else {
      hud.banner(result.reason, '');
      audio.denied();
    }
    return;
  }
  const def = WEAPONS[id];
  if (!def) return;
  if (weapons.owned[id]) {
    weapons.switchTo(id);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name.toUpperCase(), def.mag);
    return;
  }
  const result = rounds.buy(def);
  if (result.ok) {
    weapons.buy(id);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name.toUpperCase(), def.mag);
    hud.setGrenades(weapons.state.grenades);
  } else {
    hud.banner(result.reason, '');
    audio.denied();
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot() {
  const def = weapons.def();
  if (!weapons.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(direction);
  muzzle.copy(camera.position);
  const result = combat.fireShot(muzzle, direction, { ...def, spread: weapons.spread(player.groundSpeed()) }, random, bots.enemyHitMeshes);
  weapons.pullTrigger();
  player.recoil(0.009 + def.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.id);
  for (const bot of bots.bots) bots.hearNoise(bot, muzzle, 20);
  if (result && result.hit && result.actor) {
    hud.hitMarker(result.killed, shot ? 4000 : 90);
    if (result.killed) {
      audio.kill();
      onBotKilled(result.actor, 'player');
    } else {
      audio.hit();
    }
  }
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, def.name.toUpperCase(), def.mag);
}

function throwGrenade() {
  if (!weapons.takeGrenade()) return;
  rounds.state.grenades = weapons.state.grenades;
  camera.getWorldDirection(direction);
  muzzle.copy(camera.position).addScaledVector(direction, 0.5);
  tmpV.copy(direction).multiplyScalar(14);
  tmpV.y += 3.5;
  combat.throwGrenade(muzzle, tmpV);
  audio.grenadePin();
  hud.setGrenades(weapons.state.grenades);
}

function siteContaining(x, z) {
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    if (Math.hypot(x - site.center.x, z - site.center.z) <= site.radius) return key;
  }
  return null;
}

function step(dt) {
  elapsed += dt;
  stepCount += 1;
  const keys = input.state.keys;
  const rs = rounds.state;

  // Edge-triggered keys: buy menu, grenade, weapon switch, reload.
  const pressed = (code) => keys.has(code) && !prevKeys.has(code);
  if (pressed('KeyB') && (rs.phase === 'buy' || buyOpen)) {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen, rs.money, weapons.owned);
    if (buyOpen) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (started) {
      input.requestLock();
    }
  }
  if (pressed('KeyG') && playerAlive && rs.phase === 'live') throwGrenade();
  if (pressed('KeyR') && playerAlive) {
    if (weapons.reload()) audio.reload();
  }
  for (let i = 1; i <= 5; i += 1) {
    if (pressed(`Digit${i}`)) {
      const id = Object.keys(WEAPONS).find((key) => WEAPONS[key].slot === i);
      if (id && weapons.owned[id]) {
        weapons.switchTo(id);
        hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name.toUpperCase(), weapons.def().mag);
      } else if (id && rs.phase === 'buy') {
        tryBuy(id);
      }
    }
  }
  if (pressed('Digit6') && rs.phase === 'buy') tryBuy('grenade');
  prevKeys = new Set(keys);

  if (started || shot) player.step(dt, keys);
  weapons.step(dt);
  combat.step(dt);

  // Footsteps while moving on the ground.
  if (playerAlive && player.groundSpeed() > 1 && player.state.onGround && elapsed > footstepAt) {
    footstepAt = elapsed + 0.38;
    audio.footstep();
  }

  // Firing: automatic weapons hold, semi-automatic need a fresh press.
  const firing = input.state.firing && playerAlive && (rs.phase === 'live' || rs.phase === 'buy');
  const freshPress = firing && !prevFiring;
  if (firing && weapons.ready() && (weapons.def().auto || freshPress)) shoot();
  prevFiring = input.state.firing;

  // Plant / defuse channels for the player (Vanguard plants; it never defuses).
  let planting = null;
  let plantSite = null;
  let plantPosition = null;
  if (playerAlive && rs.phase === 'live' && keys.has('KeyE')) {
    const site = siteContaining(body.position.x, body.position.z);
    if (site && !rs.planted) {
      planting = 'player';
      plantSite = site;
      plantPosition = new THREE.Vector3(SITES[site].center.x, 0, SITES[site].center.z);
    }
  }
  const worldState = {
    planting,
    plantSite,
    plantPosition,
    defusing: null,
    aliveAttack: (playerAlive ? 1 : 0) + bots.aliveCount('attack'),
    aliveDefend: bots.aliveCount('defend'),
  };
  rounds.update(dt, worldState);

  // Progress bar: planting, or a defender bot defusing the cell.
  if (rs.plantProgress > 0) {
    hud.showProgress('PLANTING SPARK CELL', rs.plantProgress / 4);
    if (stepCount % 30 === 0) audio.plantBeep();
  } else if (rs.defuseProgress > 0) {
    hud.showProgress('DEFUSING SPARK CELL', rs.defuseProgress / 5);
    if (stepCount % 30 === 0) audio.defuseBeep();
  } else if (rs.planted) {
    hud.showProgress('SPARK CELL LIVE — DEFEND IT', 1 - rs.planted.fuse / 40);
  } else {
    hud.hideProgress();
  }

  // Bots fight in buy (walk to holds) and live; frozen between rounds.
  if (rs.phase === 'buy' || rs.phase === 'live') {
    playerView.alive = playerAlive;
    playerView.speed = player.groundSpeed();
    playerView.crouched = player.state.crouching;
    bots.update(dt, {
      time: elapsed,
      camera,
      phase: rs.phase,
      planted: rs.planted,
      cellPosition: rs.planted ? rs.planted.position : null,
      player: playerView,
      damagePlayer,
      onBotKilled: (victim, killer) => onBotKilled(victim, killer),
      emitNoise: (position, radius) => {
        for (const bot of bots.bots) bots.hearNoise(bot, position, radius);
      },
      onPlantStart: () => {},
      onPlant: (bot, site) => {
        rounds.plantComplete(site, new THREE.Vector3(SITES[site].center.x, 0, SITES[site].center.z), false);
      },
      onDefuse: () => {
        rounds.defuseComplete(false);
      },
    }, elapsed);
  }

  // Grenade blasts hurt defenders and the player alike — never allies.
  const explodedAt = combat.stepGrenades(dt, [...bots.enemyBots, playerActor], (actor, amount) => {
    if (actor === playerActor) {
      damagePlayer(amount, null, false);
      return;
    }
    if (!actor.alive) return;
    const killed = actor.damage(amount, 'blast');
    if (killed) onBotKilled(actor, 'player');
  });
  if (explodedAt) audio.explosion();

  // HUD readouts.
  hud.setTimer(rs.planted ? rs.planted.fuse : rs.timer, rs.phase);
  hud.setMoney(rs.money);
  if (rs.phase === 'idle' || rs.phase === 'match') hud.setTimer(rs.phase === 'match' ? 0 : BUY_SECONDS, 'buy');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerAlive) player.look(look.x, look.y);
    let accumulator = dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  rounds.startMatch();
  if (name === 'start') {
    body.position.set(-6, 0, 15.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    syncCamera();
    hud.showOverlay('start');
  } else if (name === 'buy') {
    body.position.set(-6, 0, 15.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(10);
    syncCamera();
    buyOpen = true;
    hud.showBuy(true, rounds.state.money, weapons.owned);
  } else if (name === 'play') {
    rounds.state.phase = 'live';
    rounds.state.timer = ROUND_SECONDS;
    bots.assignAttackPlan('A');
    body.position.set(-2, 0, 8);
    body.yaw = 0.35;
    body.pitch = 0;
    settle(150);
    // Aim at the nearest visible enemy and fire, so the frame shows a tracer and a hit.
    let best = null;
    let bestDist = Infinity;
    for (const bot of bots.enemyBots) {
      if (!bot.alive) continue;
      const d = bot.position.distanceTo(body.position);
      if (d < bestDist) {
        bestDist = d;
        best = bot;
      }
    }
    if (best) {
      aimAt(new THREE.Vector3(best.position.x, 1.15, best.position.z));
      shoot();
      settle(8); // let the muzzle flash fade before the freeze
    }
    // Stage the frame at full health: the settle stands the player in the open.
    health = 100;
    playerAlive = true;
    hud.setHealth(100);
    syncCamera();
  } else if (name === 'end') {
    rounds.state.scoreV = 2;
    rounds.state.scoreA = 1;
    rounds.endRound('attack', 'Ashen eliminated');
    body.position.set(-2, 0, 8);
    body.yaw = -0.3;
    body.pitch = 0;
    settle(10);
    syncCamera();
    hud.showOverlay('roundEnd', { winner: 'attack', reason: 'Ashen eliminated', scoreV: rounds.state.scoreV, scoreA: rounds.state.scoreA });
  }
  hud.setScore(rounds.state.scoreV, rounds.state.scoreA, rounds.state.round);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name.toUpperCase(), weapons.def().mag);
  hud.setMoney(rounds.state.money);
  hud.setHealth(health);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = performance.now();

// Read-only debug handle for headless play-testing: a snapshot of the match.
window.__ember = {
  // Headless play-test hook: start the match without pointer lock.
  start() {
    rounds.startMatch();
    started = true;
    hud.hideOverlay();
  },
  // Headless logic test: run N sim-seconds synchronously, without rendering.
  fastForward(seconds) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i += 1) step(1 / 60);
    syncCamera();
    return n;
  },
  snapshot() {
    return {
      health,
      playerAlive,
      phase: rounds.state.phase,
      round: rounds.state.round,
      timer: +rounds.state.timer.toFixed(2),
      money: rounds.state.money,
      scoreV: rounds.state.scoreV,
      scoreA: rounds.state.scoreA,
      planted: rounds.state.planted ? { site: rounds.state.planted.site, fuse: +rounds.state.planted.fuse.toFixed(1) } : null,
      bots: bots.bots.map((b) => ({ name: b.name, team: b.team, state: b.state, health: b.health, alive: b.alive, mag: b.mag, target: b.target ? `${b.target.kind}:${b.target.ref.name || 'player'}` : null, x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1) })),
      player: { x: +body.position.x.toFixed(1), z: +body.position.z.toFixed(1) },
    };
  },
};

syncCamera();
hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name.toUpperCase(), weapons.def().mag);
hud.setMoney(rounds.state.money);
hud.setHealth(100);
hud.setScore(0, 0, 1);
hud.setTimer(BUY_SECONDS, 'buy');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
