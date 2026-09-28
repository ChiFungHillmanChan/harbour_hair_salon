import type { Localized, Messages } from '../types';

const admin: Localized<Messages['admin']> = {
  monthSelector: {
    previous: '上一個月：{period}',
    next: '下一個月：{period}',
    month: '月份',
    year: '年份',
    go: '前往',
  },
  sidebar: {
    title: '管理後台',
    navLabel: '管理後台導覽',
    openMenu: '開啟管理選單',
    closeMenu: '關閉管理選單',
    loggedInAs: '目前登入',
    signOut: '登出',
    signingOut: '正在登出…',
  },
  nav: {
    schedule: '預約時間表',
    openingHours: '營業時間',
    services: '服務及價目',
    categories: '分類頁面',
    stylists: '髮型師',
    faqs: '常見問題',
    discounts: '優惠碼',
    offers: '優惠',
    reviews: '評論',
    journal: '網誌',
    users: '管理員帳戶',
    settings: '網站設定',
    integrations: '整合設定',
    operations: '營運狀態',
    employees: '員工',
    timesheets: '工時記錄',
    shifts: '排班',
    payroll: '薪酬',
    kiosk: '打卡裝置',
  },
};

export default admin;
