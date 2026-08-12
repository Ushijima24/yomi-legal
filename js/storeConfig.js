/**
 * App Store 提出用設定
 */

/** true にすると審査向け挙動（招待コード解除オフ・仮広告オフ・課金UI） */
export const APP_STORE_BUILD = true;

export const APP = {
  name: 'YOMI',
  nameJa: 'YOMI - ポーカー確率デスク',
  subtitle: '勝率とアクション最適化',
  bundleId: 'com.yuyataga.yomi',
  version: '1.0.0',
  build: '1',
};

/** 販売元・サポート情報 */
export const PUBLISHER = {
  displayName: '多賀友哉',
  displayNameEn: 'YUYA TAGA',
  /** アプリ内フッター用。ブランド名でOK（法務ページ・Storeは本名のまま） */
  brandCredit: 'YOMI',
  supportEmail: 'usopperman@gmail.com',
  supportUrl: 'https://ushijima24.github.io/yomi-legal/support.html',
  privacyUrl: 'https://ushijima24.github.io/yomi-legal/privacy.html',
  termsUrl: 'https://ushijima24.github.io/yomi-legal/terms.html',
  copyrightYear: 2026,
};

export const LEGAL = {
  minAge: 17,
  ageGateText: 'このアプリは17歳以上向けです。リアルマネーの賭博は扱いません。',
  disclaimer:
    'YOMIはポーカー学習・確率計算のためのツールです。現金やチップの賭け、オンラインカジノへの誘導は行いません。',
};

/** true なら課金ボタンでローカルPro解除（提出前に必ず false） */
export const ALLOW_TEST_PRO = true;

export const IAP = {
  productId: 'yomi_pro_monthly',
  priceLabel: '¥480 / 月',
  mockPurchaseInDev: false,
};
