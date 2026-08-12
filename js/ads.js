/**
 * 計算 N 回ごとにインタースティシャル（結果表示のあと）
 * Pro は完全オフ。本番は AdMob 等に差し替え。
 */

import { isPro } from './premium.js';
import { isAppStoreBuild } from './compliance.js';

const COUNT_KEY = 'yomi_calc_count_v1';
const LAST_AD_KEY = 'yomi_last_ad_at_v1';

/** 何回計算ごとに出すか */
export const AD_EVERY_N = 5;

/** 連続表示を防ぐ最短間隔（ms） */
const MIN_GAP_MS = 45_000;

function readCount() {
  const n = Number(localStorage.getItem(COUNT_KEY) || '0');
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeCount(n) {
  localStorage.setItem(COUNT_KEY, String(n));
}

export function getCalcCount() {
  return readCount();
}

export function calcsUntilNextAd() {
  if (isPro() || isAppStoreBuild()) return null;
  const n = readCount();
  const mod = n % AD_EVERY_N;
  return mod === 0 && n > 0 ? AD_EVERY_N : AD_EVERY_N - mod;
}

/**
 * 計算成功後に呼ぶ。結果を先に見せてから必要なら広告。
 * App Store審査ビルドではプレースホルダ広告を出さない。
 */
export async function maybeShowAdAfterCalc() {
  if (isPro() || isAppStoreBuild()) return false;

  const next = readCount() + 1;
  writeCount(next);

  if (next % AD_EVERY_N !== 0) return false;

  const last = Number(localStorage.getItem(LAST_AD_KEY) || '0');
  if (Date.now() - last < MIN_GAP_MS) return false;

  await new Promise((r) => setTimeout(r, 550));
  if (isPro() || isAppStoreBuild()) return false;

  localStorage.setItem(LAST_AD_KEY, String(Date.now()));
  await showInterstitialPlaceholder();
  return true;
}

function showInterstitialPlaceholder() {
  return new Promise((resolve) => {
    const root = document.getElementById('ad-interstitial');
    if (!root) {
      resolve();
      return;
    }

    const close = () => {
      root.hidden = true;
      root.removeEventListener('click', onBackdrop);
      document.getElementById('btn-ad-close')?.removeEventListener('click', close);
      document.getElementById('btn-ad-upgrade')?.removeEventListener('click', onUpgrade);
      resolve();
    };

    const onBackdrop = (e) => {
      if (e.target === root) close();
    };

    const onUpgrade = () => {
      close();
      window.dispatchEvent(new CustomEvent('yomi:open-paywall'));
    };

    root.hidden = false;
    root.addEventListener('click', onBackdrop);
    document.getElementById('btn-ad-close')?.addEventListener('click', close);
    document.getElementById('btn-ad-upgrade')?.addEventListener('click', onUpgrade);

    // 閉じるはすぐ可能（審査・UX向け）。本番SDKでもスキップ可能時間を守る。
  });
}

/** 本番差し替え用フック */
export async function showRewardedOrInterstitial() {
  // TODO: AdMob Interstitial / AppLovin 等
  return showInterstitialPlaceholder();
}
