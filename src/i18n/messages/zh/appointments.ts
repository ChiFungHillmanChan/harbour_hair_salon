import type { Localized, Messages } from '../types';

const appointments: Localized<Messages['appointments']> = {
  meta: {
    title: '我的預約',
    description: '查看、取消或更改你的髮型預約。',
  },
  title: '我的預約',
  upcoming: {
    heading: '即將來臨',
    empty: '暫時沒有即將來臨的預約。',
  },
  past: {
    heading: '過往預約',
    empty: '暫時沒有過往預約。',
  },
  status: {
    PENDING: '待確認',
    CONFIRMED: '已確認',
    CANCELLED: '已取消',
    COMPLETED: '已完成',
  },
  card: {
    withStylist: '髮型師：{name}',
    when: '{date} {time}',
    reschedule: '改期',
    cancel: '取消預約',
    cancelling: '正在取消…',
    withdraw: '撤回預約要求',
    leaveReview: '撰寫評價',
    reviewSubmitted: '已提交評價',
    confirmCancel: '確定要取消此預約嗎？',
    cancelFailed: '未能取消預約',
    unexpectedError: '發生錯誤。請再試一次，或致電本店。',
    rescheduleUnavailable: '暫時未能於網上改期，請致電本店',
    rescheduleTooLate: '預約前 24 小時內不能改期',
    cancelTooLate: '預約前 24 小時內不能取消',
    awaitingConfirmation: '正等待本店確認，確認後我們會以電郵通知你。',
    changesLocked: '預約前 24 小時內不能作任何更改。',
    maintenance: '預約系統正在維護，暫時未能於網上改期。如需更改此預約，請致電本店。',
  },
  reschedule: {
    title: '更改預約時間',
    close: '關閉',
    date: '選擇新日期',
    loadingSlots: '正在載入可預約時段…',
    noSlots: '此日期沒有可預約的時段。',
    times: '可預約時間',
    old: '原定：',
    new: '改為：',
    dateTime: '{date} {time}',
    cancel: '取消',
    confirm: '確認',
    submitting: '正在改期…',
    slotsFailed: '未能載入可預約時間。請再試一次，或致電本店。',
    failed: '未能改期',
    unexpectedError: '發生錯誤。請再試一次，或致電本店。',
  },
};

export default appointments;
