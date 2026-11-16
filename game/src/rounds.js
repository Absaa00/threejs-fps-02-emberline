// The round machine: buy phase, live round, plant and fuse, defuse, and the
// economy. First to 5 rounds wins the match (at most 9 rounds). Money: $800 to
// start, $300 a kill, $300 for the plant, $3250 for a round win, $1900 for a loss.
// The machine owns no rendering and no input — it emits events and main.js answers
// them with HUD, sound and bot orders.
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 40;
export const PLANT_SECONDS = 4;
export const DEFUSE_SECONDS = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export const ECONOMY = {
  start: 800,
  kill: 300,
  plant: 300,
  win: 3250,
  loss: 1900,
};

export function createRounds(onEvent) {
  const state = {
    phase: 'idle', // idle | buy | live | ended | match
    round: 0,
    scoreV: 0,
    scoreA: 0,
    money: ECONOMY.start,
    timer: 0,
    planted: null, // { site, position: Vector3-ish {x,z}, fuse }
    plantProgress: 0,
    defuseProgress: 0,
    planting: null, // 'player' | bot id
    defusing: null,
    intermission: 0,
    winner: null,
    reason: '',
    grenades: 0,
  };

  function emit(type, data = {}) {
    onEvent({ type, ...data, state });
  }

  function startMatch() {
    state.round = 0;
    state.scoreV = 0;
    state.scoreA = 0;
    state.money = ECONOMY.start;
    state.grenades = 0;
    state.winner = null;
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.planted = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.planting = null;
    state.defusing = null;
    emit('roundStart', { round: state.round });
  }

  function endRound(winner, reason) {
    if (state.phase === 'ended' || state.phase === 'match') return;
    state.phase = 'ended';
    state.winner = winner;
    state.reason = reason;
    if (winner === 'attack') state.scoreV += 1;
    else state.scoreA += 1;
    state.money += winner === 'attack' ? ECONOMY.win : ECONOMY.loss;
    state.intermission = 4;
    emit('roundEnd', { winner, reason, round: state.round });
    if (state.scoreV >= WIN_ROUNDS || state.scoreA >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'match';
      emit('matchEnd', { winner: state.scoreV > state.scoreA ? 'attack' : 'defend' });
    }
  }

  // A kill pays the killer's side and is reported for the killfeed.
  function registerKill(killerTeam, killerIsPlayer, victimName, killerName) {
    if (killerIsPlayer) state.money += ECONOMY.kill;
    emit('kill', { killerTeam, killerIsPlayer, victimName, killerName });
  }

  function plantComplete(site, position, byPlayer) {
    state.planted = { site, position, fuse: FUSE_SECONDS };
    state.plantProgress = 0;
    state.planting = null;
    if (byPlayer) state.money += ECONOMY.plant;
    emit('planted', { site, byPlayer });
  }

  function defuseComplete(byPlayer) {
    state.planted = null;
    state.defuseProgress = 0;
    state.defusing = null;
    emit('defused', { byPlayer });
    endRound('defend', 'Spark cell defused');
  }

  // Per-frame: timers, fuse, and the round-end conditions the world reports.
  // `world` carries the live facts main.js reads off the scene.
  function update(dt, world) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_SECONDS;
        emit('roundLive');
      }
      return;
    }
    if (state.phase === 'ended') {
      state.intermission -= dt;
      if (state.intermission <= 0 && state.phase !== 'match') startRound();
      return;
    }
    if (state.phase !== 'live') return;

    state.timer -= dt;
    if (state.planted) {
      state.planted.fuse -= dt;
      if (state.planted.fuse <= 0) {
        emit('detonated', { site: state.planted.site });
        state.planted = null;
        endRound('attack', 'Spark cell detonated');
        return;
      }
    }

    // Plant channel: someone standing in a site holding the plant key.
    if (!state.planted && world.planting) {
      state.plantProgress += dt;
      state.planting = world.planting;
      if (state.plantProgress >= PLANT_SECONDS) {
        plantComplete(world.plantSite, world.plantPosition, world.planting === 'player');
      }
    } else if (!world.planting) {
      state.plantProgress = 0;
      state.planting = null;
    }

    // Defuse channel: a defender holding the key by the planted cell.
    if (state.planted && world.defusing) {
      state.defuseProgress += dt;
      state.defusing = world.defusing;
      if (state.defuseProgress >= DEFUSE_SECONDS) defuseComplete(world.defusing === 'player');
    } else if (!world.defusing) {
      state.defuseProgress = 0;
      state.defusing = null;
    }

    if (world.aliveAttack === 0 && world.aliveDefend > 0) {
      endRound('defend', state.planted ? 'Vanguard eliminated' : 'Vanguard eliminated');
      return;
    }
    if (world.aliveDefend === 0 && world.aliveAttack > 0) {
      endRound('attack', 'Ashen eliminated');
      return;
    }
    if (world.aliveAttack === 0 && world.aliveDefend === 0) {
      endRound('defend', 'Both teams down');
      return;
    }
    if (state.timer <= 0 && !state.planted) {
      endRound('defend', 'Time expired — cell never planted');
    }
  }

  function buy(item) {
    if (state.phase !== 'buy') return { ok: false, reason: 'Buy phase is over' };
    if (state.money < item.price) return { ok: false, reason: 'Not enough money' };
    state.money -= item.price;
    emit('buy', { item });
    return { ok: true };
  }

  function buyGrenade() {
    if (state.phase !== 'buy') return { ok: false, reason: 'Buy phase is over' };
    if (state.grenades >= 2) return { ok: false, reason: 'Max 2 grenades' };
    if (state.money < 300) return { ok: false, reason: 'Not enough money' };
    state.money -= 300;
    state.grenades += 1;
    emit('buy', { item: { id: 'grenade', name: 'Spark-9 Frag' } });
    return { ok: true };
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    registerKill,
    plantComplete,
    defuseComplete,
    update,
    buy,
    buyGrenade,
  };
}
