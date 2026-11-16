// The armoury: five original weapons plus a frag grenade. Each entry owns its
// numbers — damage, headshot multiplier, fire rate, magazine, reload, spread,
// range and falloff — so the buy menu, the view model and combat all read one table.
// Prices are the economy; the P9 sidearm is free and always owned.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 3.0,
    fireGap: 0.16, auto: false, mag: 15, reserve: 45, reloadTime: 1.1,
    spread: 0.006, moveSpread: 0.02, range: 28, falloff: 0.45, pellets: 1,
    kick: 0.006, barrel: 0.22, slot: 1,
  },
  vk7: {
    id: 'vk7', name: 'VK-7 Carbine', price: 2700, damage: 33, headMult: 3.2,
    fireGap: 0.096, auto: true, mag: 30, reserve: 90, reloadTime: 1.9,
    spread: 0.0022, moveSpread: 0.028, range: 40, falloff: 0.5, pellets: 1,
    kick: 0.009, barrel: 0.42, slot: 2,
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9 SMG', price: 1500, damage: 24, headMult: 3.0,
    fireGap: 0.075, auto: true, mag: 32, reserve: 96, reloadTime: 1.6,
    spread: 0.006, moveSpread: 0.03, range: 22, falloff: 0.4, pellets: 1,
    kick: 0.006, barrel: 0.3, slot: 3,
  },
  breacher: {
    id: 'breacher', name: 'Breacher-12 Shotgun', price: 1200, damage: 13, headMult: 2.0,
    fireGap: 0.85, auto: false, mag: 6, reserve: 24, reloadTime: 2.6,
    spread: 0.03, moveSpread: 0.02, range: 14, falloff: 0.3, pellets: 8,
    kick: 0.03, barrel: 0.38, slot: 4,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', price: 4750, damage: 78, headMult: 3.5,
    fireGap: 0.9, auto: false, mag: 8, reserve: 24, reloadTime: 2.4,
    spread: 0.0008, moveSpread: 0.04, range: 60, falloff: 0.7, pellets: 1,
    kick: 0.02, barrel: 0.62, slot: 5,
  },
};

export const WEAPON_ORDER = ['p9', 'vk7', 'hornet', 'breacher', 'longbow'];

export const GRENADE = {
  id: 'grenade', name: 'Spark-9 Frag', price: 300,
  damage: 95, radius: 5.5, fuse: 1.6, slot: 6,
};

// Damage at a distance: full inside half the range, then a straight fall to the
// falloff floor at full range, and the floor beyond it.
export function damageAtRange(def, distance) {
  if (distance <= def.range * 0.5) return def.damage;
  const t = Math.min(1, (distance - def.range * 0.5) / (def.range * 0.5));
  return def.damage * (1 - t * (1 - def.falloff));
}

export function createWeaponSet(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const owned = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
  let currentId = 'p9';
  const state = { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, grenades: 0 };

  function buildModel(def) {
    while (model.children.length) {
      const child = model.children.pop();
      if (child.geometry) child.geometry.dispose();
    }
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.3 + def.barrel * 0.4), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.2 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.26);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), def.id === 'longbow' ? accent : grip);
    sight.position.set(0, 0.075, -0.05);
    model.add(receiver, barrel, stock, sight);
    if (def.pellets > 1) {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.16), accent);
      pump.position.set(0, -0.03, -0.28);
      model.add(pump);
    }
    flash.position.z = -0.55 - def.barrel;
  }
  buildModel(WEAPONS.p9);

  function def() {
    return WEAPONS[currentId];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    const d = def();
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (d.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        owned[currentId] = { mag: state.mag, reserve: state.reserve };
      }
    }
  }

  return {
    state,
    owned,
    current() {
      return currentId;
    },
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = 0.055 + def().kick * 2;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      owned[currentId].mag = state.mag;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return false;
      state.reloadLeft = d.reloadTime;
      return true;
    },
    spread(speed) {
      const d = def();
      return d.spread + Math.min(1, speed / 5.2) * d.moveSpread;
    },
    // Buy a weapon: keeps the old one's ammo on the shelf, loads the new one.
    buy(id) {
      const d = WEAPONS[id];
      if (!d || owned[id]) return false;
      owned[id] = { mag: d.mag, reserve: d.reserve };
      this.switchTo(id);
      return true;
    },
    switchTo(id) {
      if (!owned[id] || id === currentId) return false;
      owned[currentId] = { mag: state.mag, reserve: state.reserve };
      currentId = id;
      state.mag = owned[id].mag;
      state.reserve = owned[id].reserve;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      buildModel(def());
      return true;
    },
    refill() {
      for (const id of Object.keys(owned)) {
        owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      }
      state.mag = owned[currentId].mag;
      state.reserve = owned[currentId].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    resetLoadout() {
      for (const id of Object.keys(owned)) delete owned[id];
      owned.p9 = { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve };
      currentId = 'p9';
      state.mag = WEAPONS.p9.mag;
      state.reserve = WEAPONS.p9.reserve;
      state.grenades = 0;
      state.reloadLeft = 0;
      state.cooldown = 0;
      buildModel(WEAPONS.p9);
    },
    takeGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
  };
}
