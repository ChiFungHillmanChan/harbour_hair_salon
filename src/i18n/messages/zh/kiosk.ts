import type { Localized, Messages } from '../types';

const kiosk: Localized<Messages['kiosk']> = {
  meta: {
    title: '員工打卡',
  },
  title: '員工打卡',
  roster: {
    onShift: '● 當值中',
    off: '○ 未上班',
    empty: '此裝置未啟用打卡模式，或沒有在職員工。',
  },
  pin: {
    clockIn: '上班打卡',
    clockOut: '下班打卡',
    label: '{name} 的 PIN',
    placeholder: '輸入 PIN',
    back: '返回',
    confirm: '確認',
  },
  result: {
    clockedIn: '{name}：已上班打卡 ✓',
    clockedOut: '{name}：已下班打卡 ✓',
    connection: '連線出現問題——請再試一次。',
  },
  errors: {
    NOT_ENABLED: '此裝置未啟用打卡模式',
    RATE_LIMITED: '嘗試次數過多，請等候幾分鐘再試。',
    UNKNOWN_EMPLOYEE: '找不到此員工',
    WRONG_PIN: 'PIN 不正確',
    RETRY: '請再試一次',
  },
};

export default kiosk;
