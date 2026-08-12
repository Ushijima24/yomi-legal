import { fullDeck } from './cards.js';
import { evaluate7 } from './evaluator.js';

/**
 * @param {Array<Array<import('./cards.js').Card|null>>} hands
 * @param {Array<import('./cards.js').Card|null>} board length 5
 * @param {number} iterations
 */
export function calculateEquity(hands, board, iterations = 30000) {
  const knownIds = new Set();
  const fixedHands = [];
  const unknownHandIndexes = [];

  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    if (h[0] && h[1]) {
      if (knownIds.has(h[0].id) || knownIds.has(h[1].id) || h[0].id === h[1].id) {
        throw new Error('同じカードが重複しています');
      }
      knownIds.add(h[0].id);
      knownIds.add(h[1].id);
      fixedHands.push([h[0], h[1]]);
    } else if (!h[0] && !h[1]) {
      fixedHands.push(null);
      unknownHandIndexes.push(i);
    } else {
      throw new Error('穴札は2枚そろえるか、空にしてください');
    }
  }

  const fixedBoard = [];
  for (const c of board) {
    if (!c) continue;
    if (knownIds.has(c.id)) throw new Error('同じカードが重複しています');
    knownIds.add(c.id);
    fixedBoard.push(c);
  }

  // Board must be 0, 3, 4, or 5 cards (Hold'em streets)
  if (![0, 3, 4, 5].includes(fixedBoard.length)) {
    throw new Error('ボードはフロップ(3)、ターン(4)、リバー(5)、または未公開にしてください');
  }

  const boardNeeded = 5 - fixedBoard.length;
  const knownCount = fixedHands.filter(Boolean).length;
  if (knownCount < 1) throw new Error('最低1人分のハンドを入力してください');
  if (knownCount + unknownHandIndexes.length < 2) {
    throw new Error('プレイヤーは2人以上必要です');
  }

  const remain = fullDeck().filter((c) => !knownIds.has(c.id));
  const n = hands.length;
  const wins = new Array(n).fill(0);
  const ties = new Array(n).fill(0);
  const equitySum = new Array(n).fill(0);
  const needDeal = boardNeeded + unknownHandIndexes.length * 2;

  for (let t = 0; t < iterations; t++) {
    const pool = remain.slice();
    for (let i = 0; i < needDeal; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    let cursor = 0;
    const runBoard = fixedBoard.concat(pool.slice(cursor, cursor + boardNeeded));
    cursor += boardNeeded;

    const runHands = fixedHands.map((h) => (h ? h.slice() : null));
    for (const idx of unknownHandIndexes) {
      runHands[idx] = [pool[cursor++], pool[cursor++]];
    }

    const scores = new Array(n);
    for (let p = 0; p < n; p++) {
      scores[p] = evaluate7([
        runHands[p][0],
        runHands[p][1],
        runBoard[0],
        runBoard[1],
        runBoard[2],
        runBoard[3],
        runBoard[4],
      ]);
    }

    let best = -1;
    for (let p = 0; p < n; p++) if (scores[p] > best) best = scores[p];
    const winners = [];
    for (let p = 0; p < n; p++) if (scores[p] === best) winners.push(p);

    const share = 1 / winners.length;
    for (const p of winners) {
      equitySum[p] += share;
      if (winners.length === 1) wins[p]++;
      else ties[p]++;
    }
  }

  return {
    wins: wins.map((w) => w / iterations),
    ties: ties.map((t) => t / iterations),
    equity: equitySum.map((e) => e / iterations),
    iterations,
  };
}
