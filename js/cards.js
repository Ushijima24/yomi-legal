/** @typedef {{ rank: number, suit: number, id: number }} Card */

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['c', 'd', 'h', 's']; // clubs diamonds hearts spades
export const SUIT_SYMBOLS = { c: '♣', d: '♦', h: '♥', s: '♠' };
export const SUIT_COLORS = { c: 'black', d: 'red', h: 'red', s: 'black' };

/** @param {number} rank 0-12 @param {number} suit 0-3 */
export function makeCard(rank, suit) {
  return { rank, suit, id: suit * 13 + rank };
}

/** @param {string} code e.g. "As", "Td" */
export function parseCard(code) {
  const rank = RANKS.indexOf(code[0].toUpperCase());
  const suit = SUITS.indexOf(code[1].toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Invalid card: ${code}`);
  return makeCard(rank, suit);
}

export function cardLabel(card) {
  return `${RANKS[card.rank]}${SUIT_SYMBOLS[SUITS[card.suit]]}`;
}

export function cardCode(card) {
  return `${RANKS[card.rank]}${SUITS[card.suit]}`;
}

export function fullDeck() {
  const deck = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 0; r < 13; r++) deck.push(makeCard(r, s));
  }
  return deck;
}
