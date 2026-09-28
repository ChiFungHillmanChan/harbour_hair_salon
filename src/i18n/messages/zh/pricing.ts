import type { Localized, Messages } from '../types';

const pricing: Localized<Messages['pricing']> = {
  hairLength: {
    SHORT: '短髮',
    MEDIUM: '中髮',
    LONG: '長髮',
    EXTRA_LONG: '特長髮',
  },
  priceType: {
    STANDARD: '一般價',
    NHS: 'NHS 價',
  },
  columns: {
    option: '選項',
    standard: '一般價',
    nhs: 'NHS 價',
  },
  nhsApplies: 'NHS 優惠適用',
  nhsApplied: '已套用 NHS 價',
  vatExcluded: '未含 VAT',
  subjectToConsultation: '價錢或會於諮詢後調整',
  extraLongBreakdown: '長髮價 {base} ＋ 特長髮附加 {surcharge}',
  minutes: { other: '{count} 分鐘' },
  durationAtConsultation: '所需時間於諮詢時確認',
  noNhsPrice: '沒有 NHS 價',
  unknownPrice: '未有記錄價格',
  unknownPriceHelp: '此預約於系統開始為每個預約記錄價格之前建立。如需知道金額，請向本店查詢。',
  from: '價格由',
  range: '{min}至{max}',
  notBookableOnline: '此選項請致電本店預約',
  discountsPaused: '優惠及優惠碼現正暫停，所示價格為列明價格。',
  categories: {
    Haircuts: '剪髮',
    Colouring: '染髮',
    Perms: '電髮',
    Treatments: '護理',
    Styling: '造型',
    Consultation: '諮詢',
  },
  priceLabel: '價格',
};

export default pricing;
