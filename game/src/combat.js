// Combat: hitscan shots, tracers, wall impacts and frag grenades. One raycaster is
// reused for every shot; tracers and impacts are a small pool of fading meshes so a
// firefight allocates nothing. A shot is decided by the nearest thing the ray meets:
// a bot's head or torso, or the world. Grenades are real projectiles with gravity,
// a bounce off the colliders and a radial blast.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { damageAtRange } from './weapons.js';

const TRACER_LIFE = 0.07;
const IMPACT_LIFE = 0.25;
const POOL = 24;

export function createCombat(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const direction = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();

  // Tracer pool: thin amber lines from muzzle to impact, fading fast.
  const tracers = [];
  for (let i = 0; i < POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
    );
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // Impact pool: small rust sparks where a bullet stops on the world.
  const impacts = [];
  const impactGeometry = new THREE.PlaneGeometry(0.14, 0.14);
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(
      impactGeometry,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, life: 0 });
  }
  let impactCursor = 0;

  function spawnTracer(from, to) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % POOL;
    const positions = slot.line.geometry.attributes.position.array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.material.opacity = 0.85;
    slot.line.visible = true;
    slot.life = TRACER_LIFE;
  }

  function spawnImpact(point, normal) {
    const slot = impacts[impactCursor];
    impactCursor = (impactCursor + 1) % POOL;
    slot.mesh.position.copy(point);
    if (normal) slot.mesh.lookAt(point.clone().add(normal));
    slot.mesh.material.opacity = 0.9;
    slot.mesh.visible = true;
    slot.life = IMPACT_LIFE;
  }

  // One hitscan shot. `hittables` are meshes with userData { actor, part } where
  // actor exposes damage(amount, part, attacker). Returns the first hit, if any.
  function fireShot(from, aimDir, def, random, hittables) {
    let result = null;
    for (let pellet = 0; pellet < def.pellets; pellet += 1) {
      direction.copy(aimDir);
      direction.x += (random() * 2 - 1) * def.spread;
      direction.y += (random() * 2 - 1) * def.spread;
      direction.z += (random() * 2 - 1) * def.spread;
      direction.normalize();
      origin.copy(from);
      raycaster.set(origin, direction);
      const targets = world.shootables.concat(hittables);
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (!hit) {
        hitPoint.copy(from).addScaledVector(direction, 60);
        spawnTracer(from, hitPoint);
        continue;
      }
      hitPoint.copy(hit.point);
      spawnTracer(from, hitPoint);
      const actor = hit.object.userData.actor;
      if (actor) {
        const part = hit.object.userData.part || 'torso';
        const base = damageAtRange(def, hit.distance);
        const amount = Math.round(base * (part === 'head' ? def.headMult : 1));
        const killed = actor.damage(amount, part, def);
        result = { hit: true, killed, part, amount, distance: hit.distance, point: hitPoint.clone(), actor };
      } else {
        spawnImpact(hitPoint, hit.face ? hit.face.normal : null);
        result = result || { hit: false, point: hitPoint.clone(), distance: hit.distance };
      }
    }
    return result;
  }

  // Line of sight between two points: clear when no world mesh blocks the segment.
  function hasLineOfSight(from, to) {
    direction.copy(to).sub(from);
    const distance = direction.length();
    if (distance < 0.01) return true;
    direction.normalize();
    raycaster.set(from, direction);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    raycaster.far = 90;
    return !hit;
  }

  // Frag grenades: thrown, bounced, then a blast that hurts every actor in radius.
  const grenades = [];
  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.4, metalness: 0.5 });
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14, 1.5);
  scene.add(blastLight);
  let blastFlash = 0;

  function throwGrenade(from, velocity) {
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
    mesh.position.copy(from);
    scene.add(mesh);
    grenades.push({ mesh, velocity: velocity.clone(), fuse: 1.6, bounced: 0 });
    return true;
  }

  function explode(grenade, actors, onDamage) {
    const center = grenade.mesh.position.clone();
    scene.remove(grenade.mesh);
    blastLight.position.copy(center).y += 0.5;
    blastLight.intensity = 60;
    blastFlash = 0.18;
    for (const actor of actors) {
      if (!actor.alive) continue;
      const d = actor.position.distanceTo(center);
      if (d > 5.5) continue;
      const amount = Math.round(95 * (1 - (d / 5.5) * 0.7));
      onDamage(actor, amount, 'blast');
    }
    return center;
  }

  function stepGrenades(dt, actors, onDamage) {
    let explodedAt = null;
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.velocity.y -= 14 * dt;
      const next = g.mesh.position.clone().addScaledVector(g.velocity, dt);
      // Axis-separated bounce against the world boxes; floor at y = 0.09.
      let bounced = false;
      const probe = new THREE.Box3();
      probe.min.set(next.x - 0.09, next.y - 0.09, next.z - 0.09);
      probe.max.set(next.x + 0.09, next.y + 0.09, next.z + 0.09);
      for (const box of world.colliders) {
        if (!probe.intersectsBox(box)) continue;
        const dx = Math.min(Math.abs(next.x - box.min.x), Math.abs(next.x - box.max.x));
        const dz = Math.min(Math.abs(next.z - box.min.z), Math.abs(next.z - box.max.z));
        if (dx < dz) g.velocity.x *= -0.45;
        else g.velocity.z *= -0.45;
        bounced = true;
        break;
      }
      if (bounced) g.bounced += 1;
      else g.mesh.position.copy(next);
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) > 1.2 ? -g.velocity.y * 0.45 : 0;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      if (g.fuse <= 0) {
        explodedAt = explode(g, actors, onDamage);
        grenades.splice(i, 1);
      }
    }
    return explodedAt;
  }

  function step(dt) {
    for (const slot of tracers) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.line.material.opacity = Math.max(0, slot.life / TRACER_LIFE) * 0.85;
      if (slot.life <= 0) slot.line.visible = false;
    }
    for (const slot of impacts) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.mesh.material.opacity = Math.max(0, slot.life / IMPACT_LIFE) * 0.9;
      slot.mesh.scale.setScalar(1 + (1 - Math.max(0, slot.life / IMPACT_LIFE)) * 1.5);
      if (slot.life <= 0) slot.mesh.visible = false;
    }
    if (blastFlash > 0) {
      blastFlash -= dt;
      blastLight.intensity = Math.max(0, blastFlash / 0.18) * 60;
    }
  }

  // A traced shot for bots: raycast the world only, draw the tracer, and report
  // where the bullet stopped. The caller decides the hit roll against its target.
  function trace(from, dir, maxDistance) {
    direction.copy(dir).normalize();
    raycaster.set(from, direction);
    raycaster.far = maxDistance;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    raycaster.far = 90;
    if (hit) {
      hitPoint.copy(hit.point);
      spawnTracer(from, hitPoint);
      spawnImpact(hitPoint, hit.face ? hit.face.normal : null);
      return { hit: true, distance: hit.distance, point: hitPoint.clone() };
    }
    hitPoint.copy(from).addScaledVector(direction, maxDistance);
    spawnTracer(from, hitPoint);
    return { hit: false, distance: maxDistance, point: hitPoint.clone() };
  }

  return {
    fireShot,
    trace,
    hasLineOfSight,
    throwGrenade,
    stepGrenades,
    step,
    reset() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
      for (const slot of tracers) {
        slot.life = 0;
        slot.line.visible = false;
      }
      for (const slot of impacts) {
        slot.life = 0;
        slot.mesh.visible = false;
      }
    },
  };
}
