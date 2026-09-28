import type { Localized, Messages } from '../types';

const home: Localized<Messages['home']> = {
  meta: {
    title: 'Harbour Hair Salon 列斯｜列斯市中心專業髮型屋',
    description: '於列斯 Central Arcade 的 Harbour Hair Salon 預約，由香港培訓的髮型師提供剪髮、染髮、電髮及修容服務。',
    ogTitle: 'Harbour Hair Salon｜列斯專業髮型屋',
    ogDescription: '列斯市中心的專業髮型屋，今日即可網上預約。',
  },
  page: {
    faqTitle: '常見問題解答',
    faqIntro: '首次光臨列斯 Harbour Hair Salon 前需要知道的一切。',
    schemaDescription: '位於列斯市中心的專業髮型屋，由香港培訓的髮型師提供剪髮、染髮、電髮及修容服務。',
  },
  hero: {
    defaultEyebrow: '列斯市中心',
    defaultTitleLine1: '專業髮型',
    defaultTitleLine2: '設計',
    defaultSubtitle: '由香港培訓的髮型師為你度身打造剪髮、染髮及修容服務，每次預約都精準細緻、講究手藝。',
    imageAlt: 'Harbour Hair Salon 位於列斯 Central Arcade 的店內環境',
    bookAppointment: '預約服務',
    viewServices: '查看服務',
  },
  socialProof: {
    label: '顧客評價',
    rated: '評分 {value} 分（滿分 5 分）',
    verifiedReviews: { other: '<count>{count}</count> 則已驗證顧客評價' },
  },
  trustBar: {
    label: '選擇 Harbour Hair Salon 的理由',
    hongKongTrained: '香港培訓髮型師',
    expertServices: '專業剪髮、染髮及電髮',
    location: '列斯 Central Arcade，LS1 6DX',
    openDaily: '一星期 7 天營業',
    bookOnTreatwell: '於 Treatwell 預約',
    findOnGoogle: '於 Google 查看我們',
  },
  stylists: {
    eyebrow: '我們的團隊',
    titleStart: '認識我們的',
    titleEnd: '髮型師',
    intro: '我們的香港培訓髮型師一絲不苟，為你提供度身訂造的剪髮及修容服務。',
    portraitAlt: '{name}－Harbour Hair Salon 列斯{role}',
    viewProfile: '查看簡介',
    meetTeam: '認識整個團隊',
  },
  visit: {
    title: '歡迎到訪及關注我們',
    body: '歡迎光臨我們位於列斯市中心的店舖，經 Treatwell 預約，或於 Instagram 關注我們。',
    bookOnTreatwell: '於 Treatwell 預約',
    directions: '路線及 Google 評價',
  },
  faq: {
    defaultTitle: '常見問題',
  },
};

export default home;
