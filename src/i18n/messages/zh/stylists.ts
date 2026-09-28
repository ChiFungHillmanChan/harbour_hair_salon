import type { Localized, Messages } from '../types';

const stylists: Localized<Messages['stylists']> = {
  meta: {
    title: '認識我們的髮型師',
    description: '認識列斯市中心 Harbour Hair Salon 的香港培訓髮型師：我們的團隊、各人專長，以及預約當日的安排。',
    ogTitle: '認識我們的髮型師｜Harbour Hair Salon 列斯',
    ogDescription: 'Harbour Hair Salon 列斯的香港培訓髮型師及其專長。',
  },
  breadcrumb: {
    label: '導覽路徑',
    home: '主頁',
    stylists: '髮型師',
  },
  index: {
    titleStart: '認識我們的',
    titleEnd: '團隊',
    subtitle: '一班香港培訓的髮型師，駐守列斯市中心，各有獨特風格與專長。',
    empty: '我們將於稍後在此介紹團隊成員。',
    portraitAlt: '{name}，Harbour Hair Salon 列斯{role}',
    viewProfile: '查看簡介',
    schemaName: 'Harbour Hair Salon 的髮型師',
  },
  detail: {
    metaTitle: '{name}－{role}',
    ogTitle: '{name}－{role}｜Harbour Hair Salon 列斯',
    metaDescriptionFallback: '認識 Harbour Hair Salon 列斯的{role} {name}，今日即可網上預約。',
    schemaDescriptionFallback: 'Harbour Hair Salon 列斯的{role}。',
    portraitAlt: '{name}，Harbour Hair Salon 列斯{role}',
    experience: '經驗',
    years: '{count} 年以上',
    trainedIn: '培訓地點',
    languages: '服務語言',
    defaultLanguage: '英語',
    listSeparator: '、',
    bookWith: '預約 {name}',
    about: '關於 {name}',
    specialties: '專長',
    related: '認識團隊其他成員',
    viewProfile: '查看簡介',
  },
  defaultSpecialties: {
    colouring: '染髮',
    balayage: '手刷漸層染及挑染',
    colourCorrection: '髮色修正',
    toning: '調色及亮澤護理',
    mensCuts: '男士剪髮',
    beard: '鬍鬚修剪',
    barbering: '經典男士理髮',
    childrensCuts: '兒童剪髮',
    precisionCuts: '精準剪髮',
    blowDries: '造型及吹髮',
    consultation: '諮詢及護理建議',
  },
};

export default stylists;
