/**
 * App Store 提出用設定
 */

/** true にすると審査向け挙動（招待コード解除オフ・仮広告オフ・課金UI） */
export const APP_STORE_BUILD = true;

export const APP = {
  name: 'YOMI',
  nameJa: 'YOMI - ポーカー確率デスク',
  subtitle: '読みと確率デスク',
  // アプリの世界で一意なID。後から変更しにくいのでこのままでOK（好みで変えても可）
  bundleId: 'com.yuyataga.yomi',
  version: '1.0.0',
  build: '1',
};

/** 販売元・サポート情報 */
export const PUBLISHER = {
  displayName: '多賀友哉',
  displayNameEn: 'YUYA TAGA',
  supportEmail: 'usopperman@gmail.com',
  supportUrl: './support.html',
  privacyUrl: './privacy.html',
  termsUrl: './terms.html',
  copyrightYear: 2026,
};

export const LEGAL = {
  minAge: 17,
  ageGateText: 'このアプリは17歳以上向けです。リアルマネーの賭博は扱いません。',
  disclaimer:
    'YOMIはポーカー学習・確率計算のためのツールです。現金やチップの賭け、オンラインカジノへの誘導は行いません。',
};

export const IAP = {
  productId: 'yomi_pro_monthly',
  priceLabel: '¥480 / 月',
  mockPurchaseInDev: false,
};
