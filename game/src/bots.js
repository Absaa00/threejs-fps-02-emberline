// The bots: eight of them, Vanguard (player's team, attackers) against Ashen
// (defenders). Each bot is a small state machine — hold, patrol, push, engage,
// rotate, plant, defuse — walking the nav graph leg by leg, checking line of sight
// on a staggered timer, and firing in bursts with a hit roll that punishes distance
// and a moving target. They hear gunfire and the plant, and the defenders rotate
// to the threatened site. No bot ever knows a position it could not have seen or
// heard: last-known positions age out and the bot falls back to holding.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { SITES, SPAWNS } from './world.js';
import { findPath, nearestNode, nodePosition } from './nav.js';
import { WEAPONS, damageAtRange } from './weapons.js';

const EYE_HEIGHT = 1.5;
const CHEST_HEIGHT = 1.15;
const BOT_SPEED = 3.4;
const PERCEIVE_EVERY = 0.12;
const MEMORY_SECONDS = 4;
const HEAR_RADIUS = 20;
const PLANT_TIME = 4;
const DEFUSE_TIME = 5;

const VANGUARD_NAMES = ['Rook', 'Sable', 'Wren'];
const ASHEN_NAMES = ['Cinder', 'Flint', 'Ember', 'Soot', 'Ash'];
const DEFEND_HOLDS = { A: [22, 23], B: [26, 27] };
const SITE_NODES = { A: 24, B: 28 };
const SITE_APPROACH = { A: 21, B: 25 };

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const probe = new THREE.Box3();
const BOT_RADIUS = 0.34;

// Bots collide like the player: a step is only taken when the bot's box fits.
// Waypoint legs are clear by construction, but duels are not — without this a
// bot closing on its target walks straight through a wall and then shoots it.
function canStand(world, x, z) {
  probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
  probe.max.set(x + BOT_RADIUS, 1.7, z + BOT_RADIUS);
  for (const collider of world.colliders) if (probe.intersectsBox(collider)) return false;
  return true;
}

function moveBot(world, bot, dx, dz) {
  const nx = bot.position.x + dx;
  if (canStand(world, nx, bot.position.z)) bot.position.x = nx;
  const nz = bot.position.z + dz;
  if (canStand(world, bot.position.x, nz)) bot.position.z = nz;
  bot.position.x = Math.max(-22.4, Math.min(22.4, bot.position.x));
  bot.position.z = Math.max(-17.4, Math.min(17.4, bot.position.z));
}

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

export function createBots(scene, world, combat, seed = 1) {
  const random = mulberry32(seed);
  const bots = [];
  const hitMeshes = [];
  const pathScratch = [];

  const vanguardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.pine), roughness: 0.7, metalness: 0.1 });
  const ashenMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.7, metalness: 0.1 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.155, 12, 10);
  const legGeometry = new THREE.BoxGeometry(0.18, 0.55, 0.2);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const barGeometry = new THREE.BoxGeometry(0.5, 0.06, 0.02);
  const barBgGeometry = new THREE.BoxGeometry(0.52, 0.08, 0.02);
  const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const barBgMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hairline) });

  function makeBot(index, team, name, spawn) {
    const group = new THREE.Group();
    const mat = team === 'attack' ? vanguardMat : ashenMat;
    const torso = new THREE.Mesh(torsoGeometry, mat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeometry, headMat);
    head.position.y = 1.53;
    const legL = new THREE.Mesh(legGeometry, darkMat);
    legL.position.set(-0.14, 0.28, 0);
    const legR = new THREE.Mesh(legGeometry, darkMat);
    legR.position.set(0.14, 0.28, 0);
    const gun = new THREE.Mesh(gunGeometry, darkMat);
    gun.position.set(0.2, 1.05, -0.25);
    const barBg = new THREE.Mesh(barBgGeometry, barBgMat);
    barBg.position.y = 1.95;
    const bar = new THREE.Mesh(barGeometry, barMat);
    bar.position.y = 1.95;
    bar.position.z = 0.02;
    group.add(torso, head, legL, legR, gun, barBg, bar);
    group.position.set(spawn.x, 0, spawn.z);
    group.rotation.y = spawn.yaw;
    scene.add(group);

    const bot = {
      id: `bot-${index}`,
      name,
      team,
      position: group.position,
      yaw: spawn.yaw,
      group,
      torso,
      head,
      bar,
      barBg,
      health: 100,
      alive: true,
      state: team === 'defend' ? 'hold' : 'push',
      weapon: team === 'attack' ? WEAPONS.vk7 : WEAPONS.hornet,
      mag: 30,
      cooldown: 0,
      burstLeft: 0,
      burstPause: 0,
      reactAt: 0,
      perceiveAt: random() * PERCEIVE_EVERY,
      lastKnown: null,
      lastKnownAt: -99,
      target: null, // { kind: 'player' | 'bot', ref, position }
      path: [],
      pathIndex: 0,
      holdNode: -1,
      site: null,
      progress: 0,
      fall: 0,
      walkPhase: random() * Math.PI * 2,
      strafeDir: 1,
      strafeAt: 0,
      carrier: false,
    };
    torso.userData.actor = bot;
    torso.userData.part = 'torso';
    head.userData.actor = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bot.damage = (amount, part) => {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.state = 'dead';
      bot.fall = 0;
      return true;
    };
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < VANGUARD_NAMES.length; i += 1) {
    makeBot(i, 'attack', VANGUARD_NAMES[i], SPAWNS.attack[i + 1]);
  }
  for (let i = 0; i < ASHEN_NAMES.length; i += 1) {
    makeBot(3 + i, 'defend', ASHEN_NAMES[i], SPAWNS.defend[i]);
  }

  function setPath(bot, goalNode) {
    const from = nearestNode(bot.position.x, bot.position.z);
    findPath(from, goalNode, pathScratch);
    bot.path = pathScratch.slice();
    bot.pathIndex = 0;
  }

  function assignDefendHolds() {
    const defenders = bots.filter((b) => b.team === 'defend');
    defenders[0].holdNode = DEFEND_HOLDS.A[0];
    defenders[0].site = 'A';
    defenders[1].holdNode = DEFEND_HOLDS.A[1];
    defenders[1].site = 'A';
    defenders[2].holdNode = DEFEND_HOLDS.B[0];
    defenders[2].site = 'B';
    defenders[3].holdNode = DEFEND_HOLDS.B[1];
    defenders[3].site = 'B';
    defenders[4].holdNode = 15; // mid roamer
    defenders[4].site = null;
    for (const bot of defenders) setPath(bot, bot.holdNode);
  }

  function assignAttackPlan(site) {
    const attackers = bots.filter((b) => b.team === 'attack');
    attackers[0].carrier = true;
    attackers[0].site = site;
    attackers[1].site = site;
    attackers[2].site = site === 'A' ? 'B' : 'A'; // one lurks the other lane
    for (const bot of attackers) {
      setPath(bot, SITE_NODES[bot.site]);
      bot.state = 'push';
    }
  }

  function eyeOf(bot, out) {
    out.set(bot.position.x, EYE_HEIGHT, bot.position.z);
    return out;
  }

  function chestOf(position, out) {
    out.set(position.x, CHEST_HEIGHT, position.z);
    return out;
  }

  // Perception: the nearest enemy the bot can actually see. The player counts
  // only while alive, and crouching shrinks the distance the bot notices them.
  function perceive(bot, ctx, now) {
    let best = null;
    let bestDist = Infinity;
    const eye = eyeOf(bot, tmpA);
    const candidates = [];
    // The player is Vanguard: only Ashen bots see them as a target.
    if (ctx.player.alive && bot.team === 'defend') {
      candidates.push({ kind: 'player', ref: ctx.player, position: ctx.player.position, speed: ctx.player.speed, crouched: ctx.player.crouched });
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      candidates.push({ kind: 'bot', ref: other, position: other.position, speed: 3.4, crouched: false });
    }
    for (const c of candidates) {
      const dist = bot.position.distanceTo(c.position);
      const notice = c.crouched ? 16 : 30;
      if (dist > notice || dist >= bestDist) continue;
      chestOf(c.position, tmpB);
      if (!combat.hasLineOfSight(eye, tmpB)) continue;
      best = c;
      bestDist = dist;
    }
    if (best) {
      bot.target = best;
      // First sight costs a reaction beat: the bot turns, aims, then fires.
      // Candidates are rebuilt every perception tick, so identity is the ref.
      const newTarget = !bot.previousTarget || best.ref !== bot.previousTarget.ref;
      if (!bot.reactAt || newTarget) bot.reactAt = now + 0.4 + random() * 0.5;
      bot.previousTarget = best;
      bot.lastKnown = best.position.clone();
      bot.lastKnownAt = now;
      if (bot.state !== 'engage') bot.state = 'engage';
    } else if (bot.target) {
      // Lost sight: keep hunting the last-known spot while the memory is fresh.
      if (now - bot.lastKnownAt > MEMORY_SECONDS) {
        bot.target = null;
        bot.previousTarget = null;
        bot.reactAt = 0;
        bot.lastKnown = null;
        bot.state = bot.team === 'defend' ? 'rotate' : 'push';
      }
    }
  }

  function faceToward(bot, x, z, dt) {
    const targetYaw = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
    bot.group.rotation.y = bot.yaw;
  }

  function walkPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = bot.path[bot.pathIndex];
    nodePosition(node, tmpC);
    const dx = tmpC.x - bot.position.x;
    const dz = tmpC.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    faceToward(bot, tmpC.x, tmpC.z, dt);
    const step = Math.min(dist, BOT_SPEED * dt);
    moveBot(world, bot, (dx / dist) * step, (dz / dist) * step);
    bot.walkPhase += dt * 9;
    return false;
  }

  function shootAt(bot, ctx, now) {
    if (bot.cooldown > 0 || bot.burstLeft <= 0) return;
    const target = bot.target;
    if (!target) return;
    const def = bot.weapon;
    bot.cooldown = def.fireGap * 2.0;
    bot.burstLeft -= 1;
    if (bot.mag <= 0) {
      bot.mag = def.mag;
      bot.cooldown = def.reloadTime;
      return;
    }
    bot.mag -= 1;
    const eye = eyeOf(bot, tmpA);
    chestOf(target.position, tmpB);
    const dist = eye.distanceTo(tmpB);
    // Block check on the TRUE line to the target: the jittered tracer below is
    // visual only and must never decide whether the shot counts.
    if (!combat.hasLineOfSight(eye, tmpB)) return;
    tmpC.copy(tmpB).sub(eye).normalize();
    // Tracer jitter stays small so the line reads as aimed, not wild.
    const error = def.spread * 2 + dist * 0.002 + (target.speed || 0) * 0.001;
    tmpC.x += (random() * 2 - 1) * error;
    tmpC.y += (random() * 2 - 1) * error;
    tmpC.z += (random() * 2 - 1) * error;
    combat.trace(eye, tmpC, dist + 2);
    // Hit roll: close and still is dangerous, far and sprinting is survivable.
    let chance = 0.45 - dist * 0.012 - (target.speed || 0) * 0.02;
    if (target.crouched) chance -= 0.12;
    chance = Math.max(0.08, Math.min(0.7, chance));
    if (random() >= chance) return;
    const headshot = random() < 0.1;
    const amount = Math.round(damageAtRange(def, dist) * (headshot ? def.headMult : 1));
    if (target.kind === 'player') {
      ctx.damagePlayer(amount, bot, headshot);
    } else if (target.ref.alive) {
      const killed = target.ref.damage(amount, headshot ? 'head' : 'torso');
      if (killed) ctx.onBotKilled(target.ref, bot);
    }
    ctx.emitNoise(eye, HEAR_RADIUS);
  }

  function updateBot(bot, dt, ctx, now) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    // Buy phase is a safe window: bots walk to their holds, nobody perceives
    // or shoots until the round goes live.
    if (ctx.phase === 'buy') {
      bot.target = null;
      if (bot.state === 'engage') bot.state = bot.team === 'defend' ? 'hold' : 'push';
    }
    bot.perceiveAt -= dt;
    if (bot.perceiveAt <= 0 && ctx.phase === 'live') {
      bot.perceiveAt = PERCEIVE_EVERY + random() * 0.05;
      perceive(bot, ctx, now);
    }

    // Health bar above the head, always facing the camera.
    bot.bar.scale.x = Math.max(0.01, bot.health / 100);
    bot.bar.position.x = -0.25 * (1 - bot.health / 100);
    bot.barBg.lookAt(ctx.camera.position);
    bot.bar.lookAt(ctx.camera.position);
    bot.bar.rotateY(Math.PI);

    if (bot.state === 'engage' && bot.target) {
      const target = bot.target;
      faceToward(bot, target.position.x, target.position.z, dt);
      const dist = bot.position.distanceTo(target.position);
      if (dist > 14) {
        // Too far to duel: close the distance first, still facing the target.
        tmpC.set(target.position.x - bot.position.x, 0, target.position.z - bot.position.z).normalize();
        moveBot(world, bot, tmpC.x * BOT_SPEED * 0.8 * dt, tmpC.z * BOT_SPEED * 0.8 * dt);
        bot.walkPhase += dt * 9;
      } else {
        // Strafe so a duel is not two statues trading shots.
        if (now > bot.strafeAt) {
          bot.strafeAt = now + 0.7 + random() * 0.8;
          bot.strafeDir = random() < 0.5 ? -1 : 1;
        }
        const side = Math.sin(bot.yaw) * bot.strafeDir;
        const fwd = Math.cos(bot.yaw) * bot.strafeDir;
        moveBot(world, bot, side * 1.1 * dt, fwd * 1.1 * dt);
      }
      if (now < bot.reactAt) return; // still reacting to first sight
      if (bot.burstLeft <= 0) {
        bot.burstPause -= dt;
        if (bot.burstPause <= 0) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.burstPause = 0.5 + random() * 0.5;
        }
      } else {
        shootAt(bot, ctx, now);
      }
      return;
    }

    if (bot.state === 'plant') {
      const site = SITES[bot.site];
      bot.progress += dt;
      faceToward(bot, site.center.x, site.center.z, dt);
      if (bot.progress >= PLANT_TIME) {
        bot.progress = 0;
        bot.state = 'push';
        ctx.onPlant(bot, bot.site);
      }
      return;
    }

    if (bot.state === 'defuse') {
      bot.progress += dt;
      if (ctx.cellPosition) faceToward(bot, ctx.cellPosition.x, ctx.cellPosition.z, dt);
      if (bot.progress >= DEFUSE_TIME) {
        bot.progress = 0;
        bot.state = 'hold';
        ctx.onDefuse(bot);
      }
      return;
    }

    if (bot.state === 'hold' || bot.state === 'rotate') {
      if (ctx.planted && bot.team === 'defend') {
        // The cell is down: every defender rotates to the planted site.
        if (bot.state !== 'rotate' || bot.site !== ctx.planted.site) {
          bot.site = ctx.planted.site;
          setPath(bot, SITE_NODES[bot.site]);
          bot.state = 'rotate';
        }
      }
      if (bot.pathIndex < bot.path.length) {
        walkPath(bot, dt);
      } else if (bot.state === 'rotate' && ctx.planted) {
        // Arrived at the planted site: defuse if close to the cell.
        if (ctx.cellPosition && bot.position.distanceTo(ctx.cellPosition) < 2.2) {
          bot.state = 'defuse';
          bot.progress = 0;
        } else {
          setPath(bot, SITE_NODES[bot.site]);
        }
      } else if (bot.state === 'rotate') {
        // Rotated on a false alarm: hold the site just checked.
        bot.state = 'hold';
        bot.holdNode = SITE_NODES[bot.site];
      } else if (bot.state === 'hold' && bot.holdNode === 15) {
        // The mid roamer patrols between mid and the two approaches.
        if (random() < dt * 0.15) setPath(bot, random() < 0.5 ? SITE_APPROACH.A : SITE_APPROACH.B);
      }
      return;
    }

    // push: attackers walk their site path; the carrier plants when the site is clear.
    if (bot.state === 'push') {
      const arrived = walkPath(bot, dt);
      if (arrived && bot.carrier && !ctx.planted) {
        const enemiesNear = bots.some((o) => o.alive && o.team !== bot.team && o.position.distanceTo(bot.position) < 9);
        if (!enemiesNear) {
          bot.state = 'plant';
          bot.progress = 0;
          ctx.onPlantStart(bot, bot.site);
        }
      }
      return;
    }
  }

  function hearNoise(bot, position, radius) {
    if (!bot.alive || bot.state === 'engage' || bot.state === 'plant' || bot.state === 'defuse') return;
    // Attackers hold their push plan; only defenders rotate toward gunfire.
    if (bot.team !== 'defend') return;
    const dist = bot.position.distanceTo(position);
    if (dist > radius) return;
    bot.lastKnown = position.clone();
    bot.lastKnownAt = 0; // fresh memory, but no target: investigate the noise
    const site = Math.abs(position.x + 16) < Math.abs(position.x - 16) ? 'A' : 'B';
    if (bot.site !== site) {
      bot.site = site;
      setPath(bot, SITE_NODES[site]);
      bot.state = 'rotate';
    }
  }

  return {
    bots,
    hitMeshes,
    // The player's shots and grenades only ever meet defenders: no friendly fire.
    enemyHitMeshes: hitMeshes.filter((mesh) => mesh.userData.actor.team === 'defend'),
    enemyBots: bots.filter((b) => b.team === 'defend'),
    assignDefendHolds,
    assignAttackPlan,
    hearNoise,
    update(dt, ctx, now) {
      for (const bot of bots) updateBot(bot, dt, ctx, now);
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    reset(spawns = true) {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const spawn = bot.team === 'attack' ? SPAWNS.attack[i + 1] : SPAWNS.defend[i - 3];
        bot.health = 100;
        bot.alive = true;
        bot.state = bot.team === 'defend' ? 'hold' : 'push';
        bot.mag = bot.weapon.mag;
        bot.cooldown = 0;
        bot.burstLeft = 0;
        bot.progress = 0;
        bot.fall = 0;
        bot.target = null;
        bot.lastKnown = null;
        bot.carrier = false;
        bot.group.rotation.set(0, spawn.yaw, 0);
        bot.yaw = spawn.yaw;
        if (spawns) bot.position.set(spawn.x, 0, spawn.z);
      }
      assignDefendHolds();
    },
  };
}
