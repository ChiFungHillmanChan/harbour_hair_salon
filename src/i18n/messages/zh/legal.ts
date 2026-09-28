import type { Localized, Messages } from '../types';

const legal: Localized<Messages['legal']> = {
  privacy: {
    meta: {
      title: '私隱政策',
      description: 'Harbour Hair Salon 如何處理預約、帳戶及推廣資料。',
    },
    title: '私隱政策',
    lastUpdated: '最後更新：{date}',
    whoTitle: '關於我們',
    whoBody: 'Harbour Hair Salon 的營業地址為 Upper Floor, Unit 15 Central Arcade, Central Rd, Leeds LS1 6DX。你可致電 {phone}，或透過<link>聯絡我們</link>頁面上的資料與我們聯絡。',
    collectTitle: '我們收集的資料',
    collectBody: '我們收集處理髮型屋預約及顧客帳戶所需的資料，包括姓名、電郵地址、電話號碼、預約詳情、服務紀錄、你提交的評價內容，以及推廣訂閱偏好。',
    useTitle: '我們如何使用資料',
    useBody: '我們使用你的資料來建立及管理預約、發送預約確認、提醒及評價邀請、管理顧客帳戶、處理髮型屋行政工作、防止濫用，並只會在你已訂閱的情況下發送推廣電郵。',
    providersTitle: '服務供應商',
    providersBody: '我們使用可信賴的供應商營運網站、資料庫、電郵發送、數據分析及髮型屋排程整合。這些供應商只會在提供相關服務所需的範圍內處理資料。',
    marketingTitle: '推廣電郵',
    marketingBody: '你可隨時透過電郵內的取消訂閱連結，或前往<link>取消訂閱頁面</link>，停止接收推廣電郵。為提供你所要求的服務，我們仍可能在有需要時發送預約及帳戶電郵。',
    rightsTitle: '你的權利',
    rightsBody: '在符合法律及營運紀錄保存要求的前提下，你可要求查閱、更正或刪除我們持有的個人資料。如有需要，請聯絡本店提出要求。',
  },
  unsubscribe: {
    meta: {
      title: '取消訂閱推廣電郵',
      description: '取消訂閱 Harbour Hair Salon 的推廣電郵。',
    },
    title: '取消訂閱',
    intro: '請輸入你的電郵地址，我們會將其從 Harbour Hair Salon 推廣電郵名單中移除。預約確認、預約變更及服務相關電郵仍可能在有需要時發送。',
    help: '需要協助？<link>聯絡本店</link>。',
    email: '電郵地址',
    placeholder: 'you@example.com',
    submit: '取消訂閱',
    updating: '正在更新...',
    results: {
      RATE_LIMITED: '請求次數過多，請於一小時後再試。',
      INVALID_EMAIL: '請輸入有效的電郵地址。',
      UNAVAILABLE: '暫時未能取消訂閱，請聯絡本店。',
      FAILED: '取消訂閱失敗，請稍後再試。',
      SUCCESS: '你已取消訂閱推廣電郵。',
    },
  },
};

export default legal;
