import { RANKS, SUITS, SUIT_SYMBOLS, SUIT_COLORS, makeCard, cardCode, cardLabel, fullDeck } from './cards.js';
import { calculateEquity } from './equity.js';
import { estimateRange, formatHandList, LINE_LABEL, HAND_STRENGTH, combosFromHands, sortHandsByStrength } from './range.js';
import { equityVsRange, decideAction, buildRaisePlan } from './decision.js';
import {
  seatsForTable,
  villainPosWidthMult,
  villainPosStrengthBias,
  positionalEquityAdjust,
  clamp01,
  formatSeatLabel,
  defaultHeroPos,
  defaultVillainPos,
  SITUATION_DEFAULTS,
  BET_SIZES,
  potFromSize,
} from './position.js';
import {
  isPro,
  unlockPro,
  downgradeToFree,
  PRO_PRICE_LABEL,
  PRO_FEATURES,
} from './premium.js';
import { maybeShowAdAfterCalc, calcsUntilNextAd, AD_EVERY_N } from './ads.js';
import {
  redeemInviteCode,
  clearInviteState,
} from './invite.js';
import { listProfiles, saveProfile, deleteProfile, getProfile } from './villainProfiles.js';
import {
  applyPublisherUi,
  setupAgeGate,
  redeemInviteForStore,
  purchasePro,
  restorePro,
  isAppStoreBuild,
  resetLocalTestState,
  syncProFromStore,
  resolveProPriceLabel,
} from './compliance.js';
import { IAP, ALLOW_TEST_PRO } from './storeConfig.js';
import {
  LINE_BET_SIZES,
  STREETS,
  ACTION_KINDS,
  createLineState,
  uid,
  simulateLine,
  amountFromPotPercent,
  amountAllIn,
  inferLineTag,
  inferPrimaryVillain,
  formatActionLine,
  multiwayNote,
} from './lineLab.js';

/** ペイウォール表示用（Store価格で上書きされうる） */
let paywallPriceLabel = PRO_PRICE_LABEL || IAP.priceLabel;

const MAX_PLAYERS = 6;
const EQUITY_ITERS = 35000;
const RANGE_ITERS = 18000;

/* ---------------- shared card UI ---------------- */

function renderCardFace(card, emptyLabel = '') {
  if (!card) return `<span class="card card--empty">${emptyLabel}</span>`;
  const suit = SUITS[card.suit];
  const color = SUIT_COLORS[suit];
  return `<span class="card card--${color}" data-code="${cardCode(card)}">
    <span class="card__rank">${RANKS[card.rank]}</span>
    <span class="card__suit">${SUIT_SYMBOLS[suit]}</span>
  </span>`;
}

function renderPicker(el, used, onPick) {
  el.classList.add('picker');
  // スートは左ラベルのみ。ボタンはランクだけにして枠に収める
  el.innerHTML = SUITS.map((suit, s) => {
    const color = SUIT_COLORS[suit];
    return `<div class="picker__row picker__row--${color}">
      <span class="picker__suit" aria-hidden="true">${SUIT_SYMBOLS[suit]}</span>
      <div class="picker__cards">
      ${RANKS.map((rank, r) => {
        const id = s * 13 + r;
        const disabled = used.has(id);
        return `<button type="button" class="picker__card card--${color}" title="${rank}${SUIT_SYMBOLS[suit]}" aria-label="${rank}${SUIT_SYMBOLS[suit]}" data-rank="${r}" data-suit="${s}" ${disabled ? 'disabled' : ''}>${rank}</button>`;
      }).join('')}
      </div>
    </div>`;
  }).join('');

  el.onclick = (e) => {
    const btn = e.target.closest('.picker__card');
    if (!btn || btn.disabled) return;
    onPick(Number(btn.dataset.rank), Number(btn.dataset.suit));
  };
}

/** 未使用カードから1枚ランダム */
function pickRandomCard(used) {
  const pool = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 0; r < 13; r++) {
      const c = makeCard(r, s);
      if (!used.has(c.id)) pool.push(c);
    }
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function formatPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function formatEV(x) {
  const sign = x >= 0 ? '+' : '';
  return `${sign}${x.toFixed(1)}`;
}

/* ---------------- tabs ---------------- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    const name = tab.dataset.tab;
    document.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === `panel-${name}`;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
  });
});

/* ============================================================
   TAB 1: Equity calculator (既存)
   ============================================================ */

const eq = {
  playerCount: 2,
  hands: [
    [null, null],
    [null, null],
  ],
  board: [null, null, null, null, null],
  activeSlot: { type: 'hole', player: 0, index: 0 },
  results: null,
  busy: false,
};

const eqEls = {
  board: document.getElementById('board'),
  players: document.getElementById('players'),
  picker: document.getElementById('picker'),
  status: document.getElementById('status'),
  calculate: document.getElementById('btn-calculate'),
  reset: document.getElementById('btn-reset'),
  addPlayer: document.getElementById('btn-add-player'),
  removePlayer: document.getElementById('btn-remove-player'),
};

function eqUsed() {
  const ids = new Set();
  for (const h of eq.hands) for (const c of h) if (c) ids.add(c.id);
  for (const c of eq.board) if (c) ids.add(c.id);
  return ids;
}

function eqIsActive(type, index, player) {
  const a = eq.activeSlot;
  if (!a || a.type !== type || a.index !== index) return false;
  return type === 'hole' ? a.player === player : true;
}

function eqRenderBoard() {
  const labels = ['フロップ', '', '', 'ターン', 'リバー'];
  eqEls.board.innerHTML = eq.board
    .map((card, i) => {
      const active = eqIsActive('board', i) ? ' is-active' : '';
      const empty = i < 3 ? (i === 0 ? 'Flop' : '') : i === 3 ? 'Turn' : 'River';
      return `<button type="button" class="slot${active}" data-index="${i}">
        ${renderCardFace(card, empty)}
        <span class="slot__label">${labels[i] || '&nbsp;'}</span>
      </button>`;
    })
    .join('');
}

function eqPlayerLabel(p) {
  if (p === 0) return '自分';
  if (eq.playerCount === 2) return '相手';
  const full = String(p).replace(/\d/g, (d) => '０１２３４５６７８９'[Number(d)]);
  return `相手${full}`;
}

function eqRenderPlayers() {
  const results = eq.results;
  eqEls.players.innerHTML = eq.hands
    .map((hand, p) => {
      const win = results ? formatPct(results.wins[p]) : '—';
      const tie = results ? formatPct(results.ties[p]) : '—';
      const equity = results ? formatPct(results.equity[p]) : '—';
      const bar = results ? Math.round(results.equity[p] * 100) : 0;
      return `<article class="player">
        <header class="player__head">
          <h2>${eqPlayerLabel(p)}</h2>
          <div class="player__stats">
            <div class="stat--win"><span class="stat__val">${win}</span><span class="stat__lab">勝ち</span></div>
            <div><span class="stat__val">${tie}</span><span class="stat__lab">引分</span></div>
            <div><span class="stat__val">${equity}</span><span class="stat__lab">エクイティ</span></div>
          </div>
        </header>
        <div class="player__bar"><i style="width:${bar}%"></i></div>
        <div class="player__cards">
          ${hand
            .map(
              (card, i) =>
                `<button type="button" class="slot${eqIsActive('hole', i, p) ? ' is-active' : ''}" data-player="${p}" data-index="${i}">
                  ${renderCardFace(card, '穴札')}
                </button>`
            )
            .join('')}
        </div>
      </article>`;
    })
    .join('');
}

function eqAdvance() {
  const a = eq.activeSlot;
  if (!a) return;
  if (a.type === 'hole') {
    if (a.index === 0) {
      eq.activeSlot = { type: 'hole', player: a.player, index: 1 };
      return;
    }
    if (a.player + 1 < eq.playerCount) {
      eq.activeSlot = { type: 'hole', player: a.player + 1, index: 0 };
      return;
    }
    eq.activeSlot = { type: 'board', index: 0 };
    return;
  }
  eq.activeSlot = a.index < 4 ? { type: 'board', index: a.index + 1 } : null;
}

function eqPlace(rank, suit) {
  if (!eq.activeSlot) {
    for (let p = 0; p < eq.playerCount; p++) {
      for (let i = 0; i < 2; i++) {
        if (!eq.hands[p][i]) {
          eq.activeSlot = { type: 'hole', player: p, index: i };
          break;
        }
      }
      if (eq.activeSlot) break;
    }
    if (!eq.activeSlot) {
      for (let i = 0; i < 5; i++) {
        if (!eq.board[i]) {
          eq.activeSlot = { type: 'board', index: i };
          break;
        }
      }
    }
  }
  if (!eq.activeSlot) return;
  const card = makeCard(rank, suit);
  if (eqUsed().has(card.id)) return;
  const a = eq.activeSlot;
  if (a.type === 'hole') eq.hands[a.player][a.index] = card;
  else eq.board[a.index] = card;
  eq.results = null;
  eqAdvance();
  eqRender();
  const ready = eq.hands.filter((h) => h[0] && h[1]).length >= 2;
  if (ready) eqCalculate();
}

function eqRender() {
  eqRenderBoard();
  eqRenderPlayers();
  renderPicker(eqEls.picker, eqUsed(), eqPlace);
  eqEls.addPlayer.disabled = eq.playerCount >= MAX_PLAYERS;
  eqEls.removePlayer.disabled = eq.playerCount <= 2;
}

function eqSetStatus(msg, isError = false) {
  eqEls.status.textContent = msg;
  eqEls.status.classList.toggle('is-error', isError);
}

async function eqCalculate() {
  if (eq.busy) return;
  const hands = [];
  const activeIndexes = [];
  eq.hands.forEach((h, i) => {
    if (h[0] && h[1]) {
      hands.push(h);
      activeIndexes.push(i);
    }
  });
  if (hands.length < 2) {
    eqSetStatus('自分と相手のハンドを入れてください（2人以上）', true);
    return;
  }

  let boardCount = 0;
  for (let i = 0; i < 5; i++) if (eq.board[i]) boardCount = i + 1;
  for (let i = 0; i < boardCount; i++) {
    if (!eq.board[i]) {
      eqSetStatus('ボードは左から順に入れてください', true);
      return;
    }
  }
  if (boardCount === 1 || boardCount === 2) {
    eqSetStatus('フロップは3枚まとめて入れてください', true);
    return;
  }

  eq.busy = true;
  eqEls.calculate.disabled = true;
  eqSetStatus('計算中…');
  await new Promise((r) => setTimeout(r, 20));

  try {
    const partial = calculateEquity(hands, eq.board.slice(), EQUITY_ITERS);
    const full = {
      wins: eq.hands.map(() => 0),
      ties: eq.hands.map(() => 0),
      equity: eq.hands.map(() => 0),
      iterations: partial.iterations,
    };
    activeIndexes.forEach((pi, j) => {
      full.wins[pi] = partial.wins[j];
      full.ties[pi] = partial.ties[j];
      full.equity[pi] = partial.equity[j];
    });
    eq.results = full;
    eqSetStatus('計算完了');
    eqRender();
    void maybeShowAdAfterCalc().then(() => updateAdHint());
  } catch (err) {
    eqSetStatus(err.message || String(err), true);
  } finally {
    eq.busy = false;
    eqEls.calculate.disabled = false;
  }
}

function eqReset() {
  eq.hands = Array.from({ length: eq.playerCount }, () => [null, null]);
  eq.board = [null, null, null, null, null];
  eq.activeSlot = { type: 'hole', player: 0, index: 0 };
  eq.results = null;
  eqSetStatus('カードを選んでください');
  eqRender();
}

/** 自分・相手など穴札が2人分以上揃っているか */
function eqHoleCardsReady() {
  return eq.hands.filter((h) => h[0] && h[1]).length >= 2;
}

/** 配布直後など：穴札が揃っていれば自動計算（計算中なら完了後に再実行／広告カウント含む） */
function eqMaybeAutoCalculate() {
  if (!eqHoleCardsReady()) return;
  const tryRun = () => {
    if (!eqHoleCardsReady()) return;
    if (eq.busy) {
      setTimeout(tryRun, 40);
      return;
    }
    void eqCalculate();
  };
  // 描画を先に反映してから計算
  setTimeout(tryRun, 0);
}

/** フロップ3枚をまとめて生成（ターン・リバーはクリア） */
function eqDealFlopThree() {
  eq.board[0] = null;
  eq.board[1] = null;
  eq.board[2] = null;
  eq.board[3] = null;
  eq.board[4] = null;
  const used = eqUsed();
  const dealt = [];
  for (let i = 0; i < 3; i++) {
    const c = pickRandomCard(used);
    if (!c) {
      eqSetStatus('残りのカードがありません', true);
      eqRender();
      return;
    }
    eq.board[i] = c;
    used.add(c.id);
    dealt.push(cardLabel(c));
  }
  eq.results = null;
  eq.activeSlot = { type: 'board', index: 3 };
  eqSetStatus(`フロップ ${dealt.join(' ')}`);
  eqRender();
  eqMaybeAutoCalculate();
}

/** ターン（3）に1枚。フロップ完成が条件 */
function eqDealTurnOne() {
  if (!eq.board[0] || !eq.board[1] || !eq.board[2]) {
    eqSetStatus('先にフロップを3枚揃えてください', true);
    return;
  }
  if (eq.board[3]) {
    eqSetStatus('ターンはすでに配られています', true);
    return;
  }
  const c = pickRandomCard(eqUsed());
  if (!c) {
    eqSetStatus('残りのカードがありません', true);
    return;
  }
  eq.board[3] = c;
  eq.results = null;
  eq.activeSlot = { type: 'board', index: 4 };
  eqSetStatus(`ターンに ${cardLabel(c)} を配布`);
  eqRender();
  eqMaybeAutoCalculate();
}

/** リバー（4）に1枚。ターン完成が条件 */
function eqDealRiverOne() {
  if (!eq.board[0] || !eq.board[1] || !eq.board[2]) {
    eqSetStatus('先にフロップを3枚揃えてください', true);
    return;
  }
  if (!eq.board[3]) {
    eqSetStatus('先にターンを配ってください', true);
    return;
  }
  if (eq.board[4]) {
    eqSetStatus('リバーはすでに配られています', true);
    return;
  }
  const c = pickRandomCard(eqUsed());
  if (!c) {
    eqSetStatus('残りのカードがありません', true);
    return;
  }
  eq.board[4] = c;
  eq.results = null;
  eq.activeSlot = null;
  eqSetStatus(`リバーに ${cardLabel(c)} を配布`);
  eqRender();
  eqMaybeAutoCalculate();
}

eqEls.board.addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  const index = Number(slot.dataset.index);
  if (eq.board[index]) {
    eq.board[index] = null;
    eq.results = null;
    eq.activeSlot = { type: 'board', index };
  } else eq.activeSlot = { type: 'board', index };
  eqRender();
});

eqEls.players.addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  const player = Number(slot.dataset.player);
  const index = Number(slot.dataset.index);
  if (eq.hands[player][index]) {
    eq.hands[player][index] = null;
    eq.results = null;
    eq.activeSlot = { type: 'hole', player, index };
  } else eq.activeSlot = { type: 'hole', player, index };
  eqRender();
});

eqEls.calculate.addEventListener('click', () => eqCalculate());
eqEls.reset.addEventListener('click', () => eqReset());
document.getElementById('btn-eq-deal-flop')?.addEventListener('click', () => eqDealFlopThree());
document.getElementById('btn-eq-deal-turn')?.addEventListener('click', () => eqDealTurnOne());
document.getElementById('btn-eq-deal-river')?.addEventListener('click', () => eqDealRiverOne());
eqEls.addPlayer.addEventListener('click', () => {
  if (!isPro() && eq.playerCount >= 2) {
    openPaywall();
    return;
  }
  if (eq.playerCount >= MAX_PLAYERS) return;
  eq.playerCount++;
  eq.hands.push([null, null]);
  eq.results = null;
  eq.activeSlot = { type: 'hole', player: eq.playerCount - 1, index: 0 };
  eqRender();
});
eqEls.removePlayer.addEventListener('click', () => {
  if (eq.playerCount <= 2) return;
  eq.playerCount--;
  eq.hands.pop();
  eq.results = null;
  eq.activeSlot = { type: 'hole', player: 0, index: 0 };
  eqRender();
});

eqReset();

/* ============================================================
   TAB 2: Action advisor
   ============================================================ */

const adv = {
  hero: [null, null],
  board: [null, null, null, null, null],
  activeSlot: { type: 'hero', index: 0 },
  busy: false,
  /** @type {Set<string>} */
  selectedHands: new Set(),
  lastEstimateHands: [],
  sizeKey: SITUATION_DEFAULTS.sizeKey,
  /** true のとき倍率より数値直指定を優先 */
  customPot: false,
};

const advEls = {
  hero: document.getElementById('adv-hero'),
  board: document.getElementById('adv-board'),
  picker: document.getElementById('adv-picker'),
  potBase: document.getElementById('adv-pot-base'),
  pot: document.getElementById('adv-pot'),
  bet: document.getElementById('adv-bet'),
  sizeButtons: document.getElementById('adv-size-buttons'),
  sizeSummary: document.getElementById('adv-size-summary'),
  players: document.getElementById('adv-players'),
  tableTend: document.getElementById('adv-table-tend'),
  heroPos: document.getElementById('adv-hero-pos'),
  villainPos: document.getElementById('adv-villain-pos'),
  villainName: document.getElementById('adv-villain-name'),
  profileSelect: document.getElementById('adv-profile-select'),
  rangeProfileSelect: document.getElementById('range-profile-select'),
  style: document.getElementById('adv-style'),
  line: document.getElementById('adv-line'),
  raise: document.getElementById('adv-raise'),
  oddsHint: document.getElementById('adv-odds-hint'),
  status: document.getElementById('adv-status'),
  rangeStatus: document.getElementById('range-status'),
  result: document.getElementById('adv-result'),
  run: document.getElementById('btn-advise'),
  reset: document.getElementById('btn-adv-reset'),
  rangeGrid: document.getElementById('range-grid'),
  rangeCount: document.getElementById('range-count'),
};

function advUsed() {
  const ids = new Set();
  for (const c of adv.hero) if (c) ids.add(c.id);
  for (const c of adv.board) if (c) ids.add(c.id);
  return ids;
}

function advActive(type, index) {
  return adv.activeSlot?.type === type && adv.activeSlot?.index === index;
}

function resolveSituation() {
  const d = SITUATION_DEFAULTS;
  const pro = isPro();

  let players = Number(advEls.players.value);
  if (!Number.isFinite(players) || advEls.players.value === '') players = d.players;
  players = Math.min(9, Math.max(2, Math.round(players)));

  let potBase = Number(advEls.potBase?.value);
  if (!Number.isFinite(potBase) || potBase <= 0 || advEls.potBase?.value === '') {
    potBase = d.potBase;
  }

  let pot;
  let bet;
  let sizeKey = adv.sizeKey || d.sizeKey;
  let sizeLabel = '';

  if (adv.customPot) {
    pot = Number(advEls.pot.value);
    bet = Number(advEls.bet.value);
    if (!Number.isFinite(pot) || pot <= 0) pot = potBase + Math.round(potBase * 0.5);
    if (!Number.isFinite(bet) || bet <= 0) bet = Math.round(potBase * 0.5);
    if (bet >= pot) bet = Math.max(1, Math.round(pot / 3));
    sizeLabel = 'カスタム';
    sizeKey = 'custom';
  } else {
    const sized = potFromSize(potBase, sizeKey);
    pot = sized.pot;
    bet = sized.bet;
    sizeKey = sized.sizeKey;
    sizeLabel = sized.sizeLabel;
    if (advEls.pot) advEls.pot.value = String(pot);
    if (advEls.bet) advEls.bet.value = String(bet);
  }

  let heroPos = advEls.heroPos.value;
  let villainPos = advEls.villainPos.value;
  let style = advEls.style.value;
  let line = advEls.line.value;
  let tableTend = advEls.tableTend?.value || d.tableTend;

  if (!pro) {
    heroPos = 'auto';
    villainPos = 'auto';
    style = 'auto';
    line = 'auto';
    tableTend = 'auto';
  }

  if (!heroPos || heroPos === 'auto') heroPos = defaultHeroPos(players);
  if (!villainPos || villainPos === 'auto') villainPos = defaultVillainPos(players);
  if (heroPos === villainPos) {
    villainPos = defaultVillainPos(players);
    if (heroPos === villainPos) {
      const seats = seatsForTable(players);
      villainPos = seats.find((s) => s.id !== heroPos)?.id || heroPos;
    }
  }

  if (!style || style === 'auto') style = d.style;
  if (!line || line === 'auto') line = d.line;
  if (!tableTend || tableTend === 'auto') tableTend = d.tableTend;

  return {
    players,
    pot,
    bet,
    potBase,
    sizeKey,
    sizeLabel,
    heroPos,
    villainPos,
    style,
    line,
    tableTend,
    pro,
  };
}

function renderSizeButtons() {
  if (!advEls.sizeButtons) return;
  advEls.sizeButtons.innerHTML = BET_SIZES.map(
    (s) =>
      `<button type="button" class="size-btn${adv.sizeKey === s.key && !adv.customPot ? ' is-on' : ''}" data-size="${s.key}">${s.label}</button>`
  ).join('');
}

function syncSizeSummary() {
  const s = resolveSituation();
  if (advEls.sizeSummary) {
    advEls.sizeSummary.textContent = `サイズ: ${s.sizeLabel} → コール ${s.bet} / ベット込みポット ${s.pot}（元ポット ${s.potBase}）`;
  }
  renderSizeButtons();
}

function advUpdateOddsHint() {
  const s = resolveSituation();
  const posAdj = positionalEquityAdjust(s.heroPos, s.villainPos, s.players);
  const potBefore = Math.max(1, s.pot - s.bet);
  const frac = s.bet / potBefore;
  const req = s.bet / (s.pot + s.bet);
  const usedDefaults =
    advEls.heroPos.value === 'auto' ||
    advEls.villainPos.value === 'auto' ||
    advEls.style.value === 'auto' ||
    advEls.line.value === 'auto' ||
    (advEls.tableTend && advEls.tableTend.value === 'auto');

  syncSizeSummary();

  if (!s.pro) {
    advEls.oddsHint.textContent =
      `${s.sizeLabel}（約${(frac * 100).toFixed(0)}%）→ 必要勝率 ${formatPct(req)}` +
      (!adv.customPot ? '（一般値あり）' : '');
    return;
  }

  advEls.oddsHint.textContent =
    `${s.players}人 · ${s.sizeLabel}（約${(frac * 100).toFixed(0)}%）→ 必要勝率 ${formatPct(req)}` +
    ` · 自分${formatSeatLabel(advEls.heroPos.value === 'auto' ? 'auto' : s.heroPos, s.players)}` +
    ` / 相手${formatSeatLabel(advEls.villainPos.value === 'auto' ? 'auto' : s.villainPos, s.players)}` +
    (posAdj.heroIP == null ? '' : ` · ${posAdj.label}`) +
    (usedDefaults && !adv.customPot ? '（一般値あり）' : '');
}

function fillPosSelects(preserve = true) {
  let players = Number(advEls.players.value);
  if (!Number.isFinite(players) || advEls.players.value === '') players = SITUATION_DEFAULTS.players;
  players = Math.min(9, Math.max(2, Math.round(players)));

  const seats = seatsForTable(players);
  const prevHero = preserve ? advEls.heroPos.value : 'auto';
  const prevVillain = preserve ? advEls.villainPos.value : 'auto';

  const auto = `<option value="auto">一般（自動）</option>`;
  const opts = auto + seats.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  advEls.heroPos.innerHTML = opts;
  advEls.villainPos.innerHTML = opts;

  const heroOk = prevHero === 'auto' || seats.some((s) => s.id === prevHero);
  const villOk = prevVillain === 'auto' || seats.some((s) => s.id === prevVillain);
  advEls.heroPos.value = heroOk ? prevHero : 'auto';
  advEls.villainPos.value = villOk ? prevVillain : 'auto';
  advUpdateOddsHint();
}

function advRenderSlots() {
  advEls.hero.innerHTML = adv.hero
    .map(
      (c, i) =>
        `<button type="button" class="slot${advActive('hero', i) ? ' is-active' : ''}" data-type="hero" data-index="${i}">${renderCardFace(c, '穴札')}</button>`
    )
    .join('');

  const labels = ['F', '', '', 'T', 'R'];
  advEls.board.innerHTML = adv.board
    .map(
      (c, i) =>
        `<button type="button" class="slot${advActive('board', i) ? ' is-active' : ''}" data-type="board" data-index="${i}">
          ${renderCardFace(c, labels[i] || '')}
          <span class="slot__label">${['フロップ', '', '', 'ターン', 'リバー'][i] || '&nbsp;'}</span>
        </button>`
    )
    .join('');

  renderPicker(advEls.picker, advUsed(), advPlace);
}

function advAdvance() {
  const a = adv.activeSlot;
  if (!a) return;
  if (a.type === 'hero') {
    adv.activeSlot = a.index === 0 ? { type: 'hero', index: 1 } : { type: 'board', index: 0 };
    return;
  }
  adv.activeSlot = a.index < 4 ? { type: 'board', index: a.index + 1 } : null;
}

function advPlace(rank, suit) {
  if (!adv.activeSlot) {
    for (let i = 0; i < 2; i++) {
      if (!adv.hero[i]) {
        adv.activeSlot = { type: 'hero', index: i };
        break;
      }
    }
    if (!adv.activeSlot) {
      for (let i = 0; i < 5; i++) {
        if (!adv.board[i]) {
          adv.activeSlot = { type: 'board', index: i };
          break;
        }
      }
    }
  }
  if (!adv.activeSlot) return;
  const card = makeCard(rank, suit);
  if (advUsed().has(card.id)) return;
  if (adv.activeSlot.type === 'hero') adv.hero[adv.activeSlot.index] = card;
  else adv.board[adv.activeSlot.index] = card;
  advAdvance();
  advRenderSlots();
}

function advSetStatus(msg, isError = false) {
  advEls.status.textContent = msg;
  advEls.status.classList.toggle('is-error', isError);
}

function updateRangeCount() {
  if (advEls.rangeCount) {
    advEls.rangeCount.textContent = `${adv.selectedHands.size}ハンド`;
  }
}

function renderRangeGrid() {
  if (!advEls.rangeGrid) return;
  advEls.rangeGrid.innerHTML = HAND_STRENGTH.map((h) => {
    const on = adv.selectedHands.has(h) ? ' is-on' : '';
    return `<button type="button" class="range-chip${on}" data-hand="${h}">${h}</button>`;
  }).join('');
  updateRangeCount();
}

function setSelectedHands(hands) {
  adv.selectedHands = new Set(hands || []);
  renderRangeGrid();
}

function rangeSetStatus(msg, isError = false) {
  if (!advEls.rangeStatus) return;
  advEls.rangeStatus.textContent = msg;
  advEls.rangeStatus.classList.toggle('is-error', isError);
}

function updateAdvRangeHint() {
  const el = document.getElementById('adv-range-hint');
  if (!el) return;
  const mode = advEls.profileSelect?.value || '';
  if (!mode) {
    el.textContent = '自動推定を使用。登録・編集は「レンジ編集」タブへ';
    return;
  }
  if (mode === '__draft__') {
    el.textContent = `編集中のレンジ（${adv.selectedHands.size}ハンド）を使用`;
    return;
  }
  const p = getProfile(mode);
  el.textContent = p ? `「${p.name}」の登録レンジ（${p.hands.length}ハンド）` : '登録・編集は「レンジ編集」タブへ';
}

function refreshProfileSelect() {
  const profiles = listProfiles();
  const advSel = advEls.profileSelect;
  const rangeSel = advEls.rangeProfileSelect;
  const advCur = advSel?.value || '';
  const rangeCur = rangeSel?.value || '';

  if (advSel) {
    advSel.innerHTML =
      `<option value="">推定レンジ（自動）</option>` +
      `<option value="__draft__">編集中のレンジ（${adv.selectedHands.size}）</option>` +
      profiles.map((p) => `<option value="${p.id}">${p.name}（${p.hands.length}）</option>`).join('');
    const ok =
      advCur === '' ||
      advCur === '__draft__' ||
      profiles.some((p) => p.id === advCur);
    advSel.value = ok ? advCur : '';
  }

  if (rangeSel) {
    rangeSel.innerHTML =
      `<option value="">（新規）</option>` +
      profiles.map((p) => `<option value="${p.id}">${p.name}（${p.hands.length}）</option>`).join('');
    if (profiles.some((p) => p.id === rangeCur)) rangeSel.value = rangeCur;
  }
  updateAdvRangeHint();
}

function loadProfileToEditor(id) {
  const p = getProfile(id);
  if (!p) return;
  if (advEls.villainName) advEls.villainName.value = p.name;
  setSelectedHands(p.hands);
  refreshProfileSelect();
}

async function fillEstimateIntoEditor() {
  if (!isPro()) {
    openPaywall();
    return;
  }
  if (!adv.hero[0] || !adv.hero[1]) {
    rangeSetStatus('推定には「アクション診断」で自分のハンドを入れてください', true);
    return;
  }
  const { players, pot, bet, heroPos, villainPos, style, line, tableTend, pro } = resolveSituation();
  const potBefore = Math.max(1, pot - bet);
  const betFraction = bet / potBefore;
  const dead = advUsed();
  const posAdj = pro
    ? positionalEquityAdjust(heroPos, villainPos, players)
    : { heroIP: null };
  const range = estimateRange(style, betFraction, dead, line, {
    posWidthMult: villainPosWidthMult(villainPos, players),
    posStrengthBias: villainPosStrengthBias(villainPos, players),
    heroIP: posAdj.heroIP,
    posNote: 'estimate',
    players,
    villainPos,
    betFraction,
    tableTend,
  }, adv.board.slice());
  adv.lastEstimateHands = range.hands.slice();
  setSelectedHands(range.hands);
  if (advEls.profileSelect) advEls.profileSelect.value = '__draft__';
  refreshProfileSelect();
  rangeSetStatus(`推定レンジを反映しました（${range.hands.length}ハンド）`);
}

function groupHands(byHand) {
  const ahead = byHand.filter((h) => h.bucket === 'ahead').map((h) => h.hand);
  const flip = byHand.filter((h) => h.bucket === 'flip').map((h) => h.hand);
  const behind = byHand.filter((h) => h.bucket === 'behind').map((h) => h.hand);
  return { ahead, flip, behind };
}

async function advRun() {
  if (adv.busy) return;
  const { pot, bet, players, heroPos, villainPos, style, line, tableTend, pro } = resolveSituation();
  const wantRaise = pro && advEls.raise.checked;

  if (!adv.hero[0] || !adv.hero[1]) {
    advSetStatus('自分のハンドを2枚入れてください', true);
    return;
  }

  let boardCount = 0;
  for (let i = 0; i < 5; i++) if (adv.board[i]) boardCount = i + 1;
  for (let i = 0; i < boardCount; i++) {
    if (!adv.board[i]) {
      advSetStatus('ボードは左から順に入れてください', true);
      return;
    }
  }
  if (boardCount === 1 || boardCount === 2) {
    advSetStatus('フロップは3枚、または未公開にしてください', true);
    return;
  }

  const potBefore = pot - bet;
  const betFraction = bet / potBefore;
  const dead = advUsed();
  // Free はポジション補正なし（一般スポット）
  const posAdj = pro
    ? positionalEquityAdjust(heroPos, villainPos, players)
    : { adj: 0, label: '一般スポット（Free）', heroIP: null };

  adv.busy = true;
  advEls.run.disabled = true;
  advSetStatus('レンジ推定と勝率を計算中…');
  advEls.result.hidden = true;
  await new Promise((r) => setTimeout(r, 30));

  try {
    const estimated = estimateRange(style, betFraction, dead, line, {
      posWidthMult: pro ? villainPosWidthMult(villainPos, players) : 1,
      posStrengthBias: pro ? villainPosStrengthBias(villainPos, players) : 0.3,
      heroIP: posAdj.heroIP,
      posNote: pro ? `${players}人 ${formatSeatLabel(villainPos, players)}` : '一般',
      players,
      villainPos: pro ? villainPos : 'CO',
      betFraction,
      tableTend: pro ? tableTend : 'mid',
    }, adv.board.slice());
    adv.lastEstimateHands = estimated.hands.slice();

    let range = estimated;
    let rangeSource = '推定';
    const mode = pro ? advEls.profileSelect?.value || '' : '';
    if (pro && mode === '__draft__') {
      if (!adv.selectedHands.size) throw new Error('編集中のレンジが空です。レンジ編集タブでハンドを選んでください');
      const hands = sortHandsByStrength([...adv.selectedHands]);
      const combos = combosFromHands(hands, dead);
      if (!combos.length) throw new Error('選んだハンドがボード／自分のカードと衝突しています');
      range = { hands, combos, label: `編集レンジ（${hands.length}ハンド）`, line };
      rangeSource = '編集中';
    } else if (pro && mode) {
      const profile = getProfile(mode);
      if (!profile) throw new Error('登録レンジが見つかりません');
      const hands = sortHandsByStrength(profile.hands);
      const combos = combosFromHands(hands, dead);
      if (!combos.length) throw new Error('登録レンジがボード／自分のカードと衝突しています');
      range = { hands, combos, label: `${profile.name}（${hands.length}ハンド）`, line };
      rangeSource = profile.name;
    }

    const vs = equityVsRange(adv.hero, adv.board.slice(), range.combos, RANGE_ITERS);

    const adjEquity = clamp01(vs.equity + posAdj.adj);
    const adjWin = clamp01(vs.win + posAdj.adj);

    let equityWhenCalled = adjEquity;
    let raisePlan = null;
    if (wantRaise) {
      raisePlan = buildRaisePlan(style, bet, pot, range.combos, line);
      if (posAdj.heroIP === true) raisePlan.foldEquity = Math.min(0.72, raisePlan.foldEquity * 1.1);
      if (posAdj.heroIP === false) raisePlan.foldEquity = Math.max(0.1, raisePlan.foldEquity * 0.88);
      if (raisePlan.callCombos.length) {
        const vsCall = equityVsRange(adv.hero, adv.board.slice(), raisePlan.callCombos, Math.floor(RANGE_ITERS * 0.7));
        equityWhenCalled = clamp01(vsCall.equity + posAdj.adj);
      }
    }

    const decision = decideAction({
      pot,
      bet,
      equity: adjEquity,
      raiseTo: raisePlan?.raiseTo,
      foldEquity: raisePlan?.foldEquity,
      equityWhenCalled: wantRaise ? equityWhenCalled : undefined,
    });

    const groups = groupHands(vs.byHand);
    const actionJP = { fold: 'フォールド', call: 'コール', raise: 'レイズ' }[decision.best.action];

    const raiseLine = decision.raiseNote
      ? `レイズ案: ${decision.raiseNote.raiseTo} まで（フォールド期待 ${formatPct(decision.raiseNote.foldEquity)} / コール時エクイティ ${formatPct(decision.raiseNote.equityWhenCalled)}）`
      : '';

    const tableTendJP = { tight: 'タイト卓', mid: '普通卓', loose: 'ルース卓' }[tableTend] || '普通卓';
    const posSummary = pro
      ? `${players}人卓 · ${tableTendJP} · 自分 ${formatSeatLabel(heroPos, players)} / 相手 ${formatSeatLabel(villainPos, players)} · ${posAdj.label}`
      : `一般スポット（Free）· ポット${pot} / コール${bet}`;

    const detailHtml = pro
      ? `<div class="hand-groups">
        <div>
          <h3 class="tag-ahead">有利（エクイティ≥55%）· ${groups.ahead.length}ハンド</h3>
          <p>${groups.ahead.length ? formatHandList(groups.ahead) : '—'}</p>
        </div>
        <div>
          <h3 class="tag-flip">互角 · ${groups.flip.length}ハンド</h3>
          <p>${groups.flip.length ? formatHandList(groups.flip) : '—'}</p>
        </div>
        <div>
          <h3 class="tag-behind">不利（≤45%）· ${groups.behind.length}ハンド</h3>
          <p>${groups.behind.length ? formatHandList(groups.behind) : '—'}</p>
        </div>
      </div>`
      : `<div class="range-box" style="margin-top:1rem">
          <h3>Proで解放</h3>
          <p>ハンド内訳・ポジション補正・レイズEVは <button type="button" class="linkish" id="btn-upgrade-result">Pro</button> で見られます。</p>
        </div>`;

    advEls.result.hidden = false;
    advEls.result.innerHTML = `
      <p class="verdict__action" data-action="${decision.best.action}">${actionJP}</p>
      <p class="verdict__sub">
        ${posSummary}<br />
        必要勝率 ${formatPct(decision.requiredEquity)} に対し、勝率（エクイティ）は ${formatPct(adjEquity)}
        （単独勝ち ${formatPct(vs.win)} / 差 ${formatPct(decision.edge)}）。
        相手: ${LINE_LABEL[line] ?? line} · レンジ: ${rangeSource}。${range.label}。
        ${range.mix ? `コールEVはブラフ込みレンジで算出（目標ブラフ比率 約${Math.round((range.bluffTarget || 0) * 100)}%）。` : ''}
        ${raiseLine}
      </p>
      <div class="metrics">
        <div class="metric"><b class="metric__win">${formatPct(adjWin)}</b><span>勝率</span></div>
        <div class="metric"><b>${formatPct(decision.requiredEquity)}</b><span>必要勝率</span></div>
        <div class="metric"><b>${vs.comboCount}</b><span>相手コンボ数</span></div>
        <div class="metric"><b>${range.mix ? formatPct(range.mix.bluffPct) : (pro ? 'Pro' : 'Free')}</b><span>${range.mix ? '推定ブラフ比率' : 'プラン'}</span></div>
      </div>
      <ul class="ev-list">
        ${decision.options
          .map(
            (o) =>
              `<li class="${o.action === decision.best.action ? 'is-best' : ''}"><span>${o.label}</span><strong>EV ${formatEV(o.ev)}</strong></li>`
          )
          .join('')}
      </ul>
      <div class="range-box">
        <h3>推定レンジ</h3>
        <p>${formatHandList(range.hands)}</p>
      </div>
      ${detailHtml}
    `;

    document.getElementById('btn-upgrade-result')?.addEventListener('click', openPaywall);
    advSetStatus('計算完了');
    void maybeShowAdAfterCalc().then(() => updateAdHint());
  } catch (err) {
    advSetStatus(err.message || String(err), true);
  } finally {
    adv.busy = false;
    advEls.run.disabled = false;
  }
}

function advReset() {
  adv.hero = [null, null];
  adv.board = [null, null, null, null, null];
  adv.activeSlot = { type: 'hero', index: 0 };
  advEls.result.hidden = true;
  advSetStatus('カードと状況を入力してください');
  advRenderSlots();
}

/** 配布直後など：ヒーローが揃っていれば自動診断（計算中なら完了後に再実行／広告カウント含む） */
function advMaybeAutoRun() {
  if (!adv.hero[0] || !adv.hero[1]) return;
  const tryRun = () => {
    if (!adv.hero[0] || !adv.hero[1]) return;
    if (adv.busy) {
      setTimeout(tryRun, 40);
      return;
    }
    void advRun();
  };
  setTimeout(tryRun, 0);
}

function advDealFlopThree() {
  adv.board[0] = null;
  adv.board[1] = null;
  adv.board[2] = null;
  adv.board[3] = null;
  adv.board[4] = null;
  const used = advUsed();
  const dealt = [];
  for (let i = 0; i < 3; i++) {
    const c = pickRandomCard(used);
    if (!c) {
      advSetStatus('残りのカードがありません', true);
      advRenderSlots();
      return;
    }
    adv.board[i] = c;
    used.add(c.id);
    dealt.push(cardLabel(c));
  }
  adv.activeSlot = { type: 'board', index: 3 };
  advSetStatus(`フロップ ${dealt.join(' ')}`);
  advRenderSlots();
  advMaybeAutoRun();
}

function advDealTurnOne() {
  if (!adv.board[0] || !adv.board[1] || !adv.board[2]) {
    advSetStatus('先にフロップを3枚揃えてください', true);
    return;
  }
  if (adv.board[3]) {
    advSetStatus('ターンはすでに配られています', true);
    return;
  }
  const c = pickRandomCard(advUsed());
  if (!c) {
    advSetStatus('残りのカードがありません', true);
    return;
  }
  adv.board[3] = c;
  adv.activeSlot = { type: 'board', index: 4 };
  advSetStatus(`ターンに ${cardLabel(c)} を配布`);
  advRenderSlots();
  advMaybeAutoRun();
}

function advDealRiverOne() {
  if (!adv.board[0] || !adv.board[1] || !adv.board[2]) {
    advSetStatus('先にフロップを3枚揃えてください', true);
    return;
  }
  if (!adv.board[3]) {
    advSetStatus('先にターンを配ってください', true);
    return;
  }
  if (adv.board[4]) {
    advSetStatus('リバーはすでに配られています', true);
    return;
  }
  const c = pickRandomCard(advUsed());
  if (!c) {
    advSetStatus('残りのカードがありません', true);
    return;
  }
  adv.board[4] = c;
  adv.activeSlot = null;
  advSetStatus(`リバーに ${cardLabel(c)} を配布`);
  advRenderSlots();
  advMaybeAutoRun();
}

advEls.hero.addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  const index = Number(slot.dataset.index);
  if (adv.hero[index]) {
    adv.hero[index] = null;
    adv.activeSlot = { type: 'hero', index };
  } else adv.activeSlot = { type: 'hero', index };
  advRenderSlots();
});

advEls.board.addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  const index = Number(slot.dataset.index);
  if (adv.board[index]) {
    adv.board[index] = null;
    adv.activeSlot = { type: 'board', index };
  } else adv.activeSlot = { type: 'board', index };
  advRenderSlots();
});

advEls.run.addEventListener('click', () => advRun());
advEls.reset.addEventListener('click', () => advReset());
document.getElementById('btn-adv-deal-flop')?.addEventListener('click', () => advDealFlopThree());
document.getElementById('btn-adv-deal-turn')?.addEventListener('click', () => advDealTurnOne());
document.getElementById('btn-adv-deal-river')?.addEventListener('click', () => advDealRiverOne());
advEls.sizeButtons?.addEventListener('click', (e) => {
  const btn = e.target.closest('.size-btn');
  if (!btn) return;
  adv.sizeKey = btn.dataset.size;
  adv.customPot = false;
  advUpdateOddsHint();
});
advEls.pot?.addEventListener('input', () => {
  adv.customPot = true;
  advUpdateOddsHint();
});
advEls.bet?.addEventListener('input', () => {
  adv.customPot = true;
  advUpdateOddsHint();
});
advEls.players.addEventListener('input', () => fillPosSelects(true));
advEls.players.addEventListener('change', () => fillPosSelects(true));
advEls.heroPos.addEventListener('change', advUpdateOddsHint);
advEls.villainPos.addEventListener('change', advUpdateOddsHint);
advEls.style.addEventListener('change', advUpdateOddsHint);
advEls.line.addEventListener('change', advUpdateOddsHint);
advEls.tableTend?.addEventListener('change', advUpdateOddsHint);

/* ============================================================
   TAB: Line lab (Pro) — プレイライン詳細診断
   ============================================================ */

const lineFreeBanner = document.getElementById('line-free-banner');
const lineState = createLineState(6);
lineState.streetUi = 'preflop';
lineState.sizeKey = '66';

const lineCards = {
  hero: [null, null],
  board: [null, null, null, null, null],
  activeSlot: { type: 'hero', index: 0 },
  busy: false,
};

const lineEls = {
  players: document.getElementById('line-players'),
  startPot: document.getElementById('line-start-pot'),
  stack: document.getElementById('line-stack'),
  table: document.getElementById('line-table'),
  seatsSummary: document.getElementById('line-seats-summary'),
  streetTabs: document.getElementById('line-street-tabs'),
  board: document.getElementById('line-board'),
  hero: document.getElementById('line-hero'),
  picker: document.getElementById('line-picker'),
  actSeat: document.getElementById('line-act-seat'),
  actKind: document.getElementById('line-act-kind'),
  actAmount: document.getElementById('line-act-amount'),
  sizeButtons: document.getElementById('line-size-buttons'),
  timeline: document.getElementById('line-timeline'),
  spot: document.getElementById('line-spot'),
  style: document.getElementById('line-style'),
  tableTend: document.getElementById('line-table-tend'),
  raise: document.getElementById('line-raise'),
  status: document.getElementById('line-status'),
  result: document.getElementById('line-result'),
  run: document.getElementById('btn-line-run'),
};

function lineSetStatus(msg, isError = false) {
  if (!lineEls.status) return;
  lineEls.status.textContent = msg || '';
  lineEls.status.classList.toggle('is-error', !!isError);
}

function lineUsed() {
  const ids = new Set();
  for (const c of lineCards.hero) if (c) ids.add(c.id);
  for (const c of lineCards.board) if (c) ids.add(c.id);
  return ids;
}

function lineActive(type, index) {
  return lineCards.activeSlot?.type === type && lineCards.activeSlot?.index === index;
}

function syncLineStateFromInputs() {
  let players = Number(lineEls.players?.value);
  if (!Number.isFinite(players)) players = 6;
  players = Math.min(9, Math.max(2, Math.round(players)));
  if (players !== lineState.players) {
    const next = createLineState(players);
    next.startingPot = lineState.startingPot;
    next.stackHint = lineState.stackHint;
    next.streetUi = lineState.streetUi;
    next.sizeKey = lineState.sizeKey;
    Object.assign(lineState, next);
  }
  lineState.players = players;
  lineState.startingPot = Math.max(0, Number(lineEls.startPot?.value) || 0);
  lineState.stackHint = Math.max(1, Number(lineEls.stack?.value) || 1000);
}

function lineSeatAngle(i, n) {
  // BTN-ish bottom of oval: start from bottom, go clockwise
  const start = Math.PI / 2;
  return start + (i / n) * Math.PI * 2;
}

function renderLineTable() {
  if (!lineEls.table) return;
  syncLineStateFromInputs();
  const seats = seatsForTable(lineState.players);
  lineEls.table.innerHTML = seats
    .map((s, i) => {
      const ang = lineSeatAngle(i, seats.length);
      const x = 50 + Math.cos(ang) * 38;
      const y = 50 + Math.sin(ang) * 34;
      const isHero = s.id === lineState.heroSeat;
      const isActive = lineState.activeSeats.includes(s.id);
      const cls = [
        'line-seat',
        isHero ? 'is-hero' : '',
        isActive && !isHero ? 'is-active' : '',
        !isActive && !isHero ? 'is-out' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const tag = isHero ? '自分' : isActive ? '参加' : '外';
      return `<button type="button" class="${cls}" data-seat="${s.id}" style="left:${x}%;top:${y}%">${s.label}<br><span>${tag}</span></button>`;
    })
    .join('');

  if (lineEls.seatsSummary) {
    const hero = formatSeatLabel(lineState.heroSeat, lineState.players);
    const others = lineState.activeSeats
      .filter((id) => id !== lineState.heroSeat)
      .map((id) => formatSeatLabel(id, lineState.players));
    lineEls.seatsSummary.textContent = `自分 ${hero} · 相手 ${others.join(' / ') || '（未選択）'} · ${lineState.activeSeats.length}人参加`;
  }
  fillLineActSeatSelect();
}

/** 席タップ: 外→参加→自分→外（自分は常に参加） */
function onLineSeatTap(seatId) {
  const isHero = seatId === lineState.heroSeat;
  const isActive = lineState.activeSeats.includes(seatId);

  if (!isActive && !isHero) {
    lineState.activeSeats = [...lineState.activeSeats, seatId];
  } else if (isActive && !isHero) {
    lineState.heroSeat = seatId;
  } else if (isHero) {
    // keep at least hero + one villain if possible
    const others = lineState.activeSeats.filter((id) => id !== seatId);
    if (others.length) {
      lineState.heroSeat = others[0];
      lineState.activeSeats = lineState.activeSeats.filter((id) => id !== seatId);
      if (!lineState.activeSeats.includes(lineState.heroSeat)) {
        lineState.activeSeats.push(lineState.heroSeat);
      }
    }
  }
  if (!lineState.activeSeats.includes(lineState.heroSeat)) {
    lineState.activeSeats.push(lineState.heroSeat);
  }
  renderLineTable();
  refreshLineSpot();
}

function fillLineActSeatSelect() {
  if (!lineEls.actSeat) return;
  const prev = lineEls.actSeat.value;
  const opts = lineState.activeSeats
    .map((id) => {
      const lab = formatSeatLabel(id, lineState.players);
      const me = id === lineState.heroSeat ? '（自分）' : '';
      return `<option value="${id}">${lab}${me}</option>`;
    })
    .join('');
  lineEls.actSeat.innerHTML = opts || '<option value="">席を選んでください</option>';
  if (prev && lineState.activeSeats.includes(prev)) lineEls.actSeat.value = prev;
}

function renderLineStreetTabs() {
  if (!lineEls.streetTabs) return;
  lineEls.streetTabs.innerHTML = STREETS.map(
    (s) =>
      `<button type="button" class="line-street-tab${lineState.streetUi === s.id ? ' is-on' : ''}" data-street="${s.id}">${s.label}</button>`
  ).join('');
}

function renderLineSizeButtons() {
  if (!lineEls.sizeButtons) return;
  lineEls.sizeButtons.innerHTML =
    LINE_BET_SIZES.map(
      (s) =>
        `<button type="button" class="size-btn${lineState.sizeKey === s.key ? ' is-on' : ''}" data-size="${s.key}">${s.label}</button>`
    ).join('') +
    `<button type="button" class="size-btn${lineState.sizeKey === 'allin' ? ' is-on' : ''}" data-size="allin">オールイン</button>`;
}

function fillLineActKinds() {
  if (!lineEls.actKind) return;
  lineEls.actKind.innerHTML = ACTION_KINDS.map((k) => `<option value="${k.id}">${k.label}</option>`).join('');
}

function suggestLineAmount() {
  syncLineStateFromInputs();
  const sim = simulateLine(lineState);
  const kind = lineEls.actKind?.value || 'bet';
  const needs = ACTION_KINDS.find((k) => k.id === kind)?.needsAmount;
  if (!needs && kind !== 'allin') {
    if (lineEls.actAmount) lineEls.actAmount.value = '';
    return;
  }
  if (lineState.sizeKey === 'allin' || kind === 'allin') {
    if (lineEls.actAmount) lineEls.actAmount.value = String(amountAllIn(lineState.stackHint, sim.heroStreetPut));
    return;
  }
  const size = LINE_BET_SIZES.find((s) => s.key === lineState.sizeKey) || LINE_BET_SIZES[2];
  const mode = sim.streetBet > 0 ? 'raise' : 'bet';
  const amt = amountFromPotPercent(sim.potNow, sim.heroStreetPut, sim.streetBet, size.frac, mode);
  if (lineEls.actAmount) lineEls.actAmount.value = String(amt);
}

function refreshLineTimeline() {
  if (!lineEls.timeline) return;
  if (!lineState.actions.length) {
    lineEls.timeline.innerHTML = '<li class="field-hint" style="list-style:none;margin-left:-1.2rem">まだアクションがありません</li>';
    return;
  }
  let lastStreet = '';
  lineEls.timeline.innerHTML = lineState.actions
    .map((a) => {
      const streetLab = STREETS.find((s) => s.id === a.street)?.label || a.street;
      const tag = a.street !== lastStreet ? `<span class="street-tag">${streetLab}</span>` : '';
      lastStreet = a.street;
      return `<li>${tag}${formatActionLine(a, lineState.players)}</li>`;
    })
    .join('');
}

function refreshLineSpot() {
  if (!lineEls.spot) return;
  syncLineStateFromInputs();
  const sim = simulateLine(lineState);
  const mw = multiwayNote(sim.playersInHand, sim.requiredEquity);
  lineEls.spot.innerHTML = `
    <div><strong>ポット</strong>（いま）: ${Math.round(sim.potNow)}</div>
    <div><strong>このラウンドのベット</strong>（現在額）: ${Math.round(sim.streetBet)}</div>
    <div><strong>コール額</strong>（自分が追加で出す分）: ${Math.round(sim.callAmount)}</div>
    <div><strong>必要勝率</strong>: ${sim.callAmount > 0 ? formatPct(sim.requiredEquity) : '—（チェック場面など）'}</div>
    <div><strong>ハンド内</strong>: ${sim.playersInHand}人${sim.multiway ? '（マルチウェイ）' : ''}</div>
    ${mw ? `<p class="field-hint" style="margin:0.5rem 0 0">${mw.text}</p>` : ''}
  `;
}

function lineRenderSlots() {
  if (!lineEls.hero || !lineEls.board) return;
  lineEls.hero.innerHTML = lineCards.hero
    .map(
      (c, i) =>
        `<button type="button" class="slot${lineActive('hero', i) ? ' is-active' : ''}" data-type="hero" data-index="${i}">${renderCardFace(c, '穴札')}</button>`
    )
    .join('');
  const labels = ['F', '', '', 'T', 'R'];
  lineEls.board.innerHTML = lineCards.board
    .map(
      (c, i) =>
        `<button type="button" class="slot${lineActive('board', i) ? ' is-active' : ''}" data-type="board" data-index="${i}">
          ${renderCardFace(c, labels[i] || '')}
          <span class="slot__label">${['フロップ', '', '', 'ターン', 'リバー'][i] || '&nbsp;'}</span>
        </button>`
    )
    .join('');
  renderPicker(lineEls.picker, lineUsed(), linePlace);
}

function lineAdvance() {
  const a = lineCards.activeSlot;
  if (!a) return;
  if (a.type === 'hero') {
    lineCards.activeSlot = a.index === 0 ? { type: 'hero', index: 1 } : { type: 'board', index: 0 };
    return;
  }
  lineCards.activeSlot = a.index < 4 ? { type: 'board', index: a.index + 1 } : null;
}

function linePlace(card) {
  if (!lineCards.activeSlot) {
    for (let i = 0; i < 2; i++) {
      if (!lineCards.hero[i]) {
        lineCards.activeSlot = { type: 'hero', index: i };
        break;
      }
    }
    if (!lineCards.activeSlot) {
      for (let i = 0; i < 5; i++) {
        if (!lineCards.board[i]) {
          lineCards.activeSlot = { type: 'board', index: i };
          break;
        }
      }
    }
  }
  if (!lineCards.activeSlot) return;
  if (lineCards.activeSlot.type === 'hero') lineCards.hero[lineCards.activeSlot.index] = card;
  else lineCards.board[lineCards.activeSlot.index] = card;
  lineAdvance();
  lineRenderSlots();
}

function lineAddAction() {
  if (!isPro()) {
    openPaywall();
    return;
  }
  syncLineStateFromInputs();
  const seat = lineEls.actSeat?.value;
  const kind = lineEls.actKind?.value;
  if (!seat || !kind) {
    lineSetStatus('席とアクションを選んでください', true);
    return;
  }
  if (!lineState.activeSeats.includes(seat)) {
    lineSetStatus('参加席から選んでください', true);
    return;
  }
  const needs = ACTION_KINDS.find((k) => k.id === kind)?.needsAmount;
  let amount = null;
  let sizeKey = null;
  if (needs || kind === 'allin') {
    amount = Number(lineEls.actAmount?.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      suggestLineAmount();
      amount = Number(lineEls.actAmount?.value);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      lineSetStatus('金額を入力するかサイズを選んでください', true);
      return;
    }
    sizeKey = lineState.sizeKey;
  }
  lineState.actions.push({
    id: uid(),
    street: lineState.streetUi,
    seat,
    kind: kind === 'allin' ? 'allin' : kind,
    amount,
    sizeKey,
  });
  refreshLineTimeline();
  refreshLineSpot();
  suggestLineAmount();
  lineSetStatus('アクションを追加しました');
}

async function lineRun() {
  if (!isPro()) {
    openPaywall();
    return;
  }
  if (lineCards.busy) return;
  syncLineStateFromInputs();
  if (!lineCards.hero[0] || !lineCards.hero[1]) {
    lineSetStatus('自分のハンドを2枚入れてください', true);
    return;
  }
  let boardCount = 0;
  for (let i = 0; i < 5; i++) if (lineCards.board[i]) boardCount = i + 1;
  for (let i = 0; i < boardCount; i++) {
    if (!lineCards.board[i]) {
      lineSetStatus('ボードは左から順に入れてください', true);
      return;
    }
  }
  if (boardCount === 1 || boardCount === 2) {
    lineSetStatus('フロップは3枚、または未公開にしてください', true);
    return;
  }

  const sim = simulateLine(lineState);
  const pot = Math.max(1, sim.potNow);
  const bet = Math.max(0, sim.callAmount);
  if (bet <= 0) {
    lineSetStatus('いまはコール額0です。相手のベット／レイズをラインに追加してから診断してください', true);
    return;
  }

  const heroPos = lineState.heroSeat;
  const villainPos = inferPrimaryVillain(lineState) || defaultVillainPos(lineState.players);
  const lineTag = inferLineTag(lineState);
  const style = lineEls.style?.value || 'mid';
  const tableTend = lineEls.tableTend?.value || 'mid';
  const players = Math.max(2, sim.playersInHand);
  const wantRaise = !!lineEls.raise?.checked;
  const potBefore = Math.max(1, pot - bet);
  const betFraction = bet / potBefore;
  const dead = lineUsed();
  const posAdj = positionalEquityAdjust(heroPos, villainPos, lineState.players);

  lineCards.busy = true;
  if (lineEls.run) lineEls.run.disabled = true;
  lineSetStatus('ラインからレンジ推定と勝率を計算中…');
  if (lineEls.result) lineEls.result.hidden = true;
  await new Promise((r) => setTimeout(r, 30));

  try {
    const range = estimateRange(style, betFraction, dead, lineTag, {
      posWidthMult: villainPosWidthMult(villainPos, lineState.players),
      posStrengthBias: villainPosStrengthBias(villainPos, lineState.players),
      heroIP: posAdj.heroIP,
      posNote: `${players}人残 ${formatSeatLabel(villainPos, lineState.players)}`,
      players: lineState.players,
      villainPos,
      betFraction,
      tableTend,
    }, lineCards.board.slice());

    const eq = equityVsRange(lineCards.hero, lineCards.board, range.combos, RANGE_ITERS);
    let equity = clamp01(eq.equity + posAdj.adj);

    let raisePlan = null;
    let decision;
    if (wantRaise) {
      raisePlan = buildRaisePlan(style, bet, pot, range.combos, lineTag);
      const eqCall = equityVsRange(lineCards.hero, lineCards.board, raisePlan.callCombos, Math.min(12000, RANGE_ITERS));
      decision = decideAction({
        pot,
        bet,
        equity,
        raiseTo: raisePlan.raiseTo,
        foldEquity: raisePlan.foldEquity,
        equityWhenCalled: clamp01(eqCall.equity + posAdj.adj * 0.5),
      });
    } else {
      decision = decideAction({ pot, bet, equity });
    }

    const groups = groupHands(eq.byHand);
    const mw = multiwayNote(sim.playersInHand, decision.requiredEquity);
    const lineText = lineState.actions.map((a) => formatActionLine(a, lineState.players)).join(' → ');
    const actionJP = { fold: 'フォールド', call: 'コール', raise: 'レイズ' }[decision.best.action];
    const raiseLine = decision.raiseNote
      ? `レイズ案: ${decision.raiseNote.raiseTo} まで（FE ${formatPct(decision.raiseNote.foldEquity)}）`
      : '';

    lineEls.result.hidden = false;
    lineEls.result.innerHTML = `
      <p class="verdict__action" data-action="${decision.best.action}">${actionJP}</p>
      <p class="verdict__sub">
        ポット ${Math.round(pot)} · コール ${Math.round(bet)} · ${sim.playersInHand}人残${sim.multiway ? '（マルチ）' : ''}<br />
        必要勝率 ${formatPct(decision.requiredEquity)} に対し勝率 ${formatPct(equity)}（差 ${formatPct(decision.edge)}）· ${posAdj.label}<br />
        ライン: ${lineText || '（なし）'}<br />
        相手 ${formatSeatLabel(villainPos, lineState.players)} · ${LINE_LABEL[lineTag] || lineTag} · ${range.label}
        ${mw ? `<br />${mw.text}` : ''}
        ${raiseLine ? `<br />${raiseLine}` : ''}
      </p>
      <div class="metrics">
        <div class="metric"><b class="metric__win">${formatPct(equity)}</b><span>勝率</span></div>
        <div class="metric"><b>${formatPct(decision.requiredEquity)}</b><span>必要勝率</span></div>
        <div class="metric"><b>${eq.comboCount}</b><span>相手コンボ</span></div>
        <div class="metric"><b>${sim.playersInHand}</b><span>残人数</span></div>
      </div>
      <ul class="ev-list">
        ${decision.options
          .map(
            (o) =>
              `<li class="${o.action === decision.best.action ? 'is-best' : ''}"><span>${o.label}</span><strong>EV ${formatEV(o.ev)}</strong></li>`
          )
          .join('')}
      </ul>
      <div class="hand-groups">
        <div>
          <h3 class="tag-ahead">有利 · ${groups.ahead.length}</h3>
          <p>${groups.ahead.length ? formatHandList(groups.ahead.slice(0, 24)) : '—'}</p>
        </div>
        <div>
          <h3 class="tag-flip">互角 · ${groups.flip.length}</h3>
          <p>${groups.flip.length ? formatHandList(groups.flip.slice(0, 24)) : '—'}</p>
        </div>
        <div>
          <h3 class="tag-behind">不利 · ${groups.behind.length}</h3>
          <p>${groups.behind.length ? formatHandList(groups.behind.slice(0, 24)) : '—'}</p>
        </div>
      </div>
    `;
    lineSetStatus('診断完了');
    void maybeShowAdAfterCalc().then(() => updateAdHint());
  } catch (err) {
    lineSetStatus(err?.message || String(err), true);
  } finally {
    lineCards.busy = false;
    if (lineEls.run) lineEls.run.disabled = false;
  }
}

function lineResetCards() {
  lineCards.hero = [null, null];
  lineCards.board = [null, null, null, null, null];
  lineCards.activeSlot = { type: 'hero', index: 0 };
  if (lineEls.result) lineEls.result.hidden = true;
  lineSetStatus('カードをクリアしました');
  lineRenderSlots();
}

function initLineLab() {
  if (!lineEls.table) return;
  fillLineActKinds();
  renderLineStreetTabs();
  renderLineSizeButtons();
  renderLineTable();
  refreshLineTimeline();
  refreshLineSpot();
  suggestLineAmount();
  lineRenderSlots();

  lineEls.table.addEventListener('click', (e) => {
    if (!isPro()) {
      openPaywall();
      return;
    }
    const btn = e.target.closest('.line-seat');
    if (!btn) return;
    onLineSeatTap(btn.dataset.seat);
  });

  lineEls.streetTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-street]');
    if (!btn) return;
    lineState.streetUi = btn.dataset.street;
    renderLineStreetTabs();
    suggestLineAmount();
  });

  lineEls.sizeButtons?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-size]');
    if (!btn) return;
    lineState.sizeKey = btn.dataset.size;
    if (btn.dataset.size === 'allin') lineEls.actKind.value = 'allin';
    renderLineSizeButtons();
    suggestLineAmount();
  });

  lineEls.actKind?.addEventListener('change', suggestLineAmount);
  lineEls.players?.addEventListener('change', () => {
    renderLineTable();
    refreshLineSpot();
    suggestLineAmount();
  });
  lineEls.startPot?.addEventListener('input', () => {
    refreshLineSpot();
    suggestLineAmount();
  });
  lineEls.stack?.addEventListener('input', suggestLineAmount);

  document.getElementById('btn-line-add')?.addEventListener('click', lineAddAction);
  document.getElementById('btn-line-undo')?.addEventListener('click', () => {
    lineState.actions.pop();
    refreshLineTimeline();
    refreshLineSpot();
    suggestLineAmount();
  });
  document.getElementById('btn-line-clear')?.addEventListener('click', () => {
    lineState.actions = [];
    refreshLineTimeline();
    refreshLineSpot();
  });
  lineEls.run?.addEventListener('click', () => void lineRun());
  document.getElementById('btn-line-reset-cards')?.addEventListener('click', lineResetCards);
  document.getElementById('btn-upgrade-line')?.addEventListener('click', openPaywall);

  lineEls.hero?.addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const index = Number(slot.dataset.index);
    if (lineCards.hero[index]) {
      lineCards.hero[index] = null;
      lineCards.activeSlot = { type: 'hero', index };
    } else lineCards.activeSlot = { type: 'hero', index };
    lineRenderSlots();
  });
  lineEls.board?.addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const index = Number(slot.dataset.index);
    if (lineCards.board[index]) {
      lineCards.board[index] = null;
      lineCards.activeSlot = { type: 'board', index };
    } else lineCards.activeSlot = { type: 'board', index };
    lineRenderSlots();
  });

  document.getElementById('btn-line-deal-flop')?.addEventListener('click', () => {
    const dead = lineUsed();
    const deck = fullDeck().filter((c) => !dead.has(c.id));
    shuffleInPlace(deck);
    if (deck.length < 3) return lineSetStatus('カード不足', true);
    lineCards.board[0] = deck[0];
    lineCards.board[1] = deck[1];
    lineCards.board[2] = deck[2];
    lineCards.activeSlot = { type: 'board', index: 3 };
    lineState.streetUi = 'flop';
    renderLineStreetTabs();
    lineRenderSlots();
  });
  document.getElementById('btn-line-deal-turn')?.addEventListener('click', () => {
    if (![lineCards.board[0], lineCards.board[1], lineCards.board[2]].every(Boolean)) {
      return lineSetStatus('先にフロップを入れてください', true);
    }
    const dead = lineUsed();
    const deck = fullDeck().filter((c) => !dead.has(c.id));
    if (!deck.length) return lineSetStatus('カード不足', true);
    lineCards.board[3] = deck[(Math.random() * deck.length) | 0];
    lineCards.activeSlot = { type: 'board', index: 4 };
    lineState.streetUi = 'turn';
    renderLineStreetTabs();
    lineRenderSlots();
  });
  document.getElementById('btn-line-deal-river')?.addEventListener('click', () => {
    if (!lineCards.board[3]) return lineSetStatus('先にターンを入れてください', true);
    const dead = lineUsed();
    const deck = fullDeck().filter((c) => !dead.has(c.id));
    if (!deck.length) return lineSetStatus('カード不足', true);
    lineCards.board[4] = deck[(Math.random() * deck.length) | 0];
    lineCards.activeSlot = null;
    lineState.streetUi = 'river';
    renderLineStreetTabs();
    lineRenderSlots();
  });
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/* ---- premium / paywall (continued) ---- */

advEls.rangeGrid?.addEventListener('click', (e) => {
  if (!isPro()) {
    openPaywall();
    return;
  }
  const btn = e.target.closest('.range-chip');
  if (!btn) return;
  const hand = btn.dataset.hand;
  if (adv.selectedHands.has(hand)) adv.selectedHands.delete(hand);
  else adv.selectedHands.add(hand);
  btn.classList.toggle('is-on');
  updateRangeCount();
  refreshProfileSelect();
});

document.getElementById('btn-range-from-estimate')?.addEventListener('click', () => {
  void fillEstimateIntoEditor();
});

document.getElementById('btn-range-all')?.addEventListener('click', () => {
  if (!isPro()) {
    openPaywall();
    return;
  }
  setSelectedHands(HAND_STRENGTH.slice());
  if (advEls.rangeProfileSelect) advEls.rangeProfileSelect.value = '';
  updateAdvRangeHint();
  refreshProfileSelect();
  rangeSetStatus(`全${HAND_STRENGTH.length}ハンドを選択しました`);
});

document.getElementById('btn-range-clear')?.addEventListener('click', () => {
  if (!isPro()) {
    openPaywall();
    return;
  }
  setSelectedHands([]);
  if (advEls.rangeProfileSelect) advEls.rangeProfileSelect.value = '';
  if (advEls.villainName) advEls.villainName.value = '';
  refreshProfileSelect();
  rangeSetStatus('クリアしました');
});

document.getElementById('btn-range-save')?.addEventListener('click', () => {
  if (!isPro()) {
    openPaywall();
    return;
  }
  try {
    const name = advEls.villainName?.value || '';
    const hands = sortHandsByStrength([...adv.selectedHands]);
    const id = advEls.rangeProfileSelect?.value || undefined;
    const saved = saveProfile(name, hands, id || undefined);
    if (advEls.rangeProfileSelect) {
      refreshProfileSelect();
      advEls.rangeProfileSelect.value = saved.id;
    }
    if (advEls.profileSelect) advEls.profileSelect.value = saved.id;
    if (advEls.villainName) advEls.villainName.value = saved.name;
    refreshProfileSelect();
    rangeSetStatus(`「${saved.name}」を登録しました（${saved.hands.length}ハンド）`);
  } catch (err) {
    rangeSetStatus(err.message || String(err), true);
  }
});

document.getElementById('btn-range-delete')?.addEventListener('click', () => {
  if (!isPro()) {
    openPaywall();
    return;
  }
  const id = advEls.rangeProfileSelect?.value;
  if (!id) {
    rangeSetStatus('削除する登録を選んでください', true);
    return;
  }
  deleteProfile(id);
  setSelectedHands([]);
  if (advEls.villainName) advEls.villainName.value = '';
  if (advEls.rangeProfileSelect) advEls.rangeProfileSelect.value = '';
  if (advEls.profileSelect) advEls.profileSelect.value = '';
  refreshProfileSelect();
  rangeSetStatus('登録を削除しました');
});

advEls.profileSelect?.addEventListener('change', () => {
  if (!isPro()) {
    openPaywall();
    advEls.profileSelect.value = '';
    return;
  }
  updateAdvRangeHint();
});

advEls.rangeProfileSelect?.addEventListener('change', () => {
  if (!isPro()) {
    openPaywall();
    advEls.rangeProfileSelect.value = '';
    return;
  }
  const id = advEls.rangeProfileSelect.value;
  if (!id) {
    setSelectedHands([]);
    if (advEls.villainName) advEls.villainName.value = '';
    return;
  }
  loadProfileToEditor(id);
  rangeSetStatus('登録レンジを読み込みました');
});

/* ---- Freemium UI ---- */
const planBtn = document.getElementById('btn-plan');
const paywall = document.getElementById('paywall');
const paywallPrice = document.getElementById('paywall-price');
const paywallFeatures = document.getElementById('paywall-features');
const freeBanner = document.getElementById('action-free-banner');
const rangeFreeBanner = document.getElementById('range-free-banner');

function openPaywall() {
  const meta = document.getElementById('paywall-meta');
  if (meta) meta.textContent = 'YOMI Pro · 自動更新サブスクリプション · 1か月';
  paywallPrice.textContent = paywallPriceLabel || '¥320 / 月';
  paywallFeatures.innerHTML = PRO_FEATURES.map((f) => `<li>${f}</li>`).join('');
  const unlockBtn = document.getElementById('btn-unlock-pro');
  const restoreBtn = document.getElementById('btn-restore-pro');
  const inviteMsg = document.getElementById('invite-msg');
  if (inviteMsg) {
    inviteMsg.textContent = '';
    inviteMsg.className = 'invite-msg';
  }

  if (restoreBtn) {
    restoreBtn.hidden = !isAppStoreBuild() && !isPro();
    restoreBtn.onclick = async () => {
      const r = await restorePro();
      if (inviteMsg) {
        inviteMsg.textContent = r.message;
        inviteMsg.className = `invite-msg ${r.ok ? 'is-ok' : 'is-err'}`;
      }
      if (r.ok) applyPlanUI();
    };
  }

  const resetTestBtn = document.getElementById('btn-reset-test');
  if (resetTestBtn) {
    resetTestBtn.hidden = !ALLOW_TEST_PRO;
    resetTestBtn.onclick = () => {
      if (!ALLOW_TEST_PRO) return;
      if (!confirm('Pro・年齢確認・広告カウントを初期化して再読み込みします。よろしいですか？')) return;
      resetLocalTestState();
      location.reload();
    };
  }

  if (isPro()) {
    // 審査ビルドでも ALLOW_TEST_PRO 中は Free に戻せる
    const canDowngrade = !isAppStoreBuild() || ALLOW_TEST_PRO;
    unlockBtn.textContent = canDowngrade ? 'Freeに戻す（テスト）' : 'Pro利用中';
    unlockBtn.disabled = !canDowngrade;
    unlockBtn.onclick = () => {
      if (!canDowngrade) return;
      clearInviteState();
      downgradeToFree();
      closePaywall();
      applyPlanUI();
    };
  } else {
    unlockBtn.disabled = false;
    unlockBtn.textContent = isAppStoreBuild() ? 'App内課金でProを購入' : 'Proをはじめる（開発）';
    unlockBtn.onclick = async () => {
      const r = await purchasePro();
      if (inviteMsg) {
        inviteMsg.textContent = r.message;
        inviteMsg.className = `invite-msg ${r.ok ? 'is-ok' : 'is-err'}`;
      }
      if (r.ok) {
        closePaywall();
        applyPlanUI();
      }
    };
  }
  paywall.hidden = false;
}

function closePaywall() {
  paywall.hidden = true;
}

function updateAdHint() {
  const el = document.getElementById('ad-progress-hint');
  if (!el) return;
  if (isPro() || isAppStoreBuild()) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const left = calcsUntilNextAd();
  el.textContent = `広告まであと ${left} 回（${AD_EVERY_N}回ごと · 結果のあと表示 · Proでオフ）`;
}

function applyPlanUI() {
  const pro = isPro();
  planBtn.textContent = pro ? 'Pro' : 'Free';
  planBtn.classList.toggle('is-pro', pro);
  if (freeBanner) freeBanner.hidden = pro;
  if (rangeFreeBanner) rangeFreeBanner.hidden = pro;
  if (lineFreeBanner) lineFreeBanner.hidden = pro;

  const villainDetails = document.getElementById('adv-villain-details');
  if (villainDetails) {
    // Freeは閉じた状態、Proは開いておく
    villainDetails.open = pro;
  }

  document.querySelectorAll('[data-pro-field]').forEach((el) => {
    el.classList.toggle('is-locked', !pro);
  });

  if (!pro) {
    advEls.heroPos.value = 'auto';
    advEls.villainPos.value = 'auto';
    advEls.style.value = 'auto';
    advEls.line.value = 'auto';
    if (advEls.tableTend) advEls.tableTend.value = 'auto';
    advEls.raise.checked = false;
    if (advEls.profileSelect) advEls.profileSelect.value = '';
    if (eq.playerCount > 2) {
      eq.playerCount = 2;
      eq.hands = eq.hands.slice(0, 2);
      eq.results = null;
      eqRender();
    }
  } else {
    advEls.raise.checked = true;
  }

  eqEls.addPlayer.disabled = eq.playerCount >= MAX_PLAYERS;
  updateAdHint();
  refreshProfileSelect();
  renderRangeGrid();
  advUpdateOddsHint();
}

document.querySelectorAll('[data-pro-field]').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (isPro()) return;
    e.preventDefault();
    openPaywall();
  });
});

planBtn.addEventListener('click', openPaywall);
document.getElementById('btn-paywall-close').addEventListener('click', closePaywall);
document.getElementById('btn-upgrade-inline')?.addEventListener('click', openPaywall);
document.getElementById('btn-upgrade-range')?.addEventListener('click', openPaywall);
paywall.addEventListener('click', (e) => {
  if (e.target === paywall) closePaywall();
});
window.addEventListener('yomi:plan', applyPlanUI);
window.addEventListener('yomi:open-paywall', openPaywall);

document.getElementById('btn-invite-redeem')?.addEventListener('click', () => {
  const input = document.getElementById('invite-input');
  const msg = document.getElementById('invite-msg');
  const blocked = redeemInviteForStore(input?.value);
  const result = blocked || redeemInviteCode(input?.value);
  if (msg) {
    msg.textContent = result.message;
    msg.className = `invite-msg ${result.ok ? 'is-ok' : 'is-err'}`;
  }
  if (result.ok) {
    applyPlanUI();
    if (input) input.value = '';
  }
});

document.getElementById('invite-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-invite-redeem')?.click();
});

fillPosSelects(false);
applyPublisherUi();
applyPlanUI();
advReset();
initLineLab();
void (async () => {
  await setupAgeGate();
  const synced = await syncProFromStore();
  if (synced?.synced) applyPlanUI();
  paywallPriceLabel = (await resolveProPriceLabel()) || paywallPriceLabel;
})();
