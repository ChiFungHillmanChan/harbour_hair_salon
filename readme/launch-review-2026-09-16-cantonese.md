# Harbour Hair Salon — 上線及交付審查

> 後續更新：以下保留首次審查證據。其後已完成依賴升級、migration，以及對話第 3／4／5 項修正（遠期預約、kiosk、通知旗標）。最新驗證及仍未解決項目見 [修正驗證報告](upgrade-verification-2026-09-16-cantonese.md)。

檢查日期：2026-09-16。開始時程式基準係 `c451033`；檢查期間另一項工作提交咗 `8fa7f90`（重複日曆），最後核對以 `8fa7f90` 加現有未提交改動為準。主要實測證據於約 15:26 英國時間取得，提交後亦重新核對相關程式。

**結論：NO-GO。現時唔建議部署呢批未提交改動，亦唔建議當成已完成、可以獨立營運嘅預約系統交付。可以先畀店主做驗收。**

正式網站嘅公開展示頁目前可瀏覽；自家預約仍然顯示籌備中，提供電話及 Treatwell 入口。呢個只證明展示及導流流程基本可用，唔代表登入後落單、收信、平台同步同後台管理已通過交付驗收。

檢查期間工作目錄仍有其他工作加入日曆畫面、RRULE parser 及測試；本報告係當時版本嘅審查，之後改動需要重新驗證。我只新增呢份報告，冇修改產品程式、commit、部署、執行 migration、建立真實預約或發送真實電郵。

## 1. 已完成嘅驗證

| 檢查 | 今次結果 |
|---|---|
| 自動測試 | 首輪 436/436；包含之後新增嘅日曆測試再跑：**441/441 通過** |
| ESLint | 兩輪通過，包括新日曆畫面 |
| TypeScript | Build 內檢查及最後獨立 `tsc --noEmit --incremental false` 均通過；唔代表整個 build 成功 |
| Prisma dev／vercel／prod schema validate | 三份全部通過；語法有效唔等於 migrations 齊全 |
| Production build | **失敗**。解除本機網絡限制後，首頁實際報 `P2022: Service.calendarColor does not exist` |
| 已設定 PostgreSQL schema metadata | 唯讀核對：14 個 migration、0 個未完成；Stylist 有 isActive，但 Stylist／Service 都冇 calendarColor |
| 正式公開 HTTP | 首頁、services、contact、offers、stylists、blog、reviews、privacy、try-color、book、signin、register、forgot-password 均 200 |
| Health／保護路由 | health 200、database up；未登入開 admin／appointments 會 307 去 signin |
| robots／sitemap | 均 200；首頁、服務頁有 Vercel cache HIT |
| 瀏覽器 | 桌面首頁／booking；390px 手機 booking、選單、服務分類切換、聯絡頁／地圖已檢查；所查畫面未見明顯橫向溢出，服務頁冇失效圖片，所查 console 冇 error／warning |
| 正式依賴 audit | 18 個公告命中：2 critical、9 high、7 moderate；要逐項判斷部署條件，唔等於 18 個都可直接利用 |
| 隔離重現 | 使用實際模組配合 mock I/O，重現通知旗標失效、kiosk 保留 admin、通知遺失、退休員工預約、出糧競態及 admin email 大小寫問題；重複日曆錯位用真 parser 重現 |

首次沙盒 build 因 DNS／資料庫連線限制失敗；有網絡權限再跑後，確實到首頁 prerender 才因缺欄位失敗，所以唔可以將最後結果歸因於測試環境連唔到 DB。

## 2. 上線／交付前要修正嘅問題

### 01 — P1：新欄位冇 migration，正式 build 已經失敗【未提交改動】

位置：[Vercel schema:67](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/prisma/vercel/schema.prisma:67)、[Service 欄位:84](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/prisma/vercel/schema.prisma:84)。

三份 schema 都加入 calendarColor，但現有 PostgreSQL migration 冇建立對應欄位。postinstall 會生成包含新欄位嘅 Prisma client，production 部署只會跑 migrate deploy。首頁 service.findMany 會讀取新欄位，實際 build 已報錯；一般服務、預約及後台查詢亦受影響。

**修正及驗收：** 加入相應 additive migration，先喺即棄 PostgreSQL 重播全部 migrations，再驗證 Service／Stylist 查詢、後台保存及完整 production build。唔好靠手動改正式 DB 取代可重播 migration。

### 02 — P1：Next.js 版本命中已公布嘅安全漏洞【既有】

位置：[package.json:53](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/package.json:53)、[圖片設定](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/next.config.ts:27)。

鎖定版本係 Next.js 16.2.10。官方公告指出，使用 App Router 加 Server Actions 嘅受影響版本可被特製請求耗盡 CPU；呢個網站符合所列架構條件，16.2.11 修正該項。[Next.js 官方 Server Actions 公告](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj)

另有 AVIF 圖片最佳化相關 critical 公告，修正版係 16.3.3；目前依賴包含 sharp 0.34.5，圖片最佳化有啟用。今次冇對正式網站嘗試漏洞利用，實際攻擊可達性仍取決於部署圖片處理路徑及可接受來源。[Next.js 官方 AVIF 公告](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)

Audit 另一項 critical 只針對 Windows host，唔應直接當成 Vercel 已受該漏洞影響。其餘包含 build 工具嘅公告亦要分清適用性。

**修正及驗收：** 升到涵蓋上述修正嘅相容版本（上述公告嘅 16.x 修正門檻為 16.3.3），同步 eslint-config-next，檢查 sharp 及 postcss override；更新 lockfile 後重跑 audit、測試、build、圖片及 Server Actions 驗收。

### 03 — P1：重複日曆事件會錯位，漏封鎖已預約時間【檢查期間已由其他工作提交：8fa7f90】

位置：[calendar-ical.ts:81](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/calendar-ical.ts:81)。

新 parser 將每次 recurrence 嘅實際時間改成首次事件嘅 London 鐘面時間。用合法 UTC feed：10 月 18 日 08:00–09:00Z，每星期一次。10 月 25 日轉冬令時間後，應維持 08:00–09:00Z，實際輸出卻係 09:00–10:00Z，令原本已佔用嘅一小時可以再被預約。

同一段邏輯亦會將 HOURLY 三次事件變成三個相同開始時間及 UID；重複全日事件跨 25 小時日會少封鎖最後一小時。「只會多封鎖」嘅程式註解並唔成立。UTC 同具名時區需要保留各自語義。[iCalendar RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)

**修正及驗收：** 保留 recurrence 產生嘅正確時間／時區；未支援嘅規則要明確拒絕。補 UTC、Europe/London、其他 TZID、每小時、EXDATE、跨冬夏令時間及全日事件測試。

### 04 — P1：客人可以訂到後台完全睇唔到嘅遠期預約【既有，今次日曆仍沿用】

位置：[admin/page.tsx:28](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/admin/page.tsx:28)。

後台只載入「上個月、今個月、下個月」，但網站可預約接近 90 日內。以 9 月 16 日計，11 月 30 日屬可預約日期，但後台查詢只去到 10 月 31 日。切換日曆月份只改 client state，唔會調整 server 查詢範圍；待確認數量亦由同一批有限資料計算。

**影響：** 店主可能睇漏訂單，無法喺正常畫面確認。**驗收：** 建立第 75 日嘅測試請求，直接喺後台睇到、確認；導航月份要載入相應資料，待確認清單要覆蓋所有待處理訂單。

### 05 — P1：啟用員工打卡模式後，平板仍保留管理員權限【既有；打卡交付前必修】

位置：[kiosk.ts:87](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/actions/kiosk.ts:87)、[畫面提示](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/components/admin/KioskModeButton.tsx:11)。

操作提示叫管理員 Enable kiosk 後開 /kiosk，但程式只加 kiosk cookie，冇清除 admin session。隔離重現確認兩個 session 同時存在。將平板交畀員工後，對方直接開 /admin 就仍然有管理員權限，可接觸客戶及出糧資料。

**修正及驗收：** 進入 kiosk 時清除一般 admin session 並轉到打卡頁；同一瀏覽器開 /admin 必須要求重新登入。修正前唔好將仍登入 admin 嘅裝置交畀員工共用。

### 06 — P1：通知顯示停用，但部分操作仍然寄信【既有；新日曆亦會觸發】

位置：[notification-outbox-service.ts:134](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/notification-outbox-service.ts:134)。

Cron 同後台手動送信控制會檢查 NOTIFICATIONS_ENABLED，但即時 dispatcher 冇檢查。取消現有預約、管理員確認／取消及部分日曆改動仍可進入發信路徑。

實際模組配假 transport 重現：flag=false，仍呼叫一次送信、標記 SENT。呢個會令營運人員以為通知已停用，但實際收到信。

**修正及驗收：** 喺共同送信入口執行旗標；保留交易內排隊及取消功能。false／未設定時唔可以發信，true 時先發送仍然有效嘅通知。

### 07 — P2：退休髮型師仍可能被預約【既有】

位置：[booking-service.ts:189](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/booking-service.ts:189)、[指定 stylist 查詢:281](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/booking-service.ts:281)。

「任何髮型師」時段聯集冇排除 isActive=false；指定髮型師落單亦只查 ID。保留舊更表嘅退休員工仍會提供表面可選時段，舊版已開啟表格／直接提交亦可建立指定退休員工嘅 PENDING 預約。已用實際模組配 mock 資料重現。

**驗收：** 退休後保留歷史及更表，但所有查時段、指定落單、改期路徑都拒絕新增工作畀退休員工。

### 08 — P2：只改服務長度，可能令原本待寄通知永久消失【未提交改動】

位置：[admin-schedule.ts:126](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/actions/admin-schedule.ts:126)。

每次移動／調整長度都增加 notificationVersion，但只改長度、或者移動 PENDING 預約時冇建立替代通知。原本等待重試嘅確認信，或者最初客戶／店舖提醒，會因版本唔同被 outbox 標記 SKIPPED。

已重現：確認信待寄 → 只改長度成功 → 舊確認信 SKIPPED → 冇替代信。**驗收：** 無聲改動唔應丟失必要通知；有資料變更就保存更新後嘅待寄 snapshot。

### 09 — P2：新日曆將全日／跨日忙碌時間畫成空閒【未提交改動】

位置：[ScheduleDayGrid.tsx:134](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/components/admin/ScheduleDayGrid.tsx:134)、[高度計算:427](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/components/admin/ScheduleDayGrid.tsx:427)。

畫面只保留開始日期等於當日嘅 block，跨日 block 第二日會消失；午夜到下一個午夜用鐘面分鐘相減會得零，畫成極細色條，甚至落喺顯示範圍外。Backend 衝突檢查仍有阻擋，但店主睇畫面會誤以為有位。

**驗收：** 用時間區間重疊篩選，按每一日可見範圍裁切；全日休息、過夜、連續數日及 DST 都要正確顯示。

### 10 — P2：已 finalize 嘅出糧數字仍可被同時運行嘅重算覆寫【既有；出糧交付前必修】

位置：[payroll-service.ts:183](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/services/payroll-service.ts:183)。

重算只喺開始檢查一次 DRAFT，之後逐行 upsert；finalize 另一邊先改狀態，再保存 snapshot，兩者冇共用交易／鎖。隔離重現：重算暫停 → finalize 保存 10 → 重算繼續寫成 20；狀態仍 FINALIZED，snapshot 同畫面／CSV 金額唔一致。Adjustment 亦有同類先檢查後寫入模式。

**驗收：** 兩個管理員同時重算／finalize／改 adjustment，finalized 金額及 snapshot 必須一致而且不可被舊操作覆寫。

### 11 — P2：帶大寫字母嘅新管理員 email 會登入失敗【既有】

位置：[admin.ts:331](/Users/hillmanchan/Desktop/client-website/harbour_hair_salon/src/app/actions/admin.ts:331)。

createAdminUser 原樣保存 email，但 login 同 password reset 會轉小寫。PostgreSQL 呢個欄位係大小寫敏感，因此 Manager@Example.com 建立成功後，用相同 email／密碼都可能登入唔到。已隔離重現。

**驗收：** 建立前統一 trim／lowercase；先檢查舊資料有冇大小寫重複，再處理既有帳戶。用混合大小寫 email 完成建立、登入及 reset。

## 3. 正式營運仲欠嘅驗收證據

以下係本次未完成或未重新核實嘅驗收，唔係聲稱正式設定一定有問題。舊 rollout 文件提過嘅 sender domain、Redis、更表等狀態可能已改，唔應用舊紀錄當今日結果。

1. 店主確認服務價格、時長、營業時間、活躍員工及每人更表；確認網站係「預約請求，等店舖確認」。
2. 喺實際 production team 核實發信網域／sender，並完成真實客戶及 salon inbox 收信、垃圾郵件、失敗重試驗收。
3. 每位員工、每個接單平台完成 inbound／outbound 日曆實測：新增、改期、取消、跨日、DST、失敗及 stale。ICS 係忙碌時間交換，唔等於完整訂單／付款 API，亦唔保證即時零撞期。
4. 驗證 Redis 真實限流寫入、啟用後 cron 成功紀錄、Operations 診斷及通知旗標行為。
5. 喺受控測試環境做完整 register／login／reset／logout、預約／確認／改期／取消，以及同時搶同一時段；今次正式網站只做唯讀 smoke check，冇建立真帳戶或落真單。
6. 店主持有 domain／Vercel／Neon／Resend／平台帳戶及 recovery 方法；完成 DB restore／回滾演練，知道點樣緊急關閉接單及通知。

本次冇重跑真 PostgreSQL integration suite：冇啟動符合工具保護條件嘅即棄 salon_test DB，正式資料庫只讀 schema metadata。現有 441 個測試通過，唔可以取代真實平台及投遞驗收。

## 4. 建議處理次序

先固定要交付嘅版本，修 migration 同依賴版本；再修日曆時區、遠期訂單可見性、通知及退休員工流程。打卡同出糧要修妥先交畀員工使用。完成後重跑 build、migration replay、測試及瀏覽器流程，再由店主做一次真實受控預約 → 確認 → 改期 → 取消，核對雙方收信同平台忙碌時間，先正式開放。

現有視覺方向同公開導覽可以繼續沿用，唔需要因為呢份審查重做整個網站。主要阻礙係資料庫部署一致性、日曆／通知正確性，同實際營運驗收。
