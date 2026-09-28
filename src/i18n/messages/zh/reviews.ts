import type { Localized, Messages } from '../types';

const reviews: Localized<Messages['reviews']> = {
  meta: {
    title: '顧客評價',
    description: '閱讀列斯 Harbour Hair Salon 顧客的已驗證評價，了解顧客對我們香港培訓髮型師、剪髮、染髮及護理服務的意見。',
    ogTitle: '顧客評價｜Harbour Hair Salon 列斯',
    ogDescription: '列斯市中心 Harbour Hair Salon 的已驗證顧客評價。',
  },
  breadcrumb: {
    home: '主頁',
    reviews: '顧客評價',
  },
  hero: {
    titleStart: '顧客',
    titleEnd: '評價',
    subtitle: '來自每位坐上我們髮型椅的顧客的真實意見。',
    average: '{average} / 5',
    fromCount: { other: '根據 {count} 則已驗證評價' },
  },
  rated: '評分 {value} 分（滿分 5 分）',
  anonymous: 'Harbour Hair 顧客',
  schemaFallbackBody: '於 Harbour Hair Salon 享用{service}服務。',
  empty: {
    title: '成為第一位留下評價的顧客',
    body: '我們剛開始收集顧客意見。如你曾經光臨，歡迎分享你的體驗。',
    cta: '評價過往預約',
  },
  bookVisit: '預約光臨',
  new: {
    meta: {
      title: '留下評價',
      description: '分享你在 Harbour Hair Salon 的體驗。',
    },
    alreadySubmittedTitle: '已提交評價',
    alreadySubmittedBody: '謝謝！你已就這次預約分享過意見。',
    notReadyTitle: '暫時未能評價',
    notReadyBody: '完成預約後即可留下評價。',
    backToBookings: '返回我的預約',
    titleStart: '這次',
    titleEnd: '體驗如何？',
    subtitle: '你的意見有助我們改進，亦能幫助其他顧客找到合適的髮型師。',
    yourAppointment: '你的預約',
    withOn: '髮型師：{stylist}｜日期：{date}',
  },
  form: {
    thankYou: '謝謝！',
    submitted: '你的評價已提交，審核後便會刊登。',
    rating: '你的評分',
    ratingGroup: '評分（滿分 5 分）',
    stars: { other: '{count} 星' },
    comment: '想分享更多？',
    optional: '（選填）',
    placeholder: '你最喜歡哪方面？有甚麼地方可以做得更好？',
    submitting: '正在提交…',
    submit: '提交評價',
  },
  errors: {
    INVALID: '評價資料無效。',
    RATING_REQUIRED: '請選擇 1 至 5 分的評分。',
    COMMENT_TOO_LONG: '評語請保持在 1000 字以內。',
    NOT_FOUND: '找不到此預約。',
    ALREADY_REVIEWED: '你已就這次預約留下評價。',
    CANCELLED: '只可評價你實際出席的預約。',
    NOT_YET: '預約完成後才可留下評價。',
    UNAUTHORIZED: '未獲授權',
    INVALID_MODERATION: '審核資料無效',
    REVIEW_GONE: '此評價已不存在。',
    MODERATION_FAILED: '未能更新此評價，請再試一次。',
  },
};

export default reviews;
