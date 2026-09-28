import type { Localized, Messages } from '../types';

const offers: Localized<Messages['offers']> = {
  meta: {
    title: '列斯特別優惠及推廣',
    description: '列斯市中心 Harbour Hair Salon 的季節性獨家推廣及特別優惠，剪髮、染髮及護理服務均可享折扣。',
    ogTitle: '特別優惠｜Harbour Hair Salon 列斯',
    ogDescription: '季節性獨家推廣，於我們列斯市中心的髮型屋享用剪髮、染髮及護理優惠。',
    pausedTitle: '優惠及推廣',
    pausedDescription: '列斯市中心 Harbour Hair Salon 的優惠及折扣碼現正暫停，服務頁所列的價格即為標價。',
    pausedOgTitle: '優惠｜Harbour Hair Salon 列斯',
  },
  breadcrumb: {
    home: '主頁',
    offers: '特別優惠',
  },
  hero: {
    imageAlt: 'Harbour Hair Salon 列斯的特別優惠',
    titleStart: '特別',
    titleEnd: '優惠',
    subtitle: '我們列斯市中心髮型屋的季節性獨家推廣，助你提升個人風格。',
    pausedSubtitle: '日後如有任何推廣，我們會在此公布。',
  },
  paused: {
    title: '優惠暫停中',
    body: '我們目前沒有提供任何優惠或折扣碼，所有預約均不設折扣。服務頁所列的價格即為標價。',
    cta: '查看服務及價目',
  },
  empty: {
    title: '優惠籌備中',
    body: '我們正籌劃新的體驗。歡迎加入以下名單，率先收到最新優惠消息。',
  },
  card: {
    limitedTime: '期間限定',
    percentOff: '{value}%',
    offService: '服務折扣',
    book: '立即預約',
  },
};

export default offers;
