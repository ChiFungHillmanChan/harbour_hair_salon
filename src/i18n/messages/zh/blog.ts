import type { Localized, Messages } from '../types';

const blog: Localized<Messages['blog']> = {
  meta: {
    title: 'Harbour 網誌',
    description: '列斯市中心 Harbour Hair Salon 香港培訓髮型師分享的護髮指南、造型貼士及實用建議。',
    ogTitle: 'Harbour 網誌｜Harbour Hair Salon 列斯',
    ogDescription: 'Harbour Hair Salon 列斯髮型師分享的指南、貼士及建議。',
  },
  breadcrumb: {
    label: '導覽路徑',
    home: '主頁',
    journal: '網誌',
  },
  index: {
    heroAlt: 'Harbour Hair Salon 網誌',
    titleStart: 'Harbour',
    titleEnd: '網誌',
    subtitle: '由我們駐列斯的香港培訓髮型師分享護髮指南、造型貼士及坦誠建議。',
    schemaDescription: 'Harbour Hair Salon 列斯分享的護髮指南、造型貼士及建議。',
    emptyPage: '此頁暫無文章。',
    empty: '暫時未有文章，敬請期待。',
  },
  readingTime: '閱讀時間約 {count} 分鐘',
  readArticle: '閱讀文章',
  post: {
    ogTitle: '{title}｜Harbour Hair Salon 列斯',
    defaultSection: '護髮',
    filedUnder: '分類',
    writtenBy: '作者',
    ctaTitle: '準備好預約了嗎？',
    ctaBody: '一分鐘內即可完成網上預約。我們在列斯市中心提供專業剪髮、染髮、電髮及護理服務。',
    ctaButton: '預約服務',
    keepReading: '延伸閱讀',
    journal: '網誌',
  },
};

export default blog;
