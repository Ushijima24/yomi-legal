import { APP_STORE_BUILD, APP, PUBLISHER, LEGAL, IAP } from './storeConfig.js';
import { unlockPro, isPro, setPlan, PLAN } from './premium.js';

const AGE_KEY = 'yomi_age_ok_v1';

export function isAppStoreBuild() {
  return APP_STORE_BUILD === true;
}

export function applyPublisherUi() {
  const disc = document.getElementById('legal-disclaimer');
  if (disc) disc.textContent = LEGAL.disclaimer;

  const copy = document.getElementById('legal-copy');
  if (copy) {
    copy.textContent = `© ${PUBLISHER.copyrightYear} ${PUBLISHER.displayName}. ${APP.name} v${APP.version}`;
  }

  const ageText = document.getElementById('age-gate-text');
  if (ageText) ageText.textContent = LEGAL.ageGateText;

  const invite = document.getElementById('invite-section');
  if (invite && isAppStoreBuild()) invite.hidden = true;

  const note = document.getElementById('paywall-note');
  if (note && isAppStoreBuild()) {
    note.textContent =
      'サブスクリプションはAppleのアプリ内課金で処理されます。自動更新の管理・解約はiPhoneの設定→サブスクリプションから行えます。リアルマネー賭博は扱いません。';
  }
}

export function setupAgeGate() {
  const gate = document.getElementById('age-gate');
  if (!gate) return Promise.resolve(true);

  if (localStorage.getItem(AGE_KEY) === '1') {
    gate.hidden = true;
    return Promise.resolve(true);
  }

  gate.hidden = false;
  return new Promise((resolve) => {
    document.getElementById('btn-age-yes')?.addEventListener(
      'click',
      () => {
        localStorage.setItem(AGE_KEY, '1');
        gate.hidden = true;
        resolve(true);
      },
      { once: true }
    );
    document.getElementById('btn-age-no')?.addEventListener(
      'click',
      () => {
        gate.innerHTML = `<div class="age-gate__card"><h1>ご利用いただけません</h1><p>本アプリは${LEGAL.minAge}歳以上向けです。</p></div>`;
        resolve(false);
      },
      { once: true }
    );
  });
}

/**
 * App Store版: 招待コードでは有料解除しない（ガイドライン 3.1.1 対策）
 */
export function redeemInviteForStore(raw) {
  if (isAppStoreBuild()) {
    return {
      ok: false,
      message: 'App Store版では招待コードでのPro解除はできません。App内課金をご利用ください。',
    };
  }
  return null; // 呼び出し側で通常redeem
}

/**
 * 購入（本番は StoreKit）。審査用ビルドでは説明のみ／未接続。
 */
export async function purchasePro() {
  if (!isAppStoreBuild()) {
    unlockPro();
    return { ok: true, message: '開発用にProを解除しました' };
  }
  // TODO: StoreKit / RevenueCat
  return {
    ok: false,
    message: `App内課金（${IAP.productId}）はXcode接続後に有効になります。価格 ${IAP.priceLabel}`,
  };
}

export async function restorePro() {
  if (!isAppStoreBuild()) {
    return { ok: false, message: '開発ビルドに復元対象はありません' };
  }
  // TODO: StoreKit restore
  return { ok: false, message: '購入の復元はStoreKit接続後に利用できます' };
}

export { APP, PUBLISHER, LEGAL, IAP, APP_STORE_BUILD };
