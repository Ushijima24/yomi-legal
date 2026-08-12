/**
 * 169ハンド表記とコンボ展開、タイト〜ルース＋ベットサイズによるレンジ推定
 */

import { RANKS, makeCard } from './cards.js';

const RANK_I = Object.fromEntries(RANKS.map((r, i) => [r, i]));

/** 強さのおおまかな優先順（上ほど強い／ベットされやすい） */
export const HAND_STRENGTH = [
  'AA', 'KK', 'QQ', 'JJ', 'AKs', 'TT', 'AKo', 'AQs', '99', 'AJs',
  'KQs', 'AQo', '88', 'KJs', 'ATs', 'AJo', 'KQo', '77', 'QJs', 'KTs',
  'A9s', 'ATo', 'QTs', '66', 'JTs', 'KJo', 'A8s', 'K9s', 'A7s', 'QJo',
  '55', 'A5s', 'A6s', 'A9o', 'KTo', 'Q9s', 'A4s', 'J9s', 'A3s', 'K8s',
  '44', 'A2s', 'T9s', 'A8o', 'QTo', 'JTo', 'K7s', 'A7o', 'K9o', '33',
  'Q8s', 'A5o', 'J8s', 'A6o', '98s', 'A4o', 'K6s', 'T8s', 'A3o', '22',
  'K5s', 'J9o', 'Q9o', 'A2o', '97s', 'K4s', 'T9o', 'J7s', 'K8o', 'Q7s',
  '87s', 'K3s', '96s', 'Q6s', 'K2s', 'T7s', 'Q8o', '86s', 'J8o', '98o',
  '76s', 'T8o', '85s', 'K7o', 'J6s', '75s', 'Q5s', '97o', 'K6o', '54s',
  'Q4s', 'T6s', '87o', '64s', 'J5s', 'K5o', 'Q7o', 'J7o', '96o', '76o',
  '53s', 'Q3s', 'K4o', 'T7o', '84s', 'J4s', '65s', 'Q2s', '86o', 'K3o',
  'J3s', '75o', 'T5s', 'Q6o', '43s', 'K2o', 'J2s', '95s', 'T4s', '54o',
  '65o', 'Q5o', '74s', 'J6o', 'T3s', '85o', '63s', 'Q4o', 'T2s', 'J5o',
  '52s', '94s', '64o', 'Q3o', '93s', 'J4o', '84o', '42s', 'T6o', '73s',
  'Q2o', 'J3o', '53o', '83s', 'T5o', '62s', 'J2o', '92s', '43o', '82s',
  'T4o', '74o', '32s', '95o', 'T3o', '63o', '52o', 'T2o', '42o', '94o',
  '93o', '73o', '83o', '62o', '92o', '72o',
];

/** @typedef {'tight'|'mid'|'loose'} PlayerStyle */
/** @typedef {'or'|'3bet'|'4bet'|'caller'|'unknown'} ActionLine */

const STYLE_WIDTH = {
  tight: 0.12,
  mid: 0.28,
  loose: 0.45,
};

/** プリフロップラインごとのレンジ幅係数（小さいほど強い・狭い） */
const LINE_WIDTH = {
  or: 1.0,
  '3bet': 0.42,
  '4bet': 0.22,
  caller: 0.85,
  unknown: 0.95,
};

const LINE_LABEL = {
  or: 'オリジナルレイザー',
  '3bet': '3ベッター',
  '4bet': '4ベッター',
  caller: 'コーラー',
  unknown: '不明',
};

/** ラインごとの強ハンド偏重（大きいほど強い手に寄る） */
const LINE_STRENGTH_BIAS = {
  or: 0.35,
  '3bet': 1.35,
  '4bet': 1.8,
  caller: 0.15,
  unknown: 0.4,
};

export { LINE_LABEL };

/**
 * @param {string} hand e.g. AKs, QQ, T9o
 * @returns {import('./cards.js').Card[][]} combos of 2 cards
 */
export function expandHand(hand) {
  if (hand.length === 2 && hand[0] === hand[1]) {
    const r = RANK_I[hand[0]];
    const combos = [];
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = s1 + 1; s2 < 4; s2++) {
        combos.push([makeCard(r, s1), makeCard(r, s2)]);
      }
    }
    return combos;
  }
  const r1 = RANK_I[hand[0]];
  const r2 = RANK_I[hand[1]];
  const suited = hand.endsWith('s');
  const combos = [];
  if (suited) {
    for (let s = 0; s < 4; s++) combos.push([makeCard(r1, s), makeCard(r2, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) {
      for (let s2 = 0; s2 < 4; s2++) {
        if (s1 === s2) continue;
        combos.push([makeCard(r1, s1), makeCard(r2, s2)]);
      }
    }
  }
  return combos;
}

function comboBlocked(combo, deadIds) {
  return deadIds.has(combo[0].id) || deadIds.has(combo[1].id);
}

/**
 * ベットサイズ・タイプ・ライン・ポジションからレンジを推定
 * @param {PlayerStyle} style
 * @param {number} betFraction
 * @param {Set<number>} deadIds
 * @param {ActionLine} [line='or']
 * @param {{ players?: number, villainPos?: string, heroIP?: boolean|null }} [pos]
 */
export function estimateRange(style, betFraction, deadIds, line = 'or', pos = {}) {
  const baseFrac = STYLE_WIDTH[style] ?? STYLE_WIDTH.mid;
  const lineMult = LINE_WIDTH[line] ?? LINE_WIDTH.unknown;
  const posWidth = pos.posWidthMult ?? 1;

  let widthMult = 1;
  if (betFraction >= 1.1) widthMult = 0.55;
  else if (betFraction >= 0.85) widthMult = 0.7;
  else if (betFraction >= 0.55) widthMult = 1.0;
  else if (betFraction >= 0.4) widthMult = 1.15;
  else widthMult = 1.35;

  // 相手がOOPでベット → やや狭め／偏り、相手がIP → 広め
  let ipWidth = 1;
  if (pos.heroIP === true) ipWidth = 0.88; // villain OOP
  else if (pos.heroIP === false) ipWidth = 1.12; // villain IP

  const targetFrac = Math.min(0.65, Math.max(0.04, baseFrac * widthMult * lineMult * posWidth * ipWidth));
  const nHands = Math.max(3, Math.round(HAND_STRENGTH.length * targetFrac));
  const selected = HAND_STRENGTH.slice(0, nHands);

  const lineBias = LINE_STRENGTH_BIAS[line] ?? 0.4;
  const betBias = betFraction >= 0.7 ? 1.2 : 0.4;
  const posBias = pos.posStrengthBias ?? 0.3;

  /** @type {Map<string, number>} */
  const weights = new Map();
  selected.forEach((h, i) => {
    const strengthBias = 1 + (betBias + lineBias + posBias) * (1 - i / Math.max(1, selected.length));
    weights.set(h, strengthBias);
  });

  const combos = [];
  for (const [hand, w] of weights) {
    for (const cards of expandHand(hand)) {
      if (comboBlocked(cards, deadIds)) continue;
      combos.push({ hand, cards, weight: w });
    }
  }

  const styleLabel = { tight: 'タイト', mid: 'スタンダード', loose: 'ルース' }[style];
  const betLabel =
    betFraction >= 1
      ? 'ポット以上'
      : betFraction >= 0.6
        ? '2/3ポット前後'
        : betFraction >= 0.4
          ? 'ハーフポット前後'
          : '小さめベット';

  const posNote = pos.posNote ? ` · ${pos.posNote}` : '';

  return {
    weights,
    combos,
    label: `${LINE_LABEL[line] ?? line} · ${styleLabel} · ${betLabel}${posNote} → 約${selected.length}ハンド`,
    hands: selected,
    line,
  };
}

/**
 * レイズに対するコールレンジ（強めに絞る）
 */
export function callingRangeFrom(bettingCombos, keepFrac = 0.45) {
  const byHand = new Map();
  for (const c of bettingCombos) {
    if (!byHand.has(c.hand)) byHand.set(c.hand, c.weight);
  }
  const ordered = [...byHand.entries()].sort((a, b) => {
    return HAND_STRENGTH.indexOf(a[0]) - HAND_STRENGTH.indexOf(b[0]);
  });
  const keep = Math.max(2, Math.round(ordered.length * keepFrac));
  const keepSet = new Set(ordered.slice(0, keep).map(([h]) => h));
  return bettingCombos.filter((c) => keepSet.has(c.hand));
}

export function formatHandList(hands, max = 24) {
  if (hands.length <= max) return hands.join(', ');
  return `${hands.slice(0, max).join(', ')} …(+${hands.length - max})`;
}

/**
 * ハンド一覧から加重コンボを作る（編集レンジ用）
 * @param {string[]} hands
 * @param {Set<number>} deadIds
 * @param {number} [weight=1]
 */
export function combosFromHands(hands, deadIds, weight = 1) {
  const combos = [];
  const unique = [...new Set(hands)];
  for (const hand of unique) {
    if (!HAND_STRENGTH.includes(hand)) continue;
    for (const cards of expandHand(hand)) {
      if (comboBlocked(cards, deadIds)) continue;
      combos.push({ hand, cards, weight });
    }
  }
  return combos;
}

export function sortHandsByStrength(hands) {
  return [...hands].sort((a, b) => {
    const ia = HAND_STRENGTH.indexOf(a);
    const ib = HAND_STRENGTH.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}
