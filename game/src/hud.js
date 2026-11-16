// The DOM HUD: health, ammo, money, timer, round score, killfeed, hit marker,
// plant/defuse progress, the buy menu and the overlay screens. It never touches
// the simulation; main.js pushes numbers in and reads the play/buy callbacks out.
import { WEAPONS, WEAPON_ORDER, GRENADE, GRENADE_MAX } from './weapons.js';

const OVERLAY_COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Kestrel Yard at dusk. Vanguard pushes the spark cell onto Site A or B; Ashen holds. First to 5 rounds takes the yard.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const roundValue = $('round-value');
  const grenadeValue = $('grenade-value');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const progress = $('progress');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const damage = $('damage');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyItems = $('buy-items');
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastHealth = -1;

  // Build the buy menu once from the armoury table.
  for (const id of WEAPON_ORDER) {
    const def = WEAPONS[id];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.buy = id;
    button.innerHTML = `<span class="buy-key">${def.slot}</span><span class="buy-name">${def.name}</span><span class="buy-desc">${def.damage} dmg · ${def.mag} rnd</span><span class="buy-price">${def.price === 0 ? 'FREE' : '$' + def.price}</span>`;
    buyItems.appendChild(button);
  }
  const grenadeButton = document.createElement('button');
  grenadeButton.type = 'button';
  grenadeButton.className = 'buy-item';
  grenadeButton.dataset.buy = 'grenade';
  grenadeButton.innerHTML = `<span class="buy-key">6</span><span class="buy-name">${GRENADE.name}</span><span class="buy-desc">Frag · blast ${GRENADE.radius}m</span><span class="buy-price">$${GRENADE.price}</span>`;
  const grenadePrice = grenadeButton.querySelector('.buy-price');
  buyItems.appendChild(grenadeButton);

  function formatTimer(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      const value = Math.max(0, Math.round(hp));
      if (value === lastHealth) return;
      lastHealth = value;
      healthFill.style.width = `${value}%`;
      healthValue.textContent = String(value);
      healthFill.classList.toggle('low', value <= 30);
    },
    setAmmo(mag, reserve, name, magSize) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      const ammoBox = $('ammo');
      ammoBox.classList.toggle('empty', mag === 0);
      // Warn while the magazine runs low (a quarter or less left), so the player
      // reloads before the fight, not during it.
      ammoBox.classList.toggle('low', mag > 0 && magSize > 0 && mag <= Math.ceil(magSize / 4));
    },
    setMoney(value) {
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      timerValue.textContent = formatTimer(seconds);
      timerValue.classList.toggle('buy', phase === 'buy');
    },
    setScore(v, a, round) {
      scoreValue.textContent = `${v} — ${a}`;
      roundValue.textContent = `ROUND ${round}`;
    },
    setGrenades(n) {
      grenadeValue.textContent = `◉ ×${n}`;
    },
    killfeed(text, friendly) {
      const line = document.createElement('div');
      line.className = `feed-line${friendly ? ' friendly' : ''}`;
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
      setTimeout(() => line.remove(), 5000);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showProgress(label, frac) {
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
    hideProgress() {
      progress.hidden = true;
    },
    showBuy(open, money, owned, grenades = 0) {
      buyMenu.hidden = !open;
      buyMoney.textContent = `$${money}`;
      for (const button of buyItems.querySelectorAll('.buy-item')) {
        const id = button.dataset.buy;
        if (id === 'grenade') {
          // The grenade row used to stay clickable at the 2-grenade cap (and
          // when broke), failing only on click with a banner. Grey it out
          // up front instead, and say MAX when the loadout is full.
          const capped = grenades >= GRENADE_MAX;
          const afford = money >= GRENADE.price;
          button.classList.toggle('owned', capped);
          button.disabled = capped || !afford;
          grenadePrice.textContent = capped ? 'MAX' : `$${GRENADE.price}`;
          continue;
        }
        const ownedAlready = Boolean(owned[id]);
        button.classList.toggle('owned', ownedAlready);
        button.disabled = ownedAlready;
      }
    },
    showOverlay(mode, data = {}) {
      if (mode === 'roundEnd') {
        title.textContent = data.winner === 'attack' ? 'ROUND TO VANGUARD' : 'ROUND TO ASHEN';
        copy.textContent = `${data.reason}. Vanguard ${data.scoreV} — ${data.scoreA} Ashen. Next round starts shortly.`;
        play.textContent = 'Continue';
      } else if (mode === 'matchEnd') {
        title.textContent = data.winner === 'attack' ? 'VANGUARD TAKES THE YARD' : 'ASHEN HOLDS THE YARD';
        copy.textContent = `Final score: Vanguard ${data.scoreV} — ${data.scoreA} Ashen.`;
        play.textContent = 'Play again';
      } else {
        const text = OVERLAY_COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyItems.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (button && !button.disabled) handler(button.dataset.buy);
      });
    },
  };
}
