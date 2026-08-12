/**
 * 169ハンド表記とコンボ展開、タイト〜ルース＋ベットサイズによるレンジ推定
 * ポストフロップはボードを見てバリュー＋ブラフ（二極／セミ）を混ぜる
 */

import { RANKS, makeCard } from './cards.js';
import { evaluateBest, categoryFromScore } from './evaluator.js';
import { seatsForTable } from './position.js';
import {
  YOKOSAWA_TIER,
  YOKOSAWA_UNIVERSE,
  yokosawaOpenHands,
  yokosawaUniverseSize,
  narrowByLine,
  peopleBehind,
  adjustBehindForTable,
  nudgeStyleForTable,
} from './yokosawa.js';

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
  'T4o', '74o', '32s', '32o', '95o', 'T3o', '63o', '52o', 'T2o', '42o', '94o',
  '93o', '73o', '83o', '62o', '92o', '82o', '72s', '72o',
];

/** @typedef {'tight'|'mid'|'loose'} PlayerStyle */
/** @typedef {'or'|'3bet'|'4bet'|'caller'|'unknown'} ActionLine */
/** @typedef {'value'|'thin'|'semi'|'bluff'|'medium'} HandRole */

const STYLE_WIDTH = {
  tight: 0.12,
  mid: 0.28,
  loose: 0.45,
};

/** プリフロップラインごとのレンジ幅係数（小さいほど強い・狭い）— ヨコサワ削り後の微調整用 */
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

export { LINE_LABEL, yokosawaUniverseSize, YOKOSAWA_UNIVERSE };

/**
 * ヨコサワチャート → 卓傾向 → ポジション → アクションで削った到達レンジ
 */
export function priorHandsFromChart(style, line, pos = {}) {
  const players = pos.players || 6;
  const seat = pos.villainPos || 'CO';
  const tableTend = pos.tableTend || 'mid';
  const rawBehind = seat === 'BB' ? 0 : peopleBehind(seat, players, seatsForTable);
  const behind = adjustBehindForTable(bbDefendBehind(rawBehind, seat), tableTend);
  const styleEff = nudgeStyleForTable(style, tableTend);
  const bbDefend = line === 'caller' && seat === 'BB';

  const openBehind = bbDefend ? adjustBehindForTable(2, tableTend) : Math.max(1, behind || 2);
  let open = yokosawaOpenHands(openBehind, styleEff, { includeBbDefend: bbDefend });
  if (bbDefend) {
    open = yokosawaOpenHands(Math.max(1, adjustBehindForTable(2, tableTend)), styleEff, {
      includeBbDefend: true,
    });
  }

  let hands = narrowByLine(open, line, styleEff, HAND_STRENGTH);

  // ルース卓: チャート内の一段深いハンドを少し足す
  if (tableTend === 'loose' && (line === 'or' || line === 'caller' || line === 'unknown')) {
    const deeper = yokosawaOpenHands(Math.max(1, openBehind - 1), 'loose', {
      includeBbDefend: bbDefend,
    });
    const extra = deeper.filter((h) => !hands.includes(h));
    hands = hands.concat(extra.slice(0, Math.max(4, Math.round(extra.length * 0.35))));
  }

  // タイト卓: 最弱帯を削る
  if (tableTend === 'tight') {
    const soft = new Set(['2', '3']);
    const core = hands.filter((h) => !soft.has(YOKOSAWA_TIER[h]));
    const softHands = hands.filter((h) => soft.has(YOKOSAWA_TIER[h]));
    hands = core.concat(softHands.slice(0, Math.ceil(softHands.length * 0.4)));
  }

  const betFraction = pos.betFraction ?? 0.66;
  if (line === 'or' || line === 'unknown') {
    if (betFraction >= 1.0 && styleEff !== 'loose' && tableTend !== 'loose') {
      hands = hands.filter((h) => ['8s', '8m', '8w', '7', '5'].includes(YOKOSAWA_TIER[h]));
    }
  }

  return hands;
}

function bbDefendBehind(rawBehind, seat) {
  return seat === 'BB' ? 0 : rawBehind;
}

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

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function priorHandCount(style, betFraction, line, pos) {
  // 互換用: チャート基準の手数
  return Math.max(3, priorHandsFromChart(style, line, { ...pos, betFraction }).length);
}

/**
 * 状況に応じたブラフ比率（目安 B=30%、サイズ・ボード・タイプで変動）
 */
export function targetBluffFraction(betFraction, style, line, texture, heroIP) {
  let f = 0.3;
  if (betFraction >= 1.05) f += 0.07;
  else if (betFraction >= 0.85) f += 0.04;
  else if (betFraction >= 0.65) f += 0.01;
  else if (betFraction < 0.4) f -= 0.08;
  else if (betFraction < 0.55) f -= 0.04;

  if (style === 'tight') f -= 0.06;
  if (style === 'loose') f += 0.05;

  if (line === '3bet' || line === '4bet') f += 0.03;
  if (line === 'caller') f -= 0.05;
  if (line === 'or') f += 0.02;

  if (texture) {
    if (texture.aceHigh && texture.dry) f += 0.06; // OR の A ハイ継続イメージ
    else if (texture.aceHigh) f += 0.03;
    if (texture.dry && !texture.aceHigh) f += 0.03;
    if (texture.wet) f -= 0.05;
    if (texture.paired) f += 0.02;
    if (texture.broadway) f += 0.02;
  }

  if (heroIP === true) f -= 0.03; // villain OOP
  if (heroIP === false) f += 0.04; // villain IP

  return clamp(f, 0.12, 0.45);
}

/** @param {import('./cards.js').Card[]} board */
export function analyzeBoardTexture(board) {
  const ranks = board.map((c) => c.rank).sort((a, b) => b - a);
  const suits = board.map((c) => c.suit);
  const suitCount = [0, 0, 0, 0];
  for (const s of suits) suitCount[s]++;
  const maxSuit = Math.max(...suitCount);
  const unique = [...new Set(ranks)].sort((a, b) => a - b);

  let connected = 0;
  for (let i = 0; i < unique.length - 1; i++) {
    const gap = unique[i + 1] - unique[i];
    if (gap === 1) connected += 2;
    else if (gap === 2) connected += 1;
  }
  // wheel-ish
  if (unique.includes(12) && unique.includes(0)) connected += 1;

  const paired = ranks.length !== unique.length;
  const monotone = maxSuit >= 3;
  const twoTone = maxSuit === 2;
  const wet = monotone || connected >= 3 || (twoTone && connected >= 2);
  const dry = !wet && !paired && maxSuit === 1 && connected <= 1;
  const aceHigh = ranks[0] === 12;
  const broadway = ranks.filter((r) => r >= 8).length >= 2;

  let label = dry ? 'ドライ' : wet ? 'ウェット' : '中間';
  if (aceHigh) label = `Aハイ・${label}`;
  if (paired) label = `ペア・${label}`;

  return { dry, wet, paired, aceHigh, broadway, monotone, twoTone, label };
}

function analyzeDraws(hole, board) {
  const suits = [0, 0, 0, 0];
  for (const c of [...hole, ...board]) suits[c.suit]++;
  const flushDraw = suits.some((n) => n === 4);
  const backdoorFlush =
    !flushDraw && hole[0].suit === hole[1].suit && board.some((c) => c.suit === hole[0].suit);

  const ranks = [...new Set([...hole, ...board].map((c) => c.rank))];
  const have = new Set(ranks);
  if (have.has(12)) have.add(-1);

  let oesd = false;
  let gutshot = false;
  for (let start = -1; start <= 8; start++) {
    const win = [start, start + 1, start + 2, start + 3, start + 4];
    const hits = win.filter((r) => have.has(r)).length;
    const holeHits = win.filter((r) => hole.some((c) => c.rank === (r < 0 ? 12 : r))).length;
    if (hits === 4 && holeHits >= 1) {
      const missing = win.filter((r) => !have.has(r));
      if (missing.length === 1) {
        const m = missing[0];
        if (m === win[0] || m === win[4]) oesd = true;
        else gutshot = true;
      }
    } else if (hits === 3 && holeHits >= 1) {
      gutshot = true;
    }
  }

  const boardMax = Math.max(...board.map((c) => c.rank));
  const overcards = hole.filter((c) => c.rank > boardMax).length;

  return { flushDraw, backdoorFlush, oesd, gutshot, overcards };
}

/**
 * @returns {HandRole}
 */
function classifyHoleVsBoard(hole, board) {
  const score = evaluateBest([...hole, ...board]);
  const cat = categoryFromScore(score);
  const draws = analyzeDraws(hole, board);

  if (cat >= 2) return 'value'; // two pair+
  if (cat === 1) {
    const boardRanks = board.map((c) => c.rank).sort((a, b) => b - a);
    const top = boardRanks[0];
    const boardSet = new Set(boardRanks);
    const h0 = hole[0].rank;
    const h1 = hole[1].rank;

    if (h0 === h1) {
      if (h0 > top) return 'value'; // overpair
      if (boardSet.has(h0)) return 'value'; // set (cat usually 3)
      return h0 >= 9 ? 'thin' : 'medium'; // underpair
    }

    const paired = boardSet.has(h0) ? h0 : boardSet.has(h1) ? h1 : null;
    if (paired == null) return 'medium';
    const kicker = paired === h0 ? h1 : h0;
    if (paired === top) return kicker >= 8 ? 'value' : 'thin'; // top pair
    if (paired === boardRanks[1]) return 'thin';
    return 'medium';
  }

  // high card
  if (draws.flushDraw || draws.oesd) return 'semi';
  if (draws.gutshot || draws.backdoorFlush || draws.overcards >= 1) return 'bluff';
  return 'bluff'; // pure air still c-bet candidate on dry boards
}

function roleWeight(role, betFraction) {
  if (role === 'value') return 1.35;
  if (role === 'thin') return betFraction >= 0.75 ? 0.75 : 1.05;
  if (role === 'semi') return 0.85;
  if (role === 'medium') return betFraction < 0.55 ? 0.7 : 0.25;
  return 0.55; // bluff
}

function betSizeLabel(betFraction) {
  if (betFraction >= 1) return 'ポット以上';
  if (betFraction >= 0.6) return '2/3ポット前後';
  if (betFraction >= 0.4) return 'ハーフポット前後';
  return '小さめベット';
}

function rebalanceToBluffTarget(combos, bluffTarget) {
  if (!combos.length) return combos;
  const bluffish = (r) => r === 'bluff' || r === 'semi' || r === 'medium';
  let vSum = 0;
  let bSum = 0;
  for (const c of combos) {
    if (bluffish(c.role)) bSum += c.weight;
    else vSum += c.weight;
  }
  if (bSum <= 0 || vSum <= 0) return combos;

  // bluffWeight / (v+b) = target  →  b' = v * t / (1-t)
  const t = clamp(bluffTarget, 0.12, 0.45);
  const desiredB = (vSum * t) / (1 - t);
  const scale = desiredB / bSum;
  return combos.map((c) =>
    bluffish(c.role) ? { ...c, weight: c.weight * scale } : c
  );
}

function mixFromCombos(combos) {
  const w = { value: 0, thin: 0, semi: 0, bluff: 0, medium: 0 };
  for (const c of combos) {
    const r = c.role || 'value';
    w[r] = (w[r] || 0) + c.weight;
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const valuePct = (w.value + w.thin) / total;
  const semiPct = w.semi / total;
  const pureBluffPct = (w.bluff + w.medium) / total;
  const bluffPct = semiPct + pureBluffPct; // 目標ブラフ比率と対応（セミ含む）
  return {
    valuePct,
    semiPct,
    bluffPct,
    label: `バリュー${Math.round(valuePct * 100)}% / セミ${Math.round(semiPct * 100)}% / ブラフ${Math.round(pureBluffPct * 100)}%`,
  };
}

function finishRange({ combos, line, style, betFraction, posNote, textureLabel, bluffTarget }) {
  const balanced = rebalanceToBluffTarget(combos, bluffTarget);
  const hands = sortHandsByStrength([...new Set(balanced.map((c) => c.hand))]);
  /** @type {Map<string, number>} */
  const weights = new Map();
  for (const c of balanced) weights.set(c.hand, Math.max(weights.get(c.hand) || 0, c.weight));

  const mix = mixFromCombos(balanced);
  const styleLabel = { tight: 'タイト', mid: 'スタンダード', loose: 'ルース' }[style];
  const tex = textureLabel ? ` · ${textureLabel}` : '';
  const note = posNote ? ` · ${posNote}` : '';

  return {
    weights,
    combos: balanced,
    hands,
    line,
    mix,
    bluffTarget,
    label: `${LINE_LABEL[line] ?? line} · ${styleLabel} · ${betSizeLabel(betFraction)}${tex}${note} → ${hands.length}ハンド（${mix.label}）`,
  };
}

/** ライト3ベット用（チャート内に無いときのフォールバックは使わず、チャート由来のみ） */
function estimatePreflopPolar(style, betFraction, deadIds, line, pos) {
  const bluffTarget = targetBluffFraction(betFraction, style, line, null, pos.heroIP);
  const prior = priorHandsFromChart(style, line, { ...pos, betFraction });

  const valueRoles = new Set(['8s', '8m', '8w']);
  const valueHands =
    line === '3bet' || line === '4bet'
      ? prior.filter((h) => valueRoles.has(YOKOSAWA_TIER[h]) || ['AQs', 'AQo', 'AJs'].includes(h))
      : prior.filter((h) => ['8s', '8m', '8w', '7', '5'].includes(YOKOSAWA_TIER[h]));
  const bluffHands = prior.filter((h) => !valueHands.includes(h));

  // OR はチャート全体を到達レンジとして使い、下位をブラフウェイトに
  const useValue = line === 'or' || line === 'caller' || line === 'unknown' ? prior.slice(0, Math.max(2, prior.length - Math.round(prior.length * bluffTarget))) : valueHands;
  const useBluff =
    line === 'or' || line === 'caller' || line === 'unknown'
      ? prior.slice(useValue.length)
      : bluffHands;

  const lineBias = LINE_STRENGTH_BIAS[line] ?? 0.4;
  const betBias = betFraction >= 0.7 ? 1.2 : 0.4;
  const posBias = pos.posStrengthBias ?? 0.3;

  const combos = [];
  useValue.forEach((h, i) => {
    const w = 1 + (betBias + lineBias + posBias) * (1 - i / Math.max(1, useValue.length));
    for (const cards of expandHand(h)) {
      if (comboBlocked(cards, deadIds)) continue;
      combos.push({ hand: h, cards, weight: w, role: 'value' });
    }
  });
  useBluff.forEach((h, i) => {
    const w = 0.5 + 0.25 * (1 - i / Math.max(1, useBluff.length));
    for (const cards of expandHand(h)) {
      if (comboBlocked(cards, deadIds)) continue;
      combos.push({ hand: h, cards, weight: w, role: 'bluff' });
    }
  });

  return finishRange({
    combos,
    line,
    style,
    betFraction,
    posNote: pos.posNote,
    textureLabel: 'プリフロップ・ヨコサワ基準',
    bluffTarget,
  });
}

function estimatePostflopPolar(style, betFraction, deadIds, line, pos, board) {
  const texture = analyzeBoardTexture(board);
  const bluffTarget = targetBluffFraction(betFraction, style, line, texture, pos.heroIP);
  const priorHands = priorHandsFromChart(style, line, { ...pos, betFraction });
  // ドライならチャート内のもう一段深いハンドも少し足す（ユニバース内のみ）
  let extended = priorHands;
  if (texture.dry) {
    const behindExtra = yokosawaOpenHands(
      Math.max(2, (pos.behindHint || 3) - 1),
      style === 'tight' ? 'mid' : 'loose',
      { includeBbDefend: false }
    );
    const extra = behindExtra.filter((h) => !priorHands.includes(h) && YOKOSAWA_TIER[h] !== 'bb');
    extended = priorHands.concat(extra.slice(0, Math.min(12, extra.length)));
  }

  const buckets = {
    value: [],
    thin: [],
    semi: [],
    medium: [],
    bluff: [],
  };

  for (const hand of extended) {
    for (const cards of expandHand(hand)) {
      if (comboBlocked(cards, deadIds)) continue;
      if (board.some((b) => b.id === cards[0].id || b.id === cards[1].id)) continue;
      const role = classifyHoleVsBoard(cards, board);
      const w = roleWeight(role, betFraction);
      buckets[role].push({ hand, cards, weight: w, role });
    }
  }

  // ドライでブラフ不足ならユニバース内の残りから補完
  if (texture.dry && buckets.bluff.length < 8) {
    for (const hand of YOKOSAWA_UNIVERSE) {
      if (extended.includes(hand)) continue;
      if (YOKOSAWA_TIER[hand] === 'bb') continue;
      for (const cards of expandHand(hand)) {
        if (comboBlocked(cards, deadIds)) continue;
        if (board.some((b) => b.id === cards[0].id || b.id === cards[1].id)) continue;
        const role = classifyHoleVsBoard(cards, board);
        if (role !== 'bluff' && role !== 'semi') continue;
        buckets[role].push({ hand, cards, weight: roleWeight(role, betFraction) * 0.85, role });
      }
    }
  }

  const pick = (arr, n) => {
    if (n >= arr.length) return arr.slice();
    const step = arr.length / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
    return out;
  };

  const valuePool = [...buckets.value, ...buckets.thin];
  const merged = betFraction < 0.55;
  const nHands = Math.max(12, priorHands.length);
  const targetCombos = Math.max(12, Math.round(nHands * (merged ? 3.2 : 2.6)));
  const bluffCombosTarget = Math.round(targetCombos * bluffTarget);
  const semiShare = texture.wet ? 0.45 : 0.25;
  const semiTarget = Math.round(bluffCombosTarget * semiShare);
  const pureBluffTarget = Math.max(2, bluffCombosTarget - semiTarget);
  const valueTarget = Math.max(6, targetCombos - bluffCombosTarget - (merged ? Math.round(targetCombos * 0.15) : 0));

  let selected = [
    ...pick(valuePool, Math.min(valuePool.length, valueTarget)),
    ...pick(buckets.semi, Math.min(buckets.semi.length, semiTarget)),
    ...pick(buckets.bluff, Math.min(buckets.bluff.length, pureBluffTarget)),
  ];

  if (merged) {
    selected = selected.concat(pick(buckets.medium, Math.min(buckets.medium.length, Math.round(targetCombos * 0.18))));
  }

  if (selected.length < 8) {
    selected = selected.concat(pick(valuePool, Math.min(valuePool.length, 12)));
    selected = selected.concat(pick(buckets.bluff, Math.min(buckets.bluff.length, 8)));
  }

  const seen = new Set();
  const combos = [];
  for (const c of selected) {
    const key = `${c.cards[0].id}-${c.cards[1].id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push(c);
  }

  return finishRange({
    combos,
    line,
    style,
    betFraction,
    posNote: pos.posNote,
    textureLabel: `${texture.label}・ヨコサワ基準`,
    bluffTarget,
  });
}

/**
 * ベットサイズ・タイプ・ライン・ポジション・ボードからレンジを推定（ブラフ込み）
 * @param {PlayerStyle} style
 * @param {number} betFraction
 * @param {Set<number>} deadIds
 * @param {ActionLine} [line='or']
 * @param {{ posWidthMult?: number, posStrengthBias?: number, heroIP?: boolean|null, posNote?: string }} [pos]
 * @param {Array<import('./cards.js').Card|null>} [board]
 */
export function estimateRange(style, betFraction, deadIds, line = 'or', pos = {}, board = []) {
  const fixed = (board || []).filter(Boolean);
  if (fixed.length >= 3) {
    return estimatePostflopPolar(style, betFraction, deadIds, line, pos, fixed);
  }
  return estimatePreflopPolar(style, betFraction, deadIds, line, pos);
}

/**
 * レイズに対するコールレンジ（バリュー寄りに絞る／ブラフは落とす）
 */
export function callingRangeFrom(bettingCombos, keepFrac = 0.45) {
  const valued = bettingCombos.filter((c) => c.role === 'value' || c.role === 'thin' || c.role === 'semi');
  const pool = valued.length >= 4 ? valued : bettingCombos;

  const byHand = new Map();
  for (const c of pool) {
    if (!byHand.has(c.hand)) byHand.set(c.hand, c.weight);
  }
  const ordered = [...byHand.entries()].sort((a, b) => {
    return HAND_STRENGTH.indexOf(a[0]) - HAND_STRENGTH.indexOf(b[0]);
  });
  const keep = Math.max(2, Math.round(ordered.length * keepFrac));
  const keepSet = new Set(ordered.slice(0, keep).map(([h]) => h));
  return pool.filter((c) => keepSet.has(c.hand));
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
      combos.push({ hand, cards, weight, role: 'value' });
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
