# 正式網站登入及實際流程驗收 — 2026-09-20

本輪使用店主本人 Google 客人帳戶及 info@harbourhair.co.uk 管理員帳戶，直接操作 https://www.harbourhair.co.uk。登入由店主完成本人驗證／密碼輸入。沒有取得或保存密碼。

## 結論

後台核心預約流程及 Fresha → 網站匯入可運作，但**未達到全面開放客人自行預約一星期的條件**。網站 booking、客人自行改期及正式通知仍未啟用；Treatwell 入站來源仍然缺失。頁面可開啟不等於全部寫入操作已通過正式驗收。

## 本輪正式環境驗收

| 項目 | 實際結果 |
| --- | --- |
| Google 客人登入 | 成功；My Bookings 正常；客人進入 /admin 被送回首頁 |
| 管理員登入 | 成功；19 個導覽入口（含 Schedule 及 Kiosk）均可載入 |
| 公開頁面及保護 | 35 個 HTTP 檢查符合預期；包括 sitemap 中 20 個公開頁面、登入／重設入口、health、權限頁及三個 cron；無伺服器 fatal 頁面 |
| 公開服務 UI | 六個服務分類切換、FAQ 展開、聯絡資料、手機選單及固定預約按鈕正常 |
| 客人 booking 入口 | 正確顯示電話／Fresha／Treatwell；目前沒有直接建立網站預約的表格 |
| 後台新預約必填 | 空白客人名稱被拒絕 |
| 外部撞期及休息日 | Funky 9 月 22 日 10:00 顯示「休息日」及「synced busy time」提示；沒有選擇 Book anyway |
| 真正後台建立預約 | 店主本人帳戶，Funky，Consultation £0／15 分鐘，9 月 23 日 11:00；關閉確認郵件；建立成功 |
| 後台改期 | 同一測試單改至 11:30；日曆及客人頁面時間一致 |
| 客人自行改期 | 正確停用並提示致電店舖；因此未驗收正式客人自助改期成功路徑 |
| 客人取消 | 成功；客人頁面顯示 CANCELLED，Upcoming 空白；資料庫確認 CANCELLED |
| 日曆 | 日／週／月／年切換及年→月導航成功；正式 Fresha 來源、髮型師、英國時間、最後匯入時間可見 |
| 手機日曆 | 390px 下日／週／月的 Edit booking 入口實際打開同一筆測試單；沒有儲存已取消預約 |
| Operations 診斷 | 19:40 BST 新報告：資料庫、Resend sender domain、Redis、郵件設定、cron authentication 通過；通知未啟用未通過；沒有發送郵件 |
| 營業時間外 cron | 19:28 BST 左右呼叫正式已授權 calendar-sync：HTTP 200、outside-opening-hours、0 imports |

其他後台頁面（營業時間、價目、分類、髮型師、FAQ、折扣、優惠、評論、文章、帳戶、設定、整合、員工、工時、排班、薪酬、打卡）完成載入及可見控制項檢查。未為測試而修改真實價目、員工權限、工資、排班、公共文章或平台設定；不將這些只讀檢查聲稱為全部 CRUD 正式驗收。

## 測試資料清理

唯一新增預約：`cmua5path0001k104lfqrsukf`，備註以 `[TEST ONLY 2026-09-20]` 開頭。正式狀態已為 CANCELLED，保留稽核歷史。英國 11:30 正確儲存成 UTC 10:30。

改期與取消各產生一筆 PENDING outbox；正式通知開關保持 OFF。清理程序核對指定預約 ID、店主帳戶、測試備註及 CANCELLED 狀態，只把這兩筆 attempts=0、sentAt=NULL 的 PENDING 通知標記為 SKIPPED。沒有寄出郵件、沒有刪除預約或修改其他客人資料。

Chrome 原生 confirm 視窗一度令瀏覽器擴充控制停住，最後透過同一 CUA 工具的原生 Chrome 視窗按 OK 完成。這是驗收工具操作中斷，不是取消 API 失敗。

## 驗收發現及修正

1. 收工後最後一次 cron：原本只接受截止時間的第 0 秒，實際排程延遲幾十秒會錯誤跳過。改為分鐘精度，接受截止整分鐘，下一分鐘仍拒絕。BST/GMT 回歸先重現失敗，再修正通過。
2. 手機日／週及月曆清單缺少編輯入口：沿用既有 AppointmentDialog 加入 Edit booking，不增加新權限或放寬伺服器規則。
3. 手機週曆沒有顯示預約狀態：補上狀態標籤，並用 appointments 描述含歷史取消記錄的數量，避免誤看成有效 booked 時段。

最新 Node 24 完整測試：**628 passed、0 failed、0 skipped**。ESLint、TypeScript、git diff --check 通過。新增三個清單回歸測試，核對取消狀態可見、編輯目標 ID、UK 時間、時長快照及版本均正確。此前隔離 PostgreSQL 完整 booking lifecycle、併發／撞期／24 小時政策、outbox、權限及 build 證據見 production-sync-fixes-2026-09-20.md；本輪沒有把那些舊結果冒充新一輪正式操作。

## Neon 用量

2026-09-20 19:31 BST 讀取 Neon 專案用量：

- 當期 compute 42,543 秒 = **11.82 CU-hours**；以先前核對的 Free 100 CU-hours 額度計約 **11.82%**，剩約 88.18 CU-hours。
- 儲存 **32.48 MiB / 512 MiB（6.34%）**。
- 當期傳輸約 **7.48 MB**。
- 用量週期 9 月 1 日至 10 月 1 日 UTC。Neon 計量可能延遲，數字不是即時 CPU 使用率，亦不保證往後必定免費。
- 本輪沒有調整 Vercel／Neon plan。Vercel 仍 Pro；15 分鐘 Vercel cron 不適用 Hobby，商業店舖亦不可據此宣稱整套免費。

同期正式 Fresha 最後成功匯入：**19:00 BST**，四個連接無錯誤；未完結 busy blocks：Funky 14、Ivan 17、Lox 0、Shania 0。空來源成功不代表有真實非空預約覆蓋；數量亦含之前的合成平台封鎖測試。

## 一星期試用前仍需處理

- Treatwell：三位接單髮型師未有獲授權可讀入站 feed／API。平台帳戶已登入不等於已接通。
- Lox／Shania：Fresha 非空真實預約及變更／取消覆蓋待驗；網站→Fresha 的訂閱驗收證據亦未齊。
- 通知：正式 outbox 仍 OFF；要先完成實際收信驗收，再啟用通知及重新跑完整 readiness。之前六封模板 delivered 不等於本輪正式 outbox 已送達。
- 店主資料確認：公開營業時間每日 10:00–19:00；後台員工時間不完全一致。FAQ 稱 patch test 免費，價目另有 Consultation & Patch Test £15；需確認這是否不同服務，不能自行改價。星期日、服務時長／總價及 Shania 接單安排仍需核對。
- 舊平台合成封鎖、實機 iPhone／Android、照片／影片處理及備份保留政策，未於本輪全面驗收。Live camera 程式明確依原客戶要求關閉，不能聲稱相機已通過。
- 只在營業時間匯入配合既有 90 分鐘 freshness 限制，代表夜間直接 booking／自助改期可能暫停；不能宣稱 24/7 即時雙向同步。

9 月 21–27 日可先作受控試用：使用 Fresha 接單，再核對網站匯入及後台；每天人工比對平台原始預約和日曆。要讓他人直接在網站自行 booking，仍需完成上述平台覆蓋、通知及營運資料驗收。

## 最後部署核對

- 正式版本 `dpl_6EdeBf8fbmwm2gx3noxr7uw6NBcd`，Vercel 狀態 READY，已指向 https://www.harbourhair.co.uk。
- 部署後 390px 正式週曆：CANCELLED 狀態標籤可見、Edit booking 可見，無整頁水平溢出；臨時 viewport 已恢復。
- 營業時間外正式 authenticated cron 再驗回覆 outside-opening-hours；零匯入。
