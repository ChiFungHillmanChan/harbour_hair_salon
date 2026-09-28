import type { Localized, Messages } from '../types';

const services: Localized<Messages['services']> = {
  meta: {
    title: '列斯髮型服務與價目',
    description: 'Harbour Hair Salon（列斯市中心）完整服務價目，包括剪髮、染髮、電髮及護理，列明一般價及 NHS 價，可網上預約。',
    ogTitle: '服務與價目｜Harbour Hair Salon 列斯',
    ogDescription: '剪髮、染髮、電髮及護理完整價目，列明一般價及 NHS 價，可網上預約。',
  },
  hero: {
    titleStart: '服務與',
    titleEnd: '價目',
    subtitle: '列斯市中心的專業髮型服務，為你度身打造合適造型。',
    imageAlt: 'Harbour Hair Salon 列斯的髮型服務',
  },
  list: {
    categoriesLabel: '服務類別',
    category: '類別',
    learnMore: '了解更多{category}服務',
    nhsNote: '設有 NHS 選項的服務會同時列出 NHS 價。所示為列明價格；優惠及優惠碼現正暫停。',
  },
  book: '預約服務',
  faqTitle: '服務常見問題',
  faqIntro: '有關我們列斯分店剪髮、染髮、電髮及護理服務的常見問題。',
  breadcrumb: {
    label: '導覽路徑',
    home: '主頁',
    services: '服務',
    servicesPricing: '服務與價目',
  },
  jsonLd: {
    catalogName: 'Harbour Hair Salon 服務',
    serviceAt: 'Harbour Hair Salon 的{name}',
    serviceAtLeeds: 'Harbour Hair Salon（列斯）的{name}。',
  },
  category: {
    heroImageAlt: 'Harbour Hair Salon 的{title}',
    heroSuffix: '・列斯',
    pricingTitle: '{category}價目',
    pricingSoon: '價目即將公布，詳情請致電本店查詢。',
    includes: '服務包括',
    process: '服務流程',
    aftercare: '護理建議',
    bookCategory: '預約{category}',
    faqTitle: '{category}常見問題',
    faqIntro: '有關 Harbour Hair Salon {category}服務的常見問題。',
    related: '你可能也有興趣',
    explore: '探索',
    relatedTitle: '列斯{hero}',
    learnMore: '了解更多',
  },
  menu: {
    eyebrow: '服務項目',
    defaultTitle: '我們的服務',
    signatureTitle: '招牌服務',
    viewFullMenu: '查看完整價目',
    bookAppointment: '預約服務',
    nhsAvailable: '設有 NHS 價',
    fromPrice: '{price} 起',
  },
};

export default services;
