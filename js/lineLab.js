/**
 * ライン解析（Pro）— プレイライン入力とポット／コール額の整理
 */
import { seatsForTable, formatSeatLabel } from './position.js';

/** ポットに対するベット％候補 */
export const LINE_BET_SIZES = [
  { key: '33', label: '33%', frac: 0.33 },
  { key: '50', label: '50%', frac: 0.5 },
  { key: '66', label: '66%', frac: 2 / 3 },
  { key: '75', label: '75%', frac: 0.75 },
  { key: '100', label: '100%', frac: 1 },
  { key: '125', label: '125%', frac: 1.25 },
  { key: '150', label: '150%', frac: 1.5 },
  { key: '200', label: '200%', frac: 2 },
  { key: '300', label: '300%', frac: 3 },
];

export const STREETS = [
  { id: 'preflop', label: 'プリフロップ', boardNeed: 0 },
  { id: 'flop', label: 'フロップ', boardNeed: 3 },
  { id: 'turn', label: 'ターン', boardNeed: 4 },
  { id: 'river', label: 'リバー', boardNeed: 5 },
];

export const ACTION_KINDS = [
  { id: 'fold', label: 'フォールド', needsAmount: false },
  { id: 'check', label: 'チェック', needsAmount: false },
  { id: 'limp', label: 'リンプ', needsAmount: true },
  { id: 'call', label: 'コール', needsAmount: false },
  { id: 'open', label: 'オープン', needsAmount: true },
  { id: 'bet', label: 'ベット', needsAmount: true },
  { id: 'raise', label: 'レイズ', needsAmount: true },
  { id: '3bet', label: '3ベット', needsAmount: true },
  { id: '4bet', label: '4ベット', needsAmount: true },
  { id: 'allin', label: 'オールイン', needsAmount: true },
];

/**
 * @typedef {{
 *   id: string,
 *   street: string,
 *   seat: string,
 *   kind: string,
 *   amount: number | null,
 *   sizeKey: string | null,
 *   note?: string,
 * }} LineAction
 */

/**
 * @typedef {{
 *   players: number,
 *   heroSeat: string,
 *   activeSeats: string[],
 *   startingPot: number,
 *   stackHint: number,
 *   actions: LineAction[],
 * }} LineState
 */

export function createLineState(players = 6) {
  const seats = seatsForTable(players);
  const hero = seats.find((s) => s.id === 'BB')?.id || seats[seats.length - 1].id;
  const villain = seats.find((s) => s.id === 'BTN')?.id || seats[0].id;
  return {
    players,
    heroSeat: hero,
    activeSeats: [hero, villain],
    startingPot: 15,
    stackHint: 1000,
    actions: [],
  };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * アクション列から現在ポット・ストリート投資・フェイス額を再計算
 * @param {LineState} state
 */
export function simulateLine(state) {
  const seats = seatsForTable(state.players);
  const seatIds = seats.map((s) => s.id);
  /** @type {Record<string, number>} */
  let streetPut = Object.fromEntries(seatIds.map((id) => [id, 0]));
  let pot = Math.max(0, Number(state.startingPot) || 0);
  let street = 'preflop';
  let currentBet = 0;
  /** @type {string[]} */
  const alive = [...new Set(state.activeSeats)].filter((id) => seatIds.includes(id));
  const folded = new Set();

  const resetStreet = (next) => {
    street = next;
    streetPut = Object.fromEntries(seatIds.map((id) => [id, 0]));
    currentBet = 0;
  };

  const timeline = [];

  for (const act of state.actions) {
    if (act.street !== street) {
      resetStreet(act.street);
    }
    if (folded.has(act.seat) && act.kind !== 'fold') continue;

    const put = streetPut[act.seat] || 0;
    let add = 0;
    let label = ACTION_KINDS.find((k) => k.id === act.kind)?.label || act.kind;

    if (act.kind === 'fold') {
      folded.add(act.seat);
    } else if (act.kind === 'check') {
      /* no chips */
    } else if (act.kind === 'call' || act.kind === 'limp') {
      let target = currentBet;
      if (act.kind === 'limp') {
        target = Math.max(currentBet, Number(act.amount) || currentBet || 1);
      }
      add = Math.max(0, target - put);
      streetPut[act.seat] = put + add;
      pot += add;
      if (target > currentBet) currentBet = target;
    } else {
      // bet / raise / open / 3bet / 4bet / allin — amount = total this street (raise-to)
      let to =
        act.kind === 'allin'
          ? Math.max(Number(act.amount) || 0, currentBet + 1, put + 1)
          : Math.max(0, Number(act.amount) || 0);
      if (to < currentBet) to = currentBet;
      if (act.kind === 'bet' || act.kind === 'open') {
        // first aggression: amount may be size of bet (not raise-to). If put==0 and currentBet==0, amount is bet size.
        if (currentBet === 0 && put === 0) {
          to = Math.max(1, Number(act.amount) || 0);
        }
      }
      add = Math.max(0, to - put);
      streetPut[act.seat] = put + add;
      pot += add;
      currentBet = Math.max(currentBet, streetPut[act.seat]);
    }

    timeline.push({
      ...act,
      add,
      potAfter: pot,
      label,
      seatLabel: formatSeatLabel(act.seat, state.players),
    });
  }

  const hero = state.heroSeat;
  const heroPut = streetPut[hero] || 0;
  const facing = Math.max(0, currentBet - heroPut);
  const potBeforeCall = pot; // includes outstanding bets already pushed in
  // decideAction expects pot = pot including opponent bet, bet = call amount
  // Here pot already includes the facing bet chips from villains.
  const potIncludingFacing = potBeforeCall;
  const callAmount = facing;

  const stillIn = alive.filter((id) => !folded.has(id));
  const multiway = stillIn.length >= 3;

  return {
    pot: potIncludingFacing,
    potBeforeHeroCall: Math.max(0, potIncludingFacing - (callAmount > 0 ? 0 : 0)),
    /** ポット（今、相手ベット込み） */
    potNow: potIncludingFacing,
    /** このラウンドでヒーローがまだ出していない額＝コール額 */
    callAmount,
    /** このラウンドの現在ベット（ストリート累計） */
    streetBet: currentBet,
    /** ヒーローがこのストリートで既に出した額 */
    heroStreetPut: heroPut,
    street,
    stillIn,
    multiway,
    playersInHand: stillIn.length,
    timeline,
    requiredEquity: callAmount > 0 ? callAmount / (potIncludingFacing + callAmount) : 0,
  };
}

/**
 * サイズ％からレイズ／ベット額（ストリート累計＝raise-to）を出す
 * @param {number} potNow アクション前のポット
 * @param {number} heroPut
 * @param {number} currentBet
 * @param {number} frac ポットに対する倍率
 * @param {'bet'|'raise'} mode
 */
export function amountFromPotPercent(potNow, heroPut, currentBet, frac, mode) {
  const base = Math.max(1, potNow);
  if (mode === 'bet' || currentBet <= 0) {
    return Math.max(1, Math.round(base * frac));
  }
  // raise-to ≈ currentBet + pot*frac（シンプルなポット比率レイズ）
  return Math.max(currentBet + 1, Math.round(currentBet + base * frac));
}

export function amountAllIn(stackHint, heroPut) {
  return Math.max(1, Math.round(Number(stackHint) || 0));
}

/**
 * ラインから相手タイプ推定のヒント（OR / 3bet など）
 * @param {LineState} state
 */
export function inferLineTag(state) {
  const kinds = state.actions.map((a) => a.kind);
  if (kinds.includes('4bet')) return '4bet';
  if (kinds.includes('3bet')) return '3bet';
  if (kinds.includes('open') || kinds.includes('raise') || kinds.includes('bet')) return 'or';
  if (kinds.includes('call') || kinds.includes('limp')) return 'caller';
  return 'unknown';
}

/**
 * ヒーロー以外で最後にアグレッションした席
 * @param {LineState} state
 */
export function inferPrimaryVillain(state) {
  const aggr = ['open', 'bet', 'raise', '3bet', '4bet', 'allin'];
  for (let i = state.actions.length - 1; i >= 0; i--) {
    const a = state.actions[i];
    if (a.seat !== state.heroSeat && aggr.includes(a.kind)) return a.seat;
  }
  return state.activeSeats.find((s) => s !== state.heroSeat) || null;
}

export function formatActionLine(act, players) {
  const kind = ACTION_KINDS.find((k) => k.id === act.kind)?.label || act.kind;
  const seat = formatSeatLabel(act.seat, players);
  if (act.amount != null && ACTION_KINDS.find((k) => k.id === act.kind)?.needsAmount) {
    const size = act.sizeKey ? ` (${LINE_BET_SIZES.find((s) => s.key === act.sizeKey)?.label || act.sizeKey})` : '';
    return `${seat} ${kind} ${act.amount}${size}`;
  }
  return `${seat} ${kind}`;
}

/**
 * マルチウェイ時の必要勝率メモ（簡易）
 * 即コールの数学的必要勝率は HU と同じだが、背後のプレイヤーがいると実現EVは下がりやすい。
 */
export function multiwayNote(playersInHand, requiredEquity) {
  if (playersInHand < 3) return null;
  const soft = Math.min(0.55, requiredEquity + 0.04 * (playersInHand - 2));
  return {
    playersInHand,
    requiredEquity,
    softTarget: soft,
    text: `マルチウェイ（${playersInHand}人）。コールの必要勝率は ${pct(requiredEquity)} だが、背後がいるため目安はもう少し高め（〜${pct(soft)}）が無難。`,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}
