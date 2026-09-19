# 六項上線驗收跟進 — 2026-09-19

> 2026-09-20 更新：你已將同步範圍改為「平台 → 網站」。最新網站顯示修正、六封郵件送達及現有來源覆蓋見 [單向匯入驗收](inbound-calendar-acceptance-2026-09-20.md)；以下保留上一輪雙向測試歷史。

呢份係前一份 `final-check-2026-09-19.md` 之後嘅正式環境跟進。時間除特別註明外用英國時間（BST）。

**結論：可以有限公開展示／測試，現有預約入口會導向 Fresha／Treatwell／電話；網站直接預約仍應保持 OFF。六項未全部通過，尤其 Lox Fresha、Treatwell 反方向同步、真實郵件及營業／服務安排仍有未完成部分。公開時間及價格說明亦要確認。ICS 同步有延遲，唔能夠承諾跨平台永不撞期。**

## 六項結果

| 項目 | 今次已完成 | 未完成／需要嘅資料 |
|---|---|---|
| 1. Fresha／Treatwell 同步 | 首輪 Funky、Ivan：正式環境建立 → 改期 → 取消，Fresha 全部跟住更新；網站 feed 即時失效，取消後兩邊首輪測試預約時段都消失。兩人 outbound evidence 已儲存。Fresha 自建封鎖時段亦成功匯入兩人網站日曆。Treatwell 已登入，三位現有訂閱 URL 全部對應正確；Funky／Ivan／Lox 網站 → Treatwell 建立、改期、取消全部實際通過。 | 最新額外回歸：網站及 Treatwell 已取消，但 Fresha Funky 12:00–12:15 匯入事件至 23:23 BST 仍殘留，今輪取消未通過。Lox 網站 → Fresha 仍 HTTP 422；Fresha → 網站嘅合成封鎖時段未見匯入。Shania 未做非空事件驗收。Treatwell → 網站仍未有可用輸出連接，唔係雙向同步。 |
| 2. 通知及 cron | 已啟用 production `CALENDAR_SYNC_ENABLED`；最新 23:00 BST cron 實際成功，4 connections／4 succeeded／0 failed。資料庫、Resend 寄件網域、Redis、cron secret 診斷通過。修正電話客人冇真實電郵時取消／提醒等仍排入寄信佇列嘅問題。 | `NOTIFICATIONS_ENABLED` 維持 OFF；等待你指定自己控制嘅測試收件電郵，先驗證確認信、改期、取消、提醒、salon 通知、spam 同 password reset。未寄出真實測試郵件。 |
| 3. Shania 及公開 Fresha 入口 | 已核實商戶名稱、地址同團隊，將正確 Fresha 商戶網址儲存到 Site Settings；正式 `/book` 已顯示 Fresha、Treatwell 同電話入口。 | Shania Fresha Calendar bookings 原本 OFF，但網站標示 Fresha 接單。需要你決定維持停用並對齊網站，定正式啟用。未自行更改員工營運安排。 |
| 4. 營業時間 | 已讀取並列出網站、Fresha、Treatwell 同逐位髮型師時間差異，見下表。 | 需要你確認真正營業時間、星期日安排及個別髮型師班表，再一致更新。未擅自延長接單時間。 |
| 5. 登入及裝置 | 你完成 Google 身份驗證後，Safari 成功返回網站，登入 session 有效，並可進入受保護嘅 My Bookings。前一輪本機客人完整預約流程及 390px 後台已通過；正式 HTTP 38 個路徑通過。 | Password reset 真實收信／改密碼未完成；真實 iPhone、Android、相機及試髮色素材仍未逐部驗收。 |
| 6. Neon 還原及用量 | 已喺隔離分支執行真實指定時間點還原；9 張主要資料表筆數及內容摘要吻合，18 個 migration 記錄、0 broken appointment relations。亦已讀取實際用量及休眠設定。 | 呢次係還原演練，唔等於持續長期備份。現有還原窗口只得 6 小時；需決定長期保留政策及儲存目的地。 |

兩個程式 commits 均已推送及正式部署。`aad33bb` 嘅 [CI／正式部署 workflow](https://github.com/ChiFungHillmanChan/harbour_hair_salon/actions/runs/35469727492) 已成功，包括 backend、migration、production build、security 同部署工作。

## 今次程式及設定改動

- `c3fcb7b`：後台 Edit booking 新增 **Cancel booking**，沿用現有權限檢查、交易、操作紀錄、通知佇列及日曆快取失效；先確認再取消。關閉對話框按鈕改名 **Close**，避免混淆。
- `aad33bb`：集中阻止向電話客人嘅 `.invalid` 佔位電郵排入客人通知；舊佇列同已準備郵件亦會跳過，唔再作無效發送及重試。寄畀 salon 嘅通知保留。
- Production 已開日曆排程；已拆開原本跨環境共用設定，production 為 true，preview／development 明確為 false。網站 booking 同通知仍 OFF。冇開啟舊 Treatwell API adapter。
- 已填公開 Fresha 商戶連結；Funky、Ivan 真實看見網站 Busy 後先確認 Fresha outbound evidence。Lox、Shania 嘅 Fresha 未虛假確認。
- Treatwell 登入跟進：三位實際匯入非空 Busy 後，23:03 BST 喺**網站後台**記錄 Funky／Ivan／Lox 嘅 Treatwell outbound evidence。呢個冇更改 Treatwell 本身設定，亦冇啟用未完成嘅 inbound；readiness 剩餘 5 項真實未完成檢查。

今次冇新增員工，冇修改姓名、聯絡資料、職位、權限、薪酬或正式班表。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| 單元／回歸測試 | 607 通過，0 失敗，0 跳過；包含 4 個新電話客人通知回歸測試 |
| 新測試先重現問題 | 舊版本會向佔位電郵排隊／發送，新版本正確跳過；正常 salon alert 仍通過 |
| Lint、TypeScript、diff whitespace | 通過 |
| Production build | Node 24，隔離本機 PostgreSQL 18，外部 provider 網絡封鎖，通過 |
| 正式 HTTP | 38 路徑，0 failure：公開頁、metadata、sitemap、booking 關閉入口、受保護頁 redirect、未授權 cron 401、invalid feed 404 |
| 正式管理員取消 | 兩個合成測試預約由 CONFIRMED 變 CANCELLED；網站日曆即時移除，outbound ICS event count 回到 0 |
| Fresha 首輪改期／取消 | Funky 11:15 → 12:15、Ivan 11:30 → 12:30（23 Oct BST）；Fresha 顯示新時間，取消後首輪 Imported event 全部消失；唔代表後續每次都成功 |
| Treatwell 建立／改期／取消 | Funky 11:00 → 12:00、Ivan 11:15 → 12:15、Lox 11:30 → 12:30（23 Oct BST），每段 15 分鐘；三人實際匯入、移動及取消全部通過，23:15 BST 已確認日曆冇殘留測試時段 |
| 時區及私隱 | 12:15 BST → 11:15 UTC，12:30 BST → 11:30 UTC；website ICS 只顯示 Busy，冇客人姓名／電郵 |
| Cron | 最新 2026-09-19 22:00:02–22:00:04 UTC，calendar-sync 4/4，冇失敗 |
| 日曆 endpoint 正式記錄 | 22:22 UTC 查近 25 分鐘 Vercel request logs：24 次 `/api/ical/` 請求全部 HTTP 200；只彙總狀態及時間，冇輸出私人 feed URL |
| Echo 檢查 | 兩個網站測試預約已出現喺 Fresha 後，22:00 同步冇將佢哋再匯入 website ExternalBusyBlock；只代表呢次已測組合 |
| Provider 封鎖時段 | 23 Oct 14:00–14:15 BST，Funky／Ivan 匯入為 13:00–13:15 UTC；Lox 暫未出現，唔當作成功 |

前一輪完整本機預約、搶位、24 小時限制、權限、交易回滾、慢郵件不阻塞回應等證據保留喺 [上一份報告](final-check-2026-09-19.md)。本機測試唔代表外部平台或郵件已真實送達。

## 營業時間差異

| 來源 | 現有設定 |
|---|---|
| 公開網站 footer／FAQ／結構化資料 | 每日 10:00–19:00 |
| Fresha 店舖營業時間 | 每日 10:15–19:00 |
| Treatwell 公開頁 | 星期一至六 10:15–19:00；星期日 10:30–17:30 |
| 網站 Funky | 日 10:15–19:00；一、三 10:00–19:30；二休息；四至六 10:15–19:00 |
| 網站 Ivan | 日 10:15–19:00；一、二 10:00–19:30；三休息；四至六 10:15–19:00 |
| 網站 Lox | 日休息；一至三 10:00–19:30；四至六 10:15–19:00 |
| 網站 Shania | 日 10:15–19:00；一休息；二、三 10:00–19:00；四至六 10:15–19:00 |

店舖營業時間同個別髮型師排班唔一定相同；需要 salon 確認，唔可以直接將全部班表覆蓋成同一個時間。

## Treatwell 登入後唯讀核對

你完成登入後，已核實商戶 Harbour Hair (HK Hair Stylist)，venue 475651。**今輪冇儲存或更改任何 Treatwell 設定**，包括員工、權限、班表、服務、價錢及連接；冇 unlink／relink，亦冇選擇新軟件連接。

- Lox、Funky、Ivan 嘅 Team → External calendar 已有訂閱。已用畫面實際欄位同網站現有私人連結逐字比對，三條全部匹配；報告唔列出私人 URL。
- 網站建立三個無聯絡資料、唔寄信嘅 `TREATWELL SYNC TEST 20260919` 測試預約，日期 23 Oct，Funky 11:00–11:15、Ivan 11:15–11:30、Lox 11:30–11:45。
- Treatwell 三個 Blocked time 資料卡顯示相應髮型師同正確時間，並標明 **Imported from iCal on 19 September 2026 at 22:55**。呢個係實際非空匯入證據，唔只係 URL 已填好。
- 改期已通過：網站改到 Funky 12:00、Ivan 12:15、Lox 12:30，各 15 分鐘；Treatwell 三張資料卡全部顯示正確新時間，匯入時間 **23:05 BST**，原本 11:00／11:15／11:30 三個時段已釋放。網站 feed 喺改期後即時更新，Treatwell 需等待輪詢。
- 取消已通過：23:11 BST 前三個網站測試已全部變成 `CANCELLED`，三條 website feed HTTP 200、event count 0，原 UID 全部消失；通知佇列筆數維持原先 2 條已跳過記錄，今輪冇新增客人郵件。**23:15 BST 重新整理 Treatwell 並目視檢查，三個新時段全部清除，舊時段亦冇殘留。**
- 同一 website feed 亦會畀既有 Fresha 訂閱讀取：**截至 23:23 BST 最後重新載入，Funky 12:00–12:15 嘅 Imported event 仍然顯示**（23 Oct，Fresha blocked-time 210899055），雖然來源已經空白，Treatwell 同一來源亦已釋放。Ivan 12:15–12:30 冇殘留。今輪 Fresha Funky 取消驗收記為未通過，需要核對 Fresha 嘅來源讀取及刪除處理記錄；未有證據可以斷言具體根因。冇手動刪除匯入事件、重設連接或修改 Fresha 設定去掩蓋結果。
- Settings → External calendars 有支援軟件選擇器；今次檢查冇發現可以直接提供畀自建網站用嘅通用 Treatwell iCal 匯出 URL。冇選擇軟件或提交設定。

Treatwell 官方說明，一般外部日曆 iCal 係**單向匯入 Treatwell**；雙向功能只適用於指定整合軟件。現有網站冇 Treatwell inbound URL，舊 API adapter 亦冇啟用，所以 Treatwell 接到嘅預約唔會自動封鎖網站時段。需要先向 Treatwell 確認自建網站可用嘅正式整合途徑；未發送支援訊息。[官方同步說明](https://partnercare.treatwell.com/s/?language=en_GB&view=article&path=availability%2FHow-to-sync-Connect-with-other-calendar-softwares) · [官方 iCal 設定說明](https://partnercare.treatwell.com/s/?language=en_GB&view=article&path=availability%2FHow-to-set-up-iCal-synchronisation)

Treatwell 14–20 Sep 嗰星期 Rota 顯示：店舖星期一至六 10:15–19:00，星期日 10:30–17:30；Lox 星期六 OFF，Ivan 星期三及六 OFF，Funky 每日有班。呢個係該星期班表快照，唔代表永久每週安排，亦同網站部分班表唔一致。

另已對照 Treatwell 13 組 active services 同網站 46 個服務項目。以下係要 salon 確認嘅實際差異，今輪冇改價或改時長：

| 對應項目 | 網站時長 | Treatwell 時長 |
|---|---:|---:|
| Short Over Ears 洗剪吹 | 55 分鐘 | 60 分鐘 |
| Long Hair 洗剪吹 | 85 分鐘 | 90 分鐘 |
| Full Head Colour & Finish | 150 分鐘 | 160 分鐘 |
| Cold Perm | 150 分鐘 | 160 分鐘 |
| Hair Correction／Paimore Hot Perm | 210 分鐘 | 220 分鐘 |
| Keratin Treatment | 180 分鐘 | 190 分鐘 |
| Consultation & Patch Test／Treatwell Patch Test | 15 分鐘 | 5 分鐘；名稱及內容亦唔完全一樣 |

抽查對應洗剪吹、Full Head Colour、Highlights、Balayage、TOKIO 項目嘅數字價格一致；但 Treatwell 多個名稱寫住 **VAT excluded**，公開網站服務頁冇同樣說明，實際對外總價要確認。Treatwell 額外長髮、部分 add-on 同網站項目唔係一對一，唔會自動覆蓋或假設係同一服務。網站預約會按自身已儲存時長保留時段，唔會自動補齊上述差額。

## Lox 問題記錄（可作支援查詢草稿；未發送）

Fresha workspace 3055424／location 3158185／employee 5512894。現有 Export 顯示 Synced；新增外部 Import 嘅網址驗證顯示 **Calendar URL is valid**，但 Complete 請求 `calendar-sync-api.fresha.com/calendar-sync-settings` 返回 **422 Unprocessable Entity**。最新重現時間 **2026-09-19 20:13:35.531 UTC**；較早兩次亦失敗。

網站 4 條私人 ICS endpoint 均 HTTP 200、CRLF VCALENDAR 格式有效；另外三位已有成功訂閱。Fresha 畫面未提供具體拒絕原因，唔可以斷言係員工邀請、權限、token 或 provider 驗證規則。未移除原有 Export、未輪換 secret、未寄員工邀請。現有設定之外，Lox 非空封鎖時段匯入仍需解決。

## Neon 用量及還原

實際 production 係 London `harbour-hair-db-lhr`（PostgreSQL 18），唔係舊本機 `.env.local` 指向嘅歷史美國資料庫。

- 月內 compute：約 **7.919 CU-hours**；project storage 約 **32.31 MiB**；傳输約 **3.3 MB**。呢啲係檢查當時快照。
- Compute min/max 都係 **0.25 CU**；使用平台預設 **5 分鐘閒置休眠**。
- 現有 metadata 顯示 **6 小時還原歷史**。唔應將呢個窗口當成幾日／幾星期保留。
- 還原點：**2026-09-19 20:10:34.153 UTC**，LSN `0/3C56290`；隔離分支 `codex-launch-restore-20260919`。
- 9 張表比對：User、Stylist、Service、Appointment、ServiceCategoryContent、Faq、SiteSettings、CalendarConnection、NotificationDelivery。只輸出筆數及 aggregate digest 比對結果，冇將正式客人資料 dump 到本機。
- 隔離測試分支設定到期 **2026-09-20 20:00 UTC**，到期自動清理；網站仍用原本 production 分支。

目前 Neon Free 官方配額係每 project 每月 100 CU-hours、0.5 GB 儲存；今次快照低於配額。半小時排程按 0.25 CU、每次 5 分鐘 idle tail 推算，理想基線約 30 CUh／30 日；真正客流、後台使用、供應商輪詢及冷啟動會增加用量，唔係免費保證。[Neon 官方價格及配額](https://neon.com/pricing)

現有 Vercel 係 Pro，半小時 cron 需要 Pro；唔可以稱為整個部署都適合 Vercel Hobby 免費版。[Vercel cron 限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)

Fresha 官方亦說明日曆同步可以有約 15 分鐘延遲；網站 inbound job 每 30 分鐘一次。跨平台接單仍需要人工核對及訂單審批，尤其 Fresha 與 Treatwell 嘅事件唔會互相經網站轉發。[Fresha 官方同步说明](https://www.fresha.com/es/help-center/knowledge-base/calendario/101373-sincroniza-tu-calendario-de-fresha)

## 測試資料及待回覆

首輪兩個網站合成測試預約已取消，保留取消／審計記錄；冇真實客人聯絡資料。兩條佔位電郵取消通知已限定按測試 ID 標記 SKIPPED，冇發送。Treatwell 跟進新增嘅三個網站合成預約亦已取消，冇新增通知工作。

最新跟進嘅 Treatwell 三個時段已清除；Fresha 仍有一個 23 Oct 12:00–12:15 Funky 匯入殘留（210899055），截至 23:23 BST 未清除。呢個同下一段原先 14:00 嘅三人自建封鎖測試係兩組不同記錄，唔可以混為一談。

Fresha 另有一組 3 人封鎖測試：`LAUNCH SYNC TEST 20260919`，23 Oct 14:00–14:15，Funky／Ivan／Lox。已提出刪除確認，等待你回覆。已將同一組記錄改成容許 Fresha online booking，畫面確認 Blocked time updated；但最新匯出仍顯示 OPAQUE，網站端暫時仍視為忙碌，未當作已清理完成。

要完成餘下驗收，需要你回覆已發出嘅問題：

1. 你自己控制嘅測試收件電郵。
2. Treatwell 登入已完成；仍需確認可用嘅反方向整合方案。
3. Shania 維持停用，定正式啟用。
4. 正確店舖時間／星期日安排／個別髮型師班表，以及上面服務時長、VAT 字眼及服務對應差異。
5. 確認刪除上述 3 個合成 Fresha 封鎖測試。

密碼重設收到郵件之後，新密碼輸入及提交要由你親自完成。長期備份要另定保留期及儲存目的地，現時未新增付費服務。
