/**
 * 7-card Hold'em hand strength. Higher score = stronger hand.
 * Encoded as category * 1e10 + kickers for fast comparison.
 */

function score5(ranks, suits) {
  const flush = suits[0] === suits[1] && suits[1] === suits[2] && suits[2] === suits[3] && suits[3] === suits[4];

  const counts = new Array(13).fill(0);
  for (const r of ranks) counts[r]++;

  const byCount = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r]) byCount.push([counts[r], r]);
  }
  byCount.sort((a, b) => b[0] - a[0] || b[1] - a[1]);

  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  let straightHigh = -1;
  if (unique.includes(12) && unique.includes(0) && unique.includes(1) && unique.includes(2) && unique.includes(3)) {
    straightHigh = 3; // wheel
  }
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i + 4] - unique[i] === 4) straightHigh = unique[i + 4];
  }

  const ordered = byCount.map(([, r]) => r);
  const pack = (cat, ks) => {
    let v = cat * 1e10;
    for (let i = 0; i < ks.length; i++) v += ks[i] * 100 ** (4 - i);
    return v;
  };

  if (flush && straightHigh >= 0) return pack(8, [straightHigh]);
  if (byCount[0][0] === 4) return pack(7, ordered);
  if (byCount[0][0] === 3 && byCount[1][0] === 2) return pack(6, ordered);
  if (flush) return pack(5, [...ranks].sort((a, b) => b - a));
  if (straightHigh >= 0) return pack(4, [straightHigh]);
  if (byCount[0][0] === 3) return pack(3, ordered);
  if (byCount[0][0] === 2 && byCount[1][0] === 2) return pack(2, ordered);
  if (byCount[0][0] === 2) return pack(1, ordered);
  return pack(0, [...ranks].sort((a, b) => b - a));
}

const COMBOS = [];
for (let a = 0; a < 7; a++) {
  for (let b = a + 1; b < 7; b++) {
    for (let c = b + 1; c < 7; c++) {
      for (let d = c + 1; d < 7; d++) {
        for (let e = d + 1; e < 7; e++) COMBOS.push([a, b, c, d, e]);
      }
    }
  }
}

/** @param {import('./cards.js').Card[]} seven length 7 */
export function evaluate7(seven) {
  let best = -1;
  const ranks = new Array(5);
  const suits = new Array(5);
  for (const idx of COMBOS) {
    for (let i = 0; i < 5; i++) {
      const card = seven[idx[i]];
      ranks[i] = card.rank;
      suits[i] = card.suit;
    }
    const s = score5(ranks, suits);
    if (s > best) best = s;
  }
  return best;
}
