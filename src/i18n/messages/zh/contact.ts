import type { Localized, Messages } from '../types';

const contact: Localized<Messages['contact']> = {
  meta: {
    title: '聯絡我們及列斯市中心店舖位置',
    description: '歡迎光臨 Harbour Hair Salon，地址：Unit 15 Central Arcade, Leeds LS1 6DX。查看營業時間、由列斯火車站前往的路線及聯絡資料。',
    ogTitle: '聯絡 Harbour Hair Salon｜列斯市中心',
    ogDescription: '店舖位於 Central Arcade, Leeds LS1 6DX。查看營業時間、交通路線及聯絡資料。',
  },
  breadcrumb: {
    home: '主頁',
    contact: '聯絡我們',
  },
  hero: {
    imageAlt: 'Harbour Hair Salon 位於列斯 Central Arcade 的店舖',
    titleStart: '聯絡',
    titleEnd: '我們',
    subtitle: '店舖位於列斯市中心的核心地段',
  },
  location: {
    heading: '地址',
    note: '店舖位於 Central Arcade 商場內，由列斯火車站步行前往只需數分鐘。',
  },
  touch: {
    heading: '聯絡方法',
    phone: '電話',
  },
  hours: {
    heading: '營業時間',
  },
  map: {
    title: 'Harbour Hair Salon 的 Google 地圖位置－Central Arcade, Leeds LS1 6DX',
  },
  follow: {
    heading: '搜尋及關注我們',
    bookOnTreatwell: '於 Treatwell 預約',
    directions: '查看路線及 Google 評價',
  },
  cta: {
    title: '想換個新造型？',
    body: '今日即可網上預約，讓我們的專業髮型師為你打理。',
    button: '預約服務',
  },
  faq: {
    title: '到訪 Harbour Hair Salon',
    intro: '交通路線、聯絡方法及管理預約。',
  },
  gallery: {
    title: '店舖環境',
    intro: '一覽 Harbour Hair 位於列斯市中心的工作室。',
    floorAlt: 'Harbour Hair 的髮型區，設有背光圓鏡及髮型椅',
    floorCaption: '髮型區',
    receptionAlt: '掛有 Harbour Hair 招牌的接待處',
    receptionCaption: '接待處',
    washAlt: '手繪書法牆旁的洗頭及護理區',
    washCaption: '洗頭及護理區',
    stationsAlt: '設有發光圓鏡的髮型工作位',
    stationsCaption: '髮型工作位',
    lightAlt: '自然光充足、配備專業焗髮機的髮型區',
    lightCaption: '自然光及焗髮機',
    retailAlt: '設有書法壁畫的接待及零售區',
    retailCaption: '零售區及書法壁畫',
    toolsAlt: 'Harbour Hair 工作位上的專業剪髮剪刀',
    toolsCaption: '精準工具',
  },
  social: {
    instagram: 'Instagram',
    treatwell: '於 Treatwell 預約',
    google: '於 Google 查看我們',
  },
};

export default contact;
