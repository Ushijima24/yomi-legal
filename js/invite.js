/**
 * 招待コード（特別枠）。通常ユーザーは課金想定のUIがメイン。
 */

import { unlockPro, setPlan, PLAN } from './premium.js';

const REDEEMED_KEY = 'yomi_redeemed_code_v1';

/** ケース無視で照合 */
export const ALLOWLIST = ['sanoaikadayooo', 'Ushijima24', 'tomohirosato'];

function normalize(code) {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

const ALLOW_SET = new Set(ALLOWLIST.map(normalize));

/**
 * @returns {{ ok: boolean, message: string }}
 */
export function redeemInviteCode(raw) {
  const code = normalize(raw);
  if (!code) return { ok: false, message: 'コードを入力してください' };

  if (ALLOW_SET.has(code)) {
    unlockPro();
    localStorage.setItem(REDEEMED_KEY, code);
    return { ok: true, message: '招待コードを確認しました。Pro が使えます。' };
  }

  return { ok: false, message: '無効な招待コードです' };
}

export function getRedeemedCode() {
  return localStorage.getItem(REDEEMED_KEY) || '';
}

export function clearInviteState() {
  localStorage.removeItem(REDEEMED_KEY);
  setPlan(PLAN.free);
}
