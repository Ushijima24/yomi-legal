/**
 * 世界のヨコサワ「トーナメント用」チャート準拠の開レンジ基準
 * 色・枠が付いたハンド = 推定の最大ユニバース。灰色は含めない。
 * 後ろの人数・アクションで削る。
 */

/** @typedef {'8s'|'8m'|'8w'|'7'|'5'|'3'|'2'|'bb'} YokoTier */

/**
 * ハンド → ティア
 * 8s/8m/8w: 後ろ8でも可（強/中/弱）
 * 7: 後ろ6–7まで
 * 5: 後ろ4–5まで
 * 3: 後ろ3まで
 * 2: 後ろ2（紫枠）
 * bb: BBがBTNレイズにコール（ピンク）
 */
export const YOKOSAWA_TIER = /** @type {Record<string, YokoTier>} */ ({
  // 8 強（紺）
  AA: '8s',
  KK: '8s',
  QQ: '8s',
  AKs: '8s',
  AKo: '8s',
  // 8 中（赤）
  JJ: '8m',
  TT: '8m',
  '99': '8m',
  AQs: '8m',
  AJs: '8m',
  ATs: '8m',
  AQo: '8m',
  // 8 弱（黄）
  '88': '8w',
  '77': '8w',
  JTs: '8w',
  AJo: '8w',
  KQo: '8w',
  // 6–7（緑）
  '66': '7',
  '55': '7',
  A9s: '7',
  A8s: '7',
  A7s: '7',
  A6s: '7',
  A5s: '7',
  A4s: '7',
  A3s: '7',
  A2s: '7',
  KQs: '7',
  KJs: '7',
  KTs: '7',
  QJs: '7',
  QTs: '7',
  ATo: '7',
  KTo: '7',
  KJo: '7',
  // 4–5（水色）
  '44': '5',
  '33': '5',
  '22': '5',
  K9s: '5',
  Q9s: '5',
  J9s: '5',
  T9s: '5',
  '98s': '5',
  '97s': '5',
  T8s: '5',
  A9o: '5',
  K9o: '5',
  QJo: '5',
  JTo: '5',
  Q9o: '5',
  J9o: '5',
  T9o: '5',
  // 3（白）
  K8s: '3',
  K7s: '3',
  K6s: '3',
  K5s: '3',
  K4s: '3',
  K3s: '3',
  K2s: '3',
  Q8s: '3',
  Q7s: '3',
  Q6s: '3',
  J8s: '3',
  J7s: '3',
  '87s': '3',
  '76s': '3',
  '65s': '3',
  A8o: '3',
  A7o: '3',
  A6o: '3', // 紫枠も兼ねるが白帯に含まれる
  K8o: '3',
  K7o: '3',
  Q8o: '3',
  Q7o: '3',
  J8o: '3',
  J7o: '3',
  T8o: '3',
  '98o': '3',
  '97o': '3',
  '87o': '3',
  QTo: '5',
  // 2（紫枠）— 白と重複しない追加分
  Q5s: '2',
  Q4s: '2',
  Q3s: '2',
  Q2s: '2',
  J6s: '2',
  T7s: '2',
  '96s': '2',
  '86s': '2',
  '75s': '2',
  '64s': '2',
  '54s': '2',
  // BB vs BTN（ピンク）— チャートの桃色帯
  J5s: 'bb',
  J4s: 'bb',
  J3s: 'bb',
  J2s: 'bb',
  T6s: 'bb',
  T5s: 'bb',
  T4s: 'bb',
  T3s: 'bb',
  T2s: 'bb',
  '95s': 'bb',
  '85s': 'bb',
  '74s': 'bb',
  '63s': 'bb',
  '53s': 'bb',
  '43s': 'bb',
  A5o: 'bb',
  A4o: 'bb',
  A3o: 'bb',
  A2o: 'bb',
  K6o: 'bb',
  K5o: 'bb',
});

/** ティアの「後ろの人数」上限（bb はオープン不可） */
const TIER_MAX_BEHIND = {
  '8s': 8,
  '8m': 8,
  '8w': 8,
  '7': 7,
  '5': 5,
  '3': 3,
  '2': 2,
  bb: 0,
};

const TIER_STRENGTH_ORDER = ['8s', '8m', '8w', '7', '5', '3', '2', 'bb'];

/** 色・枠つき全ハンド（灰色以外） */
export const YOKOSAWA_UNIVERSE = Object.keys(YOKOSAWA_TIER);

/**
 * 自分の席から見た「後ろの人数」（ヨコサワチャート基準）
 * BTN→2（SB/BB）、CO→3 … 早い席ほど大きい
 */
export function peopleBehind(seatId, players, seatsForTableFn) {
  const seats = seatsForTableFn(players);
  const idx = seats.findIndex((s) => s.id === seatId);
  if (idx < 0) return 5;
  if (seatId === 'BB') return 0;
  // 自分より後にアクションする人数
  return Math.max(0, seats.length - 1 - idx);
}

/**
 * オープン（OR）可能なハンド一覧
 * @param {number} behind 後ろの人数
 * @param {'tight'|'mid'|'loose'} [style='mid']
 * @param {{ includeBbDefend?: boolean }} [opt]
 */
export function yokosawaOpenHands(behind, style = 'mid', opt = {}) {
  let maxBehind = behind;
  if (style === 'tight') maxBehind = Math.max(0, behind - 1);
  if (style === 'loose') maxBehind = Math.min(8, behind + 1);

  const hands = [];
  for (const [hand, tier] of Object.entries(YOKOSAWA_TIER)) {
    if (tier === 'bb') {
      if (opt.includeBbDefend) hands.push(hand);
      continue;
    }
    if (TIER_MAX_BEHIND[tier] >= maxBehind) hands.push(hand);
  }
  return hands;
}

/**
 * ラインに応じてヨコサワ基準から削る
 * @param {string[]} openHands ポジション後のオープン候補
 * @param {'or'|'3bet'|'4bet'|'caller'|'unknown'} line
 * @param {'tight'|'mid'|'loose'} style
 * @param {string[]} strengthOrder HAND_STRENGTH などソート用
 */
export function narrowByLine(openHands, line, style, strengthOrder) {
  const sorted = [...openHands].sort((a, b) => {
    const ia = strengthOrder.indexOf(a);
    const ib = strengthOrder.indexOf(b);
    const ta = TIER_STRENGTH_ORDER.indexOf(YOKOSAWA_TIER[a] || 'bb');
    const tb = TIER_STRENGTH_ORDER.indexOf(YOKOSAWA_TIER[b] || 'bb');
    if (ta !== tb) return ta - tb;
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  if (line === 'or' || line === 'unknown') {
    if (style === 'tight') return sorted.filter((h) => ['8s', '8m', '8w', '7'].includes(YOKOSAWA_TIER[h]));
    if (style === 'loose') return sorted;
    // mid: 2人用の最薄は半分だけ
    const soft = sorted.filter((h) => YOKOSAWA_TIER[h] === '2');
    const core = sorted.filter((h) => YOKOSAWA_TIER[h] !== '2');
    return core.concat(soft.slice(0, Math.ceil(soft.length * 0.55)));
  }

  if (line === 'caller') {
    // コールレンジ: オープンよりやや広く、bb防衛も含めうる
    return sorted;
  }

  if (line === '3bet') {
    const valueTiers = style === 'tight' ? ['8s', '8m'] : style === 'loose' ? ['8s', '8m', '8w', '7'] : ['8s', '8m', '8w'];
    const value = sorted.filter((h) => valueTiers.includes(YOKOSAWA_TIER[h]));
    // ライト3bet: Ax suited / スキャ連などチャート内の弱い帯から
    const bluffPool = sorted.filter((h) => ['7', '5', '3', '2'].includes(YOKOSAWA_TIER[h]));
    const nBluff = Math.max(6, Math.round(value.length * (style === 'tight' ? 0.35 : 0.5)));
    const bluffs = pickAlternatingBluffs(bluffPool, nBluff);
    return uniqueKeepOrder([...value, ...bluffs]);
  }

  if (line === '4bet') {
    const value = sorted.filter((h) => ['8s', '8m'].includes(YOKOSAWA_TIER[h]) || h === 'AQs' || h === 'AQo');
    const bluffPool = sorted.filter((h) => ['7', '5', '2'].includes(YOKOSAWA_TIER[h]) && (h.startsWith('A') || h.endsWith('s')));
    const bluffs = bluffPool.slice(0, Math.max(3, Math.round(value.length * 0.35)));
    return uniqueKeepOrder([...value, ...bluffs]);
  }

  return sorted;
}

function pickAlternatingBluffs(pool, n) {
  const ax = pool.filter((h) => h[0] === 'A' && h.endsWith('s'));
  const sc = pool.filter((h) => !ax.includes(h) && h.endsWith('s'));
  const rest = pool.filter((h) => !ax.includes(h) && !sc.includes(h));
  const out = [];
  for (let i = 0; out.length < n && (i < ax.length || i < sc.length || i < rest.length); i++) {
    if (i < ax.length) out.push(ax[i]);
    if (out.length >= n) break;
    if (i < sc.length) out.push(sc[i]);
    if (out.length >= n) break;
    if (i < rest.length) out.push(rest[i]);
  }
  return out;
}

function uniqueKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/**
 * 卓の傾向で「後ろの人数」をずらす（ルース卓＝実質遅いポジション扱いで広い）
 * @param {number} behind
 * @param {'tight'|'mid'|'loose'} tableTend
 */
export function adjustBehindForTable(behind, tableTend) {
  if (tableTend === 'tight') return Math.min(8, behind + 1);
  if (tableTend === 'loose') return Math.max(1, behind - 1);
  return behind;
}

/**
 * 卓傾向で相手タイプを少しだけ寄せる（完全上書きはしない）
 * @param {'tight'|'mid'|'loose'} style
 * @param {'tight'|'mid'|'loose'} tableTend
 */
export function nudgeStyleForTable(style, tableTend) {
  if (tableTend === 'loose') {
    if (style === 'tight') return 'mid';
    if (style === 'mid') return 'loose';
  }
  if (tableTend === 'tight') {
    if (style === 'loose') return 'mid';
    if (style === 'mid') return 'tight';
  }
  return style;
}

export function yokosawaUniverseSize() {
  return YOKOSAWA_UNIVERSE.length;
}
