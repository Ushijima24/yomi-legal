/**
 * テーブル人数・ポジション・IP/OOP（2〜9人対応）
 */

/** @typedef {{ id: string, label: string, order: number }} Seat */

/** 9人フルの座席順（UTG→BB）。人数に応じて末尾 n 席を使う */
const FULL_RING = [
  { id: 'UTG', label: 'UTG' },
  { id: 'UTG1', label: 'UTG+1' },
  { id: 'MP', label: 'MP' },
  { id: 'LJ', label: 'LJ' },
  { id: 'HJ', label: 'HJ' },
  { id: 'CO', label: 'CO' },
  { id: 'BTN', label: 'BTN' },
  { id: 'SB', label: 'SB' },
  { id: 'BB', label: 'BB' },
];

/**
 * @param {number} players 2〜9
 * @returns {Seat[]}
 */
export function seatsForTable(players) {
  const n = Math.min(9, Math.max(2, Math.round(players) || 6));
  if (n === 2) {
    return [
      { id: 'BTN', label: 'BTN (SB)', order: 0 },
      { id: 'BB', label: 'BB', order: 1 },
    ];
  }
  const slice = FULL_RING.slice(9 - n);
  return slice.map((s, i) => ({ ...s, order: i }));
}

/**
 * ポストフロップの後攻かどうか（HU想定の簡易判定）
 */
export function isInPosition(heroPos, villainPos, players) {
  if (!heroPos || !villainPos || heroPos === 'auto' || villainPos === 'auto') return null;
  const seats = seatsForTable(players);
  const h = seats.find((s) => s.id === heroPos);
  const v = seats.find((s) => s.id === villainPos);
  if (!h || !v) return null;

  if (players <= 2) return heroPos === 'BTN';

  const blind = (id) => id === 'SB' || id === 'BB';
  if (blind(heroPos) && blind(villainPos)) return heroPos === 'BB';
  if (heroPos === 'BTN') return true;
  if (villainPos === 'BTN') return false;
  if (blind(heroPos) && !blind(villainPos)) return false;
  if (!blind(heroPos) && blind(villainPos)) return true;
  return h.order > v.order;
}

/** 一般的なデフォルト席 */
export function defaultHeroPos(players) {
  const seats = seatsForTable(players);
  return seats.find((s) => s.id === 'BB')?.id || seats[seats.length - 1].id;
}

export function defaultVillainPos(players) {
  const seats = seatsForTable(players);
  return seats.find((s) => s.id === 'BTN')?.id || seats.find((s) => s.id === 'CO')?.id || seats[0].id;
}

export function villainPosWidthMult(villainPos, players) {
  const seats = seatsForTable(players);
  const v = seats.find((s) => s.id === villainPos);
  if (!v) return 1;
  const max = Math.max(...seats.map((s) => s.order));
  if (villainPos === 'BB') return 0.92;
  if (villainPos === 'SB') return 0.88;
  const t = v.order / Math.max(1, max - 2);
  return 0.72 + Math.min(1, Math.max(0, t)) * 0.5;
}

export function villainPosStrengthBias(villainPos, players) {
  const seats = seatsForTable(players);
  const v = seats.find((s) => s.id === villainPos);
  if (!v) return 0.3;
  if (villainPos === 'UTG' || villainPos === 'UTG1') return 1.1;
  if (villainPos === 'MP' || villainPos === 'LJ') return 0.75;
  if (villainPos === 'BTN' || villainPos === 'CO') return 0.2;
  if (villainPos === 'SB') return 0.55;
  if (villainPos === 'BB') return 0.4;
  return 0.45;
}

export function positionalEquityAdjust(heroPos, villainPos, players) {
  const heroIP = isInPosition(heroPos, villainPos, players);
  if (heroIP == null) return { adj: 0, label: 'ポジション一般（補正なし）', heroIP: null };
  const adj = heroIP ? 0.022 : -0.022;
  return {
    adj,
    label: heroIP ? '自分IP（+2.2%）' : '自分OOP（-2.2%）',
    heroIP,
  };
}

export function clamp01(x) {
  return Math.min(0.97, Math.max(0.03, x));
}

export function formatSeatLabel(id, players) {
  if (!id || id === 'auto') return '一般';
  const s = seatsForTable(players).find((x) => x.id === id);
  return s ? s.label : id;
}

/** よくあるスポットのデフォルト値 */
export const SITUATION_DEFAULTS = {
  potBase: 100, // 相手ベット前のポット
  sizeKey: 'pot', // ポットベット
  players: 6,
  tableTend: 'mid', // 卓の傾向
  style: 'mid',
  line: 'or',
};

/** 一般的なベットサイズ（ベット前ポットに対する倍率） */
export const BET_SIZES = [
  { key: 'third', label: '1/3', frac: 1 / 3 },
  { key: 'half', label: '1/2', frac: 0.5 },
  { key: 'twoThirds', label: '2/3', frac: 2 / 3 },
  { key: 'pot', label: 'ポット', frac: 1 },
  { key: 'over125', label: '1.25x', frac: 1.25 },
  { key: 'over150', label: 'オーバー', frac: 1.5 },
  { key: 'over200', label: '2x', frac: 2 },
];

export function sizeByKey(key) {
  return BET_SIZES.find((s) => s.key === key) || BET_SIZES.find((s) => s.key === 'half');
}

/** @returns {{ potBase: number, bet: number, pot: number, frac: number, sizeKey: string, sizeLabel: string }} */
export function potFromSize(potBase, sizeKey) {
  const size = sizeByKey(sizeKey);
  const base = Math.max(1, potBase);
  const bet = Math.max(1, Math.round(base * size.frac));
  return {
    potBase: base,
    bet,
    pot: base + bet, // ベット込み
    frac: size.frac,
    sizeKey: size.key,
    sizeLabel: size.label,
  };
}
