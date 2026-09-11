# Harbour Hair Salon：到店設定、帳戶交接及上線驗收表

文件準備日期：2026-09-11（Europe/London）
到店日期／時間：________________  店主／決策人：________________  技術負責人：________________

**今次去 salon，要攞齊店主授權、各平台獨立存取權、網域 DNS 控制權，同真實營運資料。唔需要攞店主 Google 密碼。** 店主可以用自己控制嘅 Google 帳戶登入支援 Google 登入嘅平台，但每個平台仍然要確認正確 salon／team／workspace、權限、方案同付款人。Google 帳戶本身唔會自動驗證 Resend 寄件網域，亦唔會自動取得 Treatwell 或 Fresha 日曆存取權。

呢份係現場工作表及驗收標準，**唔係已經完成所有接駁嘅證明**。程式改動、部署、供應商設定、真實端到端測試，要分開記錄。空白欄表示未核實；「已有設定」唔等於「測試成功」。先列印／複製呢份空白表，填好嘅客戶資料同私密附件交由 salon 保管。

## 1. 出發前帶齊同約齊

- [ ] 店主／有權批准帳戶、方案同費用嘅人到場；帶可接收驗證通知嘅手機。
- [ ] 準備已登入嘅 Google、網域註冊商／DNS、Treatwell Connect、Fresha、付款帳戶；唔使將密碼寫落紙。
- [ ] 技術人員嘅獨立邀請電郵：________________；店主備用管理人：________________。
- [ ] 帶最新價目表、四位髮型師嘅每週更表、假期、現有服務清單，以及處理取消／改期嘅實際流程。
- [ ] 約一位 reception／日常處理 booking 嘅同事做驗收，姓名：________________。
- [ ] 準備幾個獲准測試用嘅收件地址及時段；測試預約用假客戶資料，唔向真客發測試通知。

現場次序：**確認擁有人 → 發獨立邀請 → 核對 DNS／電郵 → 記錄平台同員工對應 → 接駁及測試日曆 → 店主核對流程同費用 → 記錄上線決定。** 當日未能驗證嘅項目，填負責人及完成日期；唔好因為登入到 dashboard 就當接駁完成。

## 2. Google、Resend、平台權限係幾件唔同嘅事

| 項目 | 實際用途 | 到店要確認／申請 |
|---|---|---|
| Google 帳戶 | 個人登入身份及復原渠道 | 店主自己控制主帳戶、MFA、復原電郵／電話；技術人員用自己帳戶 |
| Gmail inbox delegation | 幫手睇／寄／刪電郵 | 只喺確實需要管理 mailbox 時先授權；唔代表可以用店主身份登入其他服務 |
| Google Business Profile | Google Maps 商戶資料、網站同預約連結 | 店主保留 Primary owner；一般網站維護邀請 Manager 已可處理多數資料 |
| Google Cloud／OAuth project | 本網站「Continue with Google」所用嘅 app 設定 | 獨立核對 project ID、IAM 權限、OAuth client、正式 callback URL、consent 設定 |
| Resend team | 管理寄信、寄件網域、API key 同賬單 | Salon 控制 team，邀請技術人員；再另外完成寄件網域 DNS 驗證 |
| Treatwell／Fresha | 商戶預約、員工、日曆、付款等 | 用平台嘅 team／staff 權限，確認係正確店舖而且有需要嘅日曆設定權限 |

Google 官方分開定義 Gmail delegation、Business Profile 角色同 Cloud IAM；Gmail delegation 只授予電郵管理權。Google Workspace 嘅 delegation 仲受同一組織及管理員設定限制。[Gmail delegation](https://support.google.com/mail/answer/138350?hl=en)、[Business Profile owners and managers](https://support.google.com/business/answer/3403100?hl=en)、[Google Cloud project access](https://docs.cloud.google.com/resource-manager/docs/access-control-proj)

網站用 Google 登入時，身份驗證同存取 Google Calendar 等 API 嘅授權 scope 亦要分清。本網站嘅 OAuth project 需要正確 redirect URI；獲得基本登入身份唔代表取得日曆權限。[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

**交接做法：** 優先由店主發每人獨立邀請，按工作授權；如果實際方案／版本冇合適角色，店主在場自己登入、完成 MFA 同敏感設定。唔好將店主主帳戶改成工程師個人電郵。密碼、MFA recovery codes、API keys、database URLs 同含 token 嘅 ICS URLs 都唔好貼入聊天、Git、issue、一般試算表或呢份工作表；只記錄私密保管位置及驗證結果。

| 帳戶控制核對 | 記錄（唔填 secret） |
|---|---|
| 店主控制嘅管理電郵 | ________________ |
| 店主已試過自行登入／登出再登入 | 日期：________ 結果：________ |
| MFA 由誰保管／備援方式 | 人員：________ 方式：________ |
| 復原電郵及電話已核對 | [ ] 是；只記核對日期：________ |
| 私密資料存放位置 | Salon password manager／secret vault 名稱：________________ |
| 技術存取權檢討／撤銷日期 | ________________ |

## 3. 網域、公開聯絡資料同品牌批核

| 欄位 | Salon 確認資料 |
|---|---|
| 正式公司／營運者名稱 | ________________ |
| 對外 salon 名稱 | ________________ |
| 正式網站網域（確認 www 或無 www） | ________________ |
| 網域註冊商／帳戶擁有人／續費日期 | ________________ |
| 實際 DNS 管理平台／管理人 | ________________ |
| 誰可以加 TXT、CNAME、MX；聯絡方法 | ________________ |
| 現有 mailbox 供應商（Google Workspace 等） | ________________ |
| 公開電話／WhatsApp（如有） | ________________ |
| 地址／postcode／到店提示 | ________________ |
| 公開查詢電郵 | ________________ |
| Booking 通知 mailbox；每日由誰睇 | ________________ |
| 客人 Reply-to mailbox；代班負責人 | ________________ |
| Google Business Profile URL／Primary owner | ________________ |
| Instagram／Facebook／其他正式連結 | ________________ |
| 相片、logo、員工介紹及評價使用權 | 批核人：________ 附件位置：________ |
| 服務頁、聯絡頁、私隱及條款內容批核 | 批核人：________ 日期：________ |

- [ ] 店主確認 DNS 管理人可以配合；唔好假設「買網域嘅公司」就係目前 DNS host。
- [ ] 改 DNS 前記錄現有相關記錄及回復方法，保留原有收信設定；Resend 加記錄唔需要順手搬 mailbox。
- [ ] 正式網站、Google listing、各預約平台嘅名稱、地址、電話同營業時間逐項對齊。

## 4. Resend：完成品牌寄信，同確認有人收／覆 booking

Resend 每個 team 有獨立 API keys、billing 同 usage。Member 可管理 emails、domains、webhooks；Admin 另外可以邀請用戶、處理付款及刪 team。一般接駁可先用 Member，帳單及 team 管理由 salon 保留。[Resend Managing Teams](https://resend.com/docs/dashboard/settings/team)

Resend 要驗證 salon 擁有嘅寄件網域，按 dashboard 提供嘅 DNS 記錄設定 SPF／DKIM；DMARC 係另一項郵件政策設定。用某個 Google 帳戶登入 Resend，唔會令 `harbourhair.co.uk` 自動變成已驗證。[Resend Managing Domains](https://resend.com/docs/dashboard/domains/introduction)

| 現場欄位 | 確認資料／結果 |
|---|---|
| Salon Resend team 名稱／ID | ________________ |
| Salon 管理員／付款人 | ________________ |
| 技術人員邀請已接受／角色 | 日期：________ 角色：________ |
| 寄件 domain 或 subdomain | ________________ |
| From 顯示名稱及地址 | ________________ |
| Reply-to（真係有人讀嘅地址） | ________________ |
| Salon booking 通知地址 | ________________ |
| DNS 記錄交由誰加入／完成日期 | ________________ |
| Domain 狀態及 sending capability | 結果：________ 截圖保管位置：________ |
| API key 所屬 team／domain／用途 | ________________（唔寫 key） |
| Production key 已載入 Vercel | 人員：________ 日期：________ |
| Newsletter 是否啟用／audience ID | [ ] 不啟用 [ ] 啟用；ID：________ |

1. 店主先選好／建立 salon 控制嘅 team，確認冇誤用工程師個人 team。
2. 店主邀請技術人員，DNS 管理人加入 Resend 實際顯示嘅記錄；技術人員重新驗證並核對發信能力。
3. 喺正確 team 建 production 用 key，確認權限、domain 範圍同寄件地址一致，私密載入環境。
4. 測試客人 confirmation、cancel、reschedule、reminder，同 salon 內部通知。用至少兩個不同郵件供應商、而且唔係 Resend 帳戶擁有人嘅測試地址。
5. 記錄 Resend delivery 結果同收件人實際收件／spam／reply 結果；成功交畀郵件服務商唔等於客人已見到。
6. 有既有 Resend team／domain 要搬時，先安排交接及確認現有寄件影響；Domain Claim 可能要 DNS 所有權驗證或 support 處理，唔好先刪舊 team。[Resend Domain Claim](https://resend.com/changelog/domain-claim)

電郵驗收：客人收到時間 ________；salon 收到時間 ________；reply 成功 ________；負責人 ________。

## 5. Treatwell：要進入正確商戶後台，再核實可以接乜

首先問清楚係 **Treatwell Connect、Treatwell Pro，定其他 Treatwell 產品**，地區／合約係邊一個。唔好將消費者登入、marketing Partner Portal 或其他產品嘅角色說明，當成 salon Connect 日曆權限。

Treatwell 官方已描述 team access 變更及驗證機制，但本次未取得可確認 Harbour Hair 英國帳戶每個角色細項嘅官方畫面／文件；因此以下權限必須到店實測，唔預設「Admin」呢個名稱一定有齊。官方其他地區 Connect 更新提到更改 team access／bank details 可要求 OTP；店主應帶可接收驗證嘅裝置。[Treatwell Connect 官方更新](https://www.treatwell.be/en/partners/resources/blog/the-salon-pulse-whats-new-in-treatwell-connect-march-2026/)

| 欄位 | 現場記錄 |
|---|---|
| 產品名稱／國家／登入網址 | ________________ |
| 商戶／venue 名稱及 ID | ________________ |
| 現有公開 booking URL／widget URL | ________________ |
| 帳戶 owner／合約簽署人 | ________________ |
| 技術人員登入及實際角色 | ________________ |
| 可查看全部需要同步嘅員工／日期 | [ ] 已驗證 [ ] 未有權；詳情：________ |
| 可修改員工、服務及 external calendar 設定 | [ ] 已驗證 [ ] 店主代操作；詳情：________ |
| 官方外部日曆匯入／訂閱功能 | [ ] 有 [ ] 冇 [ ] 待 support 確認 |
| 官方每員工 ICS 匯出 feed | [ ] 有且實測 [ ] 冇 [ ] 未確認 |
| 官方 API／webhook 開放予此帳戶 | [ ] 有書面授權 [ ] 冇 [ ] 未確認 |
| Support case／官方文件／回覆保管位置 | ________________ |

**目前唔承諾 Treatwell 可以提供匯出 feed 或 appointment API。** 官方 external-calendar help 頁只可以作現場查閱入口，本次未能從其英文頁讀取完整可驗證內容；需要 owner 開後台或由 support 回覆確認匯入／匯出方向、員工範圍、更新頻率同授權條件。[Treatwell external calendar help](https://partnercare.treatwell.com/s/article/How-to-sync-Connect-with-other-calendar-softwares?language=en_GB)

攞到 feed 時，記錄私密保管項目名稱，唔將 URL 放呢度。攞唔到合法、可用嘅 inbound 方法時，就唔可以聲稱網站已知道 Treatwell 所有 booking；店主要決定只用已驗證嘅外部 booking 入口、先做人工確認，或者向平台取得正式整合資格。

## 6. Fresha：workspace 邀請、員工日曆同 ICS

Fresha 支援新增 team member、電郵邀請同 permission roles。新增人員後要核對服務、location 同 shift，因為預設值可能按 location 營業時間及全部服務設定。額外可預約員工可能影響方案／賬單；技術人員如唔接客，應核對關閉其 calendar bookings，並睇清實際費用先儲存。[Fresha team onboarding](https://www.fresha.com/help-center/knowledge-base/team/276-add-team-members-to-your-workspace)

| 欄位 | 現場記錄 |
|---|---|
| Workspace 名稱／ID／國家 | ________________ |
| Location 名稱／ID | ________________ |
| 唯一 workspace owner／付款人 | ________________ |
| 公開 salon booking URL | ________________ |
| 技術人員邀請／權限／是否可預約 | ________________ |
| 可存取嘅員工及日曆設定 | ________________ |
| 新增 access 是否改變費用／已由誰批准 | ________________ |

Fresha **英文官方文件**確認：Google Calendar 可選雙向；Other calendars 可分別設定 ICS 匯入及匯出，匯入顯示為 blocked time，並可選只保留時間／時長。文件寫同步可能需最多 **15 分鐘**。呢個係 Fresha 嘅日曆功能說明，唔係本網站已完成整合、全程延遲上限或零撞期保證。[Fresha Link your calendar](https://www.fresha.com/help-center/knowledge-base/calendar/101373-sync-your-fresha-calendar)

現場由 `My profile → Workspaces → Manage → Linked calendars`，或指定 team member 嘅設定頁核對。為每位員工分清：Fresha → 網站，用邊條官方 feed；網站 → Fresha，用邊條網站 busy feed。每個方向獨立記錄，唔好只按一次「Link」就剔雙向完成。測試被匯入嘅事件再匯出會唔會形成回圈／重複封鎖。

如帳戶要交回 salon，Fresha 有 workspace ownership transfer，接收人要先接受 team invite；owner 轉移後原 owner 權限會改變，所以要另行排交接及驗收。[Fresha ownership transfer](https://www.fresha.com/help-center/knowledge-base/workspace-settings/100665-transfer-workspace-ownership-access-1)

## 7. 每位員工、每個服務，同一個真實時間表

**四個 staff profile 唔代表四個人已經可以正確預約。** 每人都要有名字對應、合資格服務、真正工時同外部日曆。下面表格唔夠就複印，唔好只用顯示名稱對應；兩個人同名／員工改名時仍要靠 ID。

| 網站 staff 名稱／ID | Treatwell staff ID | Fresha team member／location ID | 可做服務／價級 | 工時表編號 | 確認人 |
|---|---|---|---|---|---|
| 1. ________________ | ________ | ________ | ________ | ________ | ________ |
| 2. ________________ | ________ | ________ | ________ | ________ | ________ |
| 3. ________________ | ________ | ________ | ________ | ________ | ________ |
| 4. ________________ | ________ | ________ | ________ | ________ | ________ |

每位員工填一份：姓名 ________；表編號 ________；生效日期 ________；時區 **Europe/London**。

| 星期 | 開工–收工 | 午飯／休息／不可預約時段 | 固定休假／例外 |
|---|---|---|---|
| 一 | ________ | ________ | ________ |
| 二 | ________ | ________ | ________ |
| 三 | ________ | ________ | ________ |
| 四 | ________ | ________ | ________ |
| 五 | ________ | ________ | ________ |
| 六 | ________ | ________ | ________ |
| 日 | ________ | ________ | ________ |

公眾假期／年假／臨時加更由邊個輸入：________；主更表位置：________；最少提前幾耐更新：________。

每個 service／variation 填一行；多個長度、級別或加項唔好混成同一項：

| 網站服務／ID | 外部 service／variation IDs | 總時長／實際佔用／buffer 分鐘 | 價錢／固定或 from | 可做員工／資源 | patch test／consultation |
|---|---|---|---|---|---|
| ________________ | ________________ | ________________ | ________________ | ________________ | ________________ |
| ________________ | ________________ | ________________ | ________________ | ________________ | ________________ |
| ________________ | ________________ | ________________ | ________________ | ________________ | ________________ |

- [ ] 所有價格幣種：________；顯示價包含適用 VAT：________；VAT 註冊／稅項處理由店主或會計確認：________。
- [ ] 網站同 Treatwell／Fresha 可唔可以有唔同價、平台優惠點對應：________________。
- [ ] 染髮 processing time 可否讓同一 stylist 接另一客；邊段仍佔用椅／洗頭位：________________。
- [ ] 共享椅／洗頭位／房間數量：________；最多同時幾位客：________；同一資源可用服務：________。
- [ ] 「Anyone／無指定髮型師」由系統即時分配、reception 分配，定唔提供：________；可選員工：________。
- [ ] 無法表示共享資源／分段處理時間嘅功能，採用咩保守佔用規則或暫時唔開放邊啲服務：________________。

## 8. 日曆接駁證據表：busy time 唔等於完整 booking API

ICS 訂閱通常用嚟交換事件／忙碌時段。**一段 busy block 只表示唔好再分配嗰個時段，唔等於網站已喺平台建立客戶預約、取消原單、退款、改服務或處理平台佣金。** 完整 appointment API 需要官方提供嘅合約、身份驗證、endpoint、staff／service IDs、狀態定義、重試及權限，並完成開發同驗收先可以用。

先指定每個來源嘅原始 booking 由邊個平台負責建立／改期／取消／收款：網站 ________；Treatwell ________；Fresha ________；電話／walk-in ________。發生衝突時最終核對日曆：________；負責決策人：________。

每位員工、每個方向各填一份；只喺 private vault 放真正 URL：

| 接駁證據欄位 | 記錄 |
|---|---|
| 編號／員工網站 ID | ________________ |
| 來源平台、workspace／venue／location／staff ID | ________________ |
| 目的地平台及員工 ID | ________________ |
| 方向 | [ ] 平台 → 網站 [ ] 網站 → 平台 |
| 類型／官方支援文件或 support case | [ ] ICS 訂閱 [ ] 官方 API；________________ |
| 私密 URL／token 保管項目名稱 | ________________（唔貼 URL） |
| Feed 包含預約／blocked time／假期／日期範圍 | ________________ |
| 目的地已儲存 subscription 證據 | 截圖／設定紀錄位置：________________ |
| 官方更新頻率／網站輪詢設定 | ________________ |
| 新增事件／首次看到封鎖時間 | 來源：________ 目的地：________ 實測延遲：________ |
| 改期：舊時間釋放、新時間封鎖 | [ ] 通過；事件代號：________ 時間：________ |
| 取消：正確釋放、冇刪其他事件 | [ ] 通過；事件代號：________ 時間：________ |
| 唔會回圈／重複；只封鎖正確員工 | [ ] 通過；證據：________ |
| Feed 失效、空白、過期時處理已驗證 | [ ] 通過；處理方法：________ |
| Token 外洩／員工離職時撤銷或輪換負責人 | ________________ |

網站顯示某條 feed「已設定／last sync success」，仍然證明唔到 Treatwell／Fresha 已訂閱網站 feed；要喺**收資料嗰邊**睇到 subscription，同埋實際封鎖事件。輪詢、來源更新同快取會累積延遲；分開平台無法靠 ICS 即時鎖住同一時段。店主同技術負責人要填可接受延遲 ________，並決定對應做法（人工確認／預約提前量／只用一個 booking 入口等）：________________。

## 9. Salon 要決定嘅預約規則同日常流程

| 決定項目 | 店主確認答案／批准人 |
|---|---|
| 網站預約係即時確認，定先等 salon approve | ________________ |
| 邊個批准；營業／非營業時段幾耐內處理 | ________________ |
| Pending booking 是否佔位、幾時到期、由誰解除 | ________________ |
| 最早可訂、最多提前幾日、時間格、即日 booking | ________________ |
| Patch test 適用服務、等候時間、有效期及紀錄負責人 | ________________ |
| Consultation／新客／未成年客需先經咩流程 | ________________ |
| 網站現有 24 小時取消／改期規則是否採用 | [ ] 採用 [ ] 需改；詳情：________ |
| 各平台取消條款與網站不同時點顯示／由邊度改單 | ________________ |
| 遲到／no-show／緊急取消／退款由誰處理 | ________________ |
| 訂金／預付款／到店付款、收款平台及賬單名稱 | ________________ |
| 電話／walk-in booking 首先入邊個日曆 | ________________ |
| Confirmation／reminder 由哪些平台發，點避免重複 | ________________ |
| 客人話收唔到電郵時，邊個查真實 booking 狀態 | ________________ |
| 同步／電郵故障時由誰關閉網上 booking，同邊度顯示替代聯絡 | ________________ |
| 開店前／收店前日曆對數負責人及代班 | ________________ |

Patch test 同其他服務要求以 salon 正式政策、產品要求及其專業負責人決定；唔從舊網站範例或平台預設值推斷。店主已確認政策附件位置：________________。

## 10. 方案、付款同基礎設施擁有權

呢度記當日 dashboard／報價嘅真實費用，唔用舊報告估價當現價。工程費、供應商訂閱、用量、SMS／電郵、marketplace 佣金、付款手續費同 VAT 分開核對。

| 服務 | Salon 擁有人／team／project ID | 方案及幣種／月費／用量上限 | 付款人／續費日 | 額外費／升級批准人 |
|---|---|---|---|---|
| Domain／mailbox | ________ | ________ | ________ | ________ |
| Resend | ________ | ________ | ________ | ________ |
| Treatwell | ________ | ________ | ________ | ________ |
| Fresha | ________ | ________ | ________ | ________ |
| Vercel | ________ | ________ | ________ | ________ |
| Neon | ________ | ________ | ________ | ________ |
| Upstash | ________ | ________ | ________ | ________ |
| Backup storage／其他 | ________ | ________ | ________ | ________ |

每月預算上限 ________；用量告警收件人 ________；任何增加 recurring cost 嘅批准紀錄 ________。

交接時分別核對以下資產，唔好只改主登入電郵：

- [ ] **Vercel**：記錄現有及接收 team、project ID、正式 domain、Git repo、production／preview env、cron、賬單。官方 project transfer 有權限要求，而且 integrations 唔會一併轉移；搬前逐個列明 Neon／Upstash 等資源點接返。[Vercel project transfer](https://vercel.com/docs/projects/transferring-projects)
- [ ] **Neon**：記錄組織、project、production branch、database、region、billing 管理來源及接收 owner。官方一般組織轉移對 Vercel-managed org／含 integrations 項目有限制；先確認此項目屬普通 Neon 定 Vercel 管理，再決定 support 交接或有備份嘅遷移方案。[Neon project transfer](https://neon.com/docs/manage/orgs-project-transfer)
- [ ] **Upstash**：由 salon 控制 team；核對 database ID、region、active 狀態、REST endpoint 同 token 配對。Owner 係建立 team 嗰個帳戶，官方文件唔容許直接將 Owner 角色派畀其他 member；已有工程師私人資源時，要核實移到 salon team 嘅支援路徑。Dev 亦有刪資料庫權限，唔等於 read-only。[Upstash teams](https://upstash.com/docs/common/account/teams)、[Upstash resource CLI](https://upstash.com/docs/agent-resources/cli)
- [ ] **Git repo／部署來源**：salon 是否有存取權、代碼及素材擁有權、誰可以 deploy、工程師離任後點接手：________________。
- [ ] **搬移順序**：先記錄設定及備份 → 接收方權限及付款 ready → 支援嘅 transfer／migration → 重接 integrations → 部署及測試 → 確認後撤銷舊 access。計劃窗口 ________；rollback 負責人 ________。

## 11. 技術交接：私密載入設定，再重新部署驗證

以下係本專案既有設定名稱；實際採用值由已驗證嘅 salon 帳戶提供。今次程式仍在整合時，新增設定以最終 `.env.example` 及部署版本為準。**唔好將「key 已填」當服務已連通。**

| 設定／資料 | 來源及載入位置 | 驗證結果（唔寫 secret） |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | 正式 canonical 網址；Vercel Production | ________ |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | Salon 控制嘅 Google Cloud OAuth project；server env | ________ |
| Google authorized redirect URI | 正式 origin + `/api/auth/google/callback`；Google Console | ________ |
| `SESSION_SECRET` | 由部署負責人安全產生及保管；server env | ________ |
| `RESEND_API_KEY` | 正確 salon Resend team／verified domain；server env | ________ |
| `EMAIL_FROM`、`EMAIL_REPLY_TO`、`SALON_NOTIFY_EMAIL` | 第 4 節已批核值；Vercel Production | ________ |
| `RESEND_AUDIENCE_ID`（如啟用 newsletter） | 正確 team audience；server env | ________ |
| `POSTGRES_URL`、`POSTGRES_URL_NON_POOLING` | 正確 production Neon project；integration／server env | ________ |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`，或 `KV_REST_API_URL` + `KV_REST_API_TOKEN` | 同一個有效 Upstash database 嘅成對憑證；server env | ________ |
| `CRON_SECRET` | Vercel／部署設定；核對 scheduled request 授權 | ________ |
| `NOTIFICATIONS_ENABLED` | 經 salon 批准發送真實 booking 電郵後設為 `true`；核對 notification cron | ________ |
| `CALENDAR_SYNC_ENABLED` 及 calendar cron | 正式共用日曆同步開關；只喺有效 feeds、頻率、成本、測試通過後設為 `true` | ________ |
| `TREATWELL_SYNC_ENABLED`（舊相容路由） | 新設定使用 `CALENDAR_SYNC_ENABLED`；唔靠舊開關啟用整套平台同步 | ________ |
| 官方 ICS URLs／對應員工／公開 booking links | 最終 admin integrations／staff／site settings；私密 feed 唔入 public 欄位 | ________ |
| Treatwell API 設定（如官方正式批准） | 官方文件、credentials、完整 adapter 驗收後處理；唔只靠開 feature flag | ________ |

- [ ] 先確認環境係 Production、Preview 定本機；preview 測試唔誤寄真客、唔共用正式寫入資料。
- [ ] Secret 透過授權 dashboard／secret vault／受控本機設定載入；唔放 `NEXT_PUBLIC_*`、前端 HTML 或 Git。
- [ ] 有兩組 Redis 命名時，核對程式優先順序同移除／更新舊配對；不可將 A 資料庫 endpoint 配 B token。
- [ ] 憑證存放完成後只展示 configured／masked／health 結果；唔截完整 env 頁。
- [ ] 部署人 ________；deployment URL／commit ________；migration／env 更新紀錄 ________。
- [ ] 部署後重新測試 OAuth、資料庫、Redis、電郵及 cron；更新 env 唔代表舊部署已載入新值。
- [ ] 到 `/admin/operations` 手動執行 read-only diagnostics，檢查 database、Resend domain、Redis 同 runtime 設定。呢個按鈕唔寄信；`Process due notifications` 係另一個會寄真實電郵嘅操作。
- [ ] 網站預約開關要求近 24 小時內、對應當前設定嘅完整通過報告；變更 key／domain／部署後重新執行。Resend sending-only key 如果冇列出 domain 嘅權限，結果係 unknown，要由有權人核對，唔可當成功。

## 12. 備份、復原同故障處理

本次工作開始時已知 Neon 復原窗口只得 6 小時，未見 snapshots；呢個係當時查核狀態，唔代表已建立正式備份。要由 owner 同技術負責人定義可接受資料損失同停機時間，並喺安全副本／測試環境實際復原一次。

| 項目 | 負責人／實際安排 |
|---|---|
| 最多可接受幾耐資料損失（RPO） | ________ |
| 最長可接受幾耐恢復服務（RTO） | ________ |
| 現有 Neon plan／實際 restore window | ________ |
| 自動備份／snapshot 頻率及保存期 | ________ |
| 獨立加密備份位置／存取及加密金鑰保管人 | ________ |
| 備份成功／失敗通知到邊個 mailbox | ________ |
| Migration／搬帳戶前備份方法 | ________ |
| 上次成功復原：時間、資料範圍、核對結果 | ________ |
| 故障時暫停 booking／回復版本負責人 | ________ |
| 手工記錄預約位置、恢復後對數負責人 | ________ |

- [ ] 備份包含需要嘅 appointment、客戶、服務、員工、更表及管理設定；另記外部平台同媒體資料係咪包含。
- [ ] 做過測試復原，核對筆數／指定樣本／預約時間及 login；有備份檔但未復原過唔剔通過。
- [ ] 誰收系統故障、同步停更、電郵失敗、費用上升通知，已實際測試：________________。

## 13. 本次工作開始時嘅缺口，同最後驗收清單

以下係**修正前查核起點**，唔係今次實作完成後嘅最新保證。上線前逐項重驗，填新結果同證據；舊報告嘅日期、方案、程式行為可能已改。

| 起點 | 完成條件 | 最新結果／證據／負責人 |
|---|---|---|
| Native booking 關閉 | 所選 booking 模式批核並完成全套驗收 | ________ |
| 四個 staff，只有一位有工時 | 每位 staff 已核對工時、服務、外部 IDs | ________ |
| 冇可用 Treatwell inbound feeds | 官方來源確認、設定並新增／改期／取消測試；或明確採替代營運模式 | ________ |
| Fresha 公開 URL 空白 | 確認正確 venue URL；有用 Fresha 時另驗日曆 | ________ |
| Resend sender 用 harbourhair.co.uk，但當時 key 所屬 team 只有 hillmanchan.com verified | Salon domain 真正 verified，正確 key，客人及 salon 實收成功 | ________ |
| Upstash REST host DNS 查核失敗 | 正確 active database 成對設定，DNS／REST／跨請求限制實測成功 | ________ |
| Neon 6 小時復原窗口、未見 snapshots | 批核備份方案、啟用並完成復原演練 | ________ |

每項用「通過／失敗／不適用＋原因」，並填 deployment、時間或私密證據位置。

| 驗收 | 通過標準 | 結果／證據 |
|---|---|---|
| 帳戶 ownership | 店主可獨立登入、管理 billing／復原；技術 access 可撤銷 | ________ |
| Google 登入 | 正式網址登入／登出成功；一般客戶冇 admin 權限 | ________ |
| 公開頁及 booking 入口 | 手機／桌面資料、價目、電話、地圖、各平台 link 都正確 | ________ |
| 工時／服務 | 四位 staff逐個驗；休息、假期、不可做服務唔出錯誤時段 | ________ |
| Website booking | 建單資料正確，只建立一單；客人及 salon 收到通知 | ________ |
| 同時搶同一時段 | 兩個獨立登入同時提交，按已定規則只接受一單 | ________ |
| Anyone／共享資源 | 分配正確 staff；唔超過椅／洗頭位／服務能力 | ________ |
| Patch test／consultation | 需要前置流程嘅服務按已批准規則處理 | ________ |
| 取消／改期 | 24 小時邊界或已批准政策正確；舊／新時段及通知正確 | ________ |
| 平台 → 網站 | 每位 staff 新增、改期、取消，同步方向同延遲有記錄 | ________ |
| 網站 → 平台 | 目的地訂閱證據、忙碌封鎖可見；無回圈、無錯誤員工 | ________ |
| GMT／BST、跨日／全日事件 | Europe/London 顯示及封鎖時間一致，唔偏一小時 | ________ |
| 同步故障／過期資料 | 無法讀 feed 時唔錯誤放出忙碌時段；告警及暫停流程有效 | ________ |
| 寄信失敗／重試 | Booking 狀態仍可查；唔重複建單；失敗有人跟進 | ________ |
| Redis／登入限制 | 有效共享 Redis 測試通過，唔單靠 configured 字眼 | ________ |
| Cron／背景工作 | 於實際 deployment 有成功紀錄，頻率／UTC時間／成本已批核 | ________ |
| Backup／restore | 安全測試副本已復原，筆數同預約樣本正確 | ________ |
| Reception 操作 | 同事可查單、確認、改期、關閉 booking，知道故障聯絡人 | ________ |

如果某平台冇官方可用同步，驗收要標明「不適用：網站只提供已核實之外部入口」等真實安排，唔可以寫「雙向同步通過」。本網站內部防撞期成功，亦唔等於跨平台即時防撞期成功。

## 14. 合約、未解決事項同離店簽收

由店主確認 Treatwell／Fresha 實際 partner agreement、API／feed 使用資格、資料匯出權、第三方開發者存取、佣金來源及支付／退款責任。能在畫面取得 URL 唔代表已獲得任意複製或整合全部客戶資料嘅權利；有不清楚嘅項目，用官方 support 書面回覆記錄，唔由工程師估。Treatwell 公開條款只係核對入口，亦要睇 salon 自己簽署嘅條件。[Treatwell Partner Terms](https://www.treatwell.co.uk/info/supplier-terms-and-conditions/)

| 未解決／需批核項目 | 需要邊份資料／證據 | 負責人 | 日期 | 是否阻擋所選上線模式 |
|---|---|---|---|---|
| ________________ | ________________ | ________ | ________ | ________ |
| ________________ | ________________ | ________ | ________ | ________ |
| ________________ | ________________ | ________ | ________ | ________ |
| ________________ | ________________ | ________ | ________ | ________ |

- [ ] 帳戶、DNS、付款及復原責任已清楚；owner 知道自己擁有邊啲資產。
- [ ] 已核對價格、工時、員工對應、patch test、取消／改期同人工 approval 流程。
- [ ] 真正私密憑證／ICS 已安全保管；紙本同聊天只有項目名稱同結果。
- [ ] 本次只係完成設定／測試，定批准正式接客，已清楚記錄。
- [ ] 測試資料及測試預約已按約定清理；冇遺留真實日曆封鎖或測試通知。
- [ ] 店主／reception 已知道日常對數同出事時暫停 booking 嘅方法。

最終選擇： [ ] 只公開網站及已核實外部 booking 入口　[ ] 內部測試　[ ] 批准啟用網站預約　[ ] 暫緩
已驗證部署／版本：________________  正式啟用時間：________________
採用嘅日曆／人工確認模式及限制：________________________________________________
未完成但已接受嘅項目、影響及補救安排：________________________________________________
店主／授權決策人簽名：________________  技術負責人：________________  日期：________________

**帶返嚟嘅成果應該係：邀請已接受、資料表填好、設定所屬帳戶清楚、私密項目已安全交接、測試證據同剩餘事項有負責人。** 唔需要帶返一串店主密碼。
