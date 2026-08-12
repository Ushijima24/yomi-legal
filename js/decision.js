import { fullDeck } from './cards.js';
import { evaluate7 } from './evaluator.js';
import { callingRangeFrom } from './range.js';

/**
 * ヒーロー vs 加重レンジのエクイティ
 * @param {import('./cards.js').Card[]} hero length 2
 * @param {Array<import('./cards.js').Card|null>} board length 5
 * @param {Array<{ cards: import('./cards.js').Card[], weight: number, hand: string }>} combos
 * @param {number} iterations
 */
export function equityVsRange(hero, board, combos, iterations = 20000) {
  if (!combos.length) throw new Error('相手レンジが空です（カードがブロックされています）');

  const fixedBoard = board.filter(Boolean);
  if (![0, 3, 4, 5].includes(fixedBoard.length)) {
    throw new Error('ボードは0 / 3 / 4 / 5枚にしてください');
  }

  const dead = new Set([hero[0].id, hero[1].id, ...fixedBoard.map((c) => c.id)]);
  const live = combos.filter((c) => !dead.has(c.cards[0].id) && !dead.has(c.cards[1].id));
  if (!live.length) throw new Error('相手レンジが空です');

  const totalW = live.reduce((s, c) => s + c.weight, 0);
  const cdf = [];
  let acc = 0;
  for (const c of live) {
    acc += c.weight / totalW;
    cdf.push(acc);
  }

  const remainBase = fullDeck().filter((c) => !dead.has(c.id));
  const boardNeeded = 5 - fixedBoard.length;

  let eqSum = 0;
  let winSum = 0;
  let tieSum = 0;

  /** hand -> { w, ahead, flip, behind } for classification by sample */
  const handStats = new Map();

  for (let t = 0; t < iterations; t++) {
    const r = Math.random();
    let idx = cdf.findIndex((x) => r <= x);
    if (idx < 0) idx = live.length - 1;
    const vill = live[idx];

    const dead2 = new Set(dead);
    dead2.add(vill.cards[0].id);
    dead2.add(vill.cards[1].id);
    const remain = remainBase.filter((c) => !dead2.has(c.id));

    const pool = remain.slice();
    for (let i = 0; i < boardNeeded; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const runBoard = fixedBoard.concat(pool.slice(0, boardNeeded));

    const hs = evaluate7([hero[0], hero[1], ...runBoard]);
    const vs = evaluate7([vill.cards[0], vill.cards[1], ...runBoard]);

    let share = 0;
    if (hs > vs) {
      share = 1;
      winSum++;
    } else if (hs === vs) {
      share = 0.5;
      tieSum++;
    }
    eqSum += share;

    if (!handStats.has(vill.hand)) handStats.set(vill.hand, { n: 0, eq: 0 });
    const st = handStats.get(vill.hand);
    st.n++;
    st.eq += share;
  }

  const byHand = [];
  for (const [hand, st] of handStats) {
    const e = st.eq / st.n;
    byHand.push({
      hand,
      equity: e,
      bucket: e >= 0.55 ? 'ahead' : e <= 0.45 ? 'behind' : 'flip',
    });
  }
  byHand.sort((a, b) => b.equity - a.equity);

  return {
    equity: eqSum / iterations,
    win: winSum / iterations,
    tie: tieSum / iterations,
    iterations,
    byHand,
    comboCount: live.length,
  };
}

/**
 * @param {object} p
 * @param {number} p.pot 相手ベット込みのポット
 * @param {number} p.bet コール額
 * @param {number} p.equity
 * @param {number} [p.raiseTo] レイズする合計額（このストリートで出す総額）
 * @param {number} [p.foldEquity]
 * @param {number} [p.equityWhenCalled]
 */
export function decideAction({ pot, bet, equity, raiseTo, foldEquity, equityWhenCalled }) {
  const required = bet / (pot + bet);
  const evCall = equity * (pot + bet) - bet;
  const evFold = 0;

  let evRaise = null;
  let raiseNote = null;
  if (raiseTo != null && raiseTo > bet && foldEquity != null && equityWhenCalled != null) {
    // 相手がフォールド → pot を得る（既にベットはポットに含まれている）
    // 相手がコール → 追加で (raiseTo - bet) をポットへ。最終ポット = pot + raiseTo + (raiseTo - bet)
    const callExtra = raiseTo - bet;
    const potIfCalled = pot + raiseTo + callExtra;
    evRaise =
      foldEquity * pot + (1 - foldEquity) * (equityWhenCalled * potIfCalled - raiseTo);
    raiseNote = {
      raiseTo,
      foldEquity,
      equityWhenCalled,
      callExtra,
    };
  }

  const options = [
    { action: 'fold', ev: evFold, label: 'フォールド' },
    { action: 'call', ev: evCall, label: 'コール' },
  ];
  if (evRaise != null) options.push({ action: 'raise', ev: evRaise, label: 'レイズ' });

  options.sort((a, b) => b.ev - a.ev);
  const best = options[0];

  return {
    requiredEquity: required,
    evFold,
    evCall,
    evRaise,
    raiseNote,
    best,
    options,
    edge: equity - required,
  };
}

/**
 * プレイヤータイプ＋ラインからレイズに対するフォールド率の目安
 */
export function estimateFoldEquity(style, betFraction, line = 'or') {
  let base = { tight: 0.52, mid: 0.38, loose: 0.24 }[style] ?? 0.38;
  const lineFold = {
    or: 1.0,
    '3bet': 0.62,
    '4bet': 0.4,
    caller: 1.1,
    unknown: 0.95,
  }[line] ?? 0.95;
  base *= lineFold;
  if (betFraction >= 1) base *= 0.7;
  else if (betFraction >= 0.7) base *= 0.85;
  return Math.min(0.7, Math.max(0.1, base));
}

export function buildRaisePlan(style, bet, pot, bettingCombos, line = 'or') {
  const raiseTo = Math.max(bet * 3, Math.round((pot + bet) * 0.55 + bet));
  const foldEquity = estimateFoldEquity(style, bet / Math.max(1, pot - bet), line);
  const keepFrac = line === '4bet' ? 0.7 : line === '3bet' ? 0.55 : style === 'tight' ? 0.55 : 0.4;
  const callCombos = callingRangeFrom(bettingCombos, keepFrac);
  return { raiseTo, foldEquity, callCombos };
}
