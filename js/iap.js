import { IAP } from './storeConfig.js';

const PRODUCT_TYPE_SUBS = 'subs';

function capacitor() {
  return globalThis.Capacitor ?? null;
}

function isNativeApp() {
  const cap = capacitor();
  try {
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
}

function getPlugin() {
  if (!isNativeApp()) return null;
  return capacitor()?.Plugins?.NativePurchases ?? null;
}

function errorMessage(err) {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('cancel') ||
    lower.includes('user cancelled') ||
    lower.includes('user canceled') ||
    err?.code === 'USER_CANCELLED' ||
    err?.code === '1'
  ) {
    return '購入をキャンセルしました';
  }
  if (lower.includes('product') && (lower.includes('not found') || lower.includes('unavailable'))) {
    return `商品（${IAP.productId}）を取得できませんでした。App Store Connect のサブスク設定を確認してください。`;
  }
  return raw || '購入処理に失敗しました';
}

function hasActivePro(purchases) {
  const list = Array.isArray(purchases) ? purchases : [];
  return list.some((p) => {
    if (!p || p.productIdentifier !== IAP.productId) return false;
    if (p.isActive === true) return true;
    if (p.isActive === false) return false;
    if (p.expirationDate) {
      const exp = Date.parse(p.expirationDate);
      if (Number.isFinite(exp)) return exp > Date.now();
    }
    // expiration が無いが同一 product がある場合は有効とみなす（復元直後など）
    return true;
  });
}

export function isNativeIapAvailable() {
  return !!getPlugin();
}

/**
 * App Store の表示価格を取得（失敗時は null）
 */
export async function fetchStorePriceLabel() {
  const plugin = getPlugin();
  if (!plugin?.getProducts) return null;
  try {
    const { products } = await plugin.getProducts({
      productIdentifiers: [IAP.productId],
      productType: PRODUCT_TYPE_SUBS,
    });
    const product = products?.[0];
    const price = product?.priceString || product?.localizedPrice;
    if (!price) return null;
    return `${price} / 月`;
  } catch {
    return null;
  }
}

/**
 * 端末の購入履歴から Pro 可否を判定
 * @param {{ restore?: boolean }} [opts]
 * restore:true のときだけ AppStore.sync（購入を復元）を呼ぶ。
 * 起動時同期で sync すると毎回 Apple ID / App Store アカウント表示が出るので禁止。
 */
export async function queryProEntitlement(opts = {}) {
  const plugin = getPlugin();
  if (!plugin) return { ok: false, active: false, reason: 'plugin' };
  const shouldRestore = opts.restore === true;

  try {
    const supported = await plugin.isBillingSupported();
    if (!supported?.isBillingSupported) {
      return { ok: false, active: false, reason: 'unsupported' };
    }

    // AppStore.sync() はアカウント認証シートを出す。ユーザーが「購入を復元」したときだけ。
    if (shouldRestore && typeof plugin.restorePurchases === 'function') {
      try {
        await plugin.restorePurchases();
      } catch {
        /* getPurchases で続行 */
      }
    }

    const { purchases } = await plugin.getPurchases({ productType: PRODUCT_TYPE_SUBS });
    const active = hasActivePro(purchases);
    return { ok: true, active, purchases };
  } catch (err) {
    return { ok: false, active: false, reason: 'error', message: errorMessage(err) };
  }
}

export async function purchaseSubscription() {
  const plugin = getPlugin();
  if (!plugin) {
    return {
      ok: false,
      message: 'App内課金は iOS アプリ上でのみ利用できます',
    };
  }

  try {
    const supported = await plugin.isBillingSupported();
    if (!supported?.isBillingSupported) {
      return { ok: false, message: 'この端末ではApp内課金を利用できません' };
    }

    await plugin.purchaseProduct({
      productIdentifier: IAP.productId,
      productType: PRODUCT_TYPE_SUBS,
    });

    const entitlement = await queryProEntitlement();
    if (entitlement.active) {
      return { ok: true, message: 'YOMI Pro が有効になりました' };
    }
    // 購入直後は反映が遅れることがある
    return { ok: true, message: '購入が完了しました' };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export async function restoreSubscription() {
  const plugin = getPlugin();
  if (!plugin) {
    return {
      ok: false,
      message: '購入の復元は iOS アプリ上でのみ利用できます',
    };
  }

  try {
    const entitlement = await queryProEntitlement({ restore: true });
    if (!entitlement.ok) {
      return {
        ok: false,
        message: entitlement.message || '購入情報を取得できませんでした',
      };
    }
    if (entitlement.active) {
      return { ok: true, message: '購入を復元しました。YOMI Pro が有効です' };
    }
    return { ok: false, message: '復元できる購入が見つかりませんでした' };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}
