import { APP_STORE_BUILD, APP, PUBLISHER, LEGAL, IAP, ALLOW_TEST_PRO } from './storeConfig.js';
import { unlockPro, isPro, setPlan, PLAN, downgradeToFree } from './premium.js';
import {
  purchaseSubscription,
  restoreSubscription,
  queryProEntitlement,
  fetchStorePriceLabel,
  isNativeIapAvailable,
} from './iap.js';

const AGE_KEY = 'yomi_age_ok_v1';

export function isAppStoreBuild() {
  return APP_STORE_BUILD === true;
}

export function applyPublisherUi() {
  const disc = document.getElementById('legal-disclaimer');
  if (disc) disc.textContent = LEGAL.disclaimer;

  const copy = document.getElementById('legal-copy');
  if (copy) {
    copy.textContent = `© ${PUBLISHER.copyrightYear} ${PUBLISHER.brandCredit || APP.name}. v${APP.version}`;
  }

  const ageText = document.getElementById('age-gate-text');
  if (ageText) ageText.textContent = LEGAL.ageGateText;

  const invite = document.getElementById('invite-section');
  if (invite && isAppStoreBuild()) invite.hidden = true;

  const note = document.getElementById('paywall-note');
  if (note && isAppStoreBuild()) {
    note.textContent =
      'サブスクリプション名: YOMI Pro。期間: 1か月。価格は上記表示（自動更新）。管理・解約はiPhoneの設定→Apple ID→サブスクリプション。リアルマネー賭博は扱いません。';
  }

  const privacy = document.getElementById('paywall-privacy');
  if (privacy) {
    privacy.href = PUBLISHER.privacyUrl;
  }
  const terms = document.getElementById('paywall-terms');
  if (terms) {
    terms.href = PUBLISHER.termsUrl;
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
 * 購入（本番は StoreKit / @capgo/native-purchases）
 */
export async function purchasePro() {
  if (!isAppStoreBuild() || ALLOW_TEST_PRO) {
    unlockPro();
    return {
      ok: true,
      message: ALLOW_TEST_PRO && isAppStoreBuild()
        ? 'テスト用にProを解除しました（提出前に ALLOW_TEST_PRO を false に）'
        : '開発用にProを解除しました',
    };
  }

  const result = await purchaseSubscription();
  if (result.ok) unlockPro();
  return result;
}

export async function restorePro() {
  if (!isAppStoreBuild() || ALLOW_TEST_PRO) {
    if (isPro()) return { ok: true, message: 'Proは有効です' };
    if (ALLOW_TEST_PRO) {
      unlockPro();
      return { ok: true, message: 'テスト用にProを復元（解除）しました' };
    }
    return { ok: false, message: '開発ビルドに復元対象はありません' };
  }

  const result = await restoreSubscription();
  if (result.ok) unlockPro();
  return result;
}

/**
 * 起動時などに StoreKit の購読状態をローカルプランへ反映
 */
export async function syncProFromStore() {
  if (!isAppStoreBuild() || ALLOW_TEST_PRO || !isNativeIapAvailable()) {
    return { synced: false };
  }

  const entitlement = await queryProEntitlement();
  if (!entitlement.ok) return { synced: false, ...entitlement };

  if (entitlement.active) {
    unlockPro();
  } else if (isPro()) {
    // 期限切れ・未購読なら Free に戻す（ローカルだけの Pro を残さない）
    downgradeToFree();
  }
  return { synced: true, active: entitlement.active };
}

/** ペイウォール表示用。Store 価格があれば優先 */
export async function resolveProPriceLabel() {
  if (!isAppStoreBuild() || ALLOW_TEST_PRO || !isNativeIapAvailable()) {
    return IAP.priceLabel;
  }
  const store = await fetchStorePriceLabel();
  return store || IAP.priceLabel;
}

export function clearAgeGate() {
  try {
    localStorage.removeItem(AGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * テスト用: Pro・年齢確認・計算回数などを初期化
 */
export function resetLocalTestState() {
  clearAgeGate();
  setPlan(PLAN.free);
  try {
    localStorage.removeItem('yomi_redeemed_code_v1');
    localStorage.removeItem('yomi_calc_count_v1');
    localStorage.removeItem('yomi_last_ad_at_v1');
  } catch {
    /* ignore */
  }
}
