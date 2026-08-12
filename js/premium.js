import { IAP } from './storeConfig.js';

/**
 * フリーミアム（ローカル。将来 IAP / サブスクに差し替え）
 */

const STORAGE_KEY = 'yomi_plan_v1';

export const PLAN = {
  free: 'free',
  pro: 'pro',
};

export function getPlan() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === PLAN.pro ? PLAN.pro : PLAN.free;
  } catch {
    return PLAN.free;
  }
}

export function isPro() {
  return getPlan() === PLAN.pro;
}

export function setPlan(plan) {
  localStorage.setItem(STORAGE_KEY, plan === PLAN.pro ? PLAN.pro : PLAN.free);
  window.dispatchEvent(new CustomEvent('yomi:plan', { detail: { plan: getPlan() } }));
}

export function unlockPro() {
  setPlan(PLAN.pro);
}

export function downgradeToFree() {
  setPlan(PLAN.free);
}

/** 表示用の価格 */
export const PRO_PRICE_LABEL = IAP.priceLabel;

export const PRO_FEATURES = [
  '広告なし（計算のたびのインタースティシャルをオフ）',
  '勝率計算で相手を3人以上まで追加',
  'ポジション・相手タイプ・ラインを細かく指定',
  'レイズ案のEV計算',
  '有利 / 互角 / 不利ハンドの内訳',
  'ポジション補正込みの勝率',
  '推定レンジの手動編集（チェックで足し引き）',
  '相手の名前つきハンドレンジ登録',
];
