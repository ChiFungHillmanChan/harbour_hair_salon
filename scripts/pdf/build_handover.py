#!/usr/bin/env python3
"""Build the blank, interactive Cantonese salon handover pack.

Usage: python scripts/pdf/build_handover.py --metadata scripts/pdf/release-metadata.json
Dependencies: reportlab, pypdf, fonttools. A complete embeddable CJK TrueType font
is required; pass --font or set SALON_PDF_CJK_FONT on non-macOS hosts.
The master stays blank. QA values are written only to tmp/pdfs/.
"""
from __future__ import annotations
import argparse
import json
import os
import re
from pathlib import Path

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parents[2]
W, H = A4
M = 38
CW = W - M * 2
NAVY = HexColor('#174F7F')
INK = HexColor('#193445')
TEAL = HexColor('#167D8D')
MUTED = HexColor('#526774')
LINE = HexColor('#C4D5DF')
PALE = HexColor('#EFF5F8')
WARM = HexColor('#F8F2E8')
FIELDS = []
PAGES = []


def wrapped(text, width, size=10, font='CJK'):
    """Wrap CJK by character while keeping English words and closing marks whole."""
    result=[]
    for paragraph in str(text).split('\n'):
        line=''
        tokens=re.findall(r'[A-Za-z0-9_@./%+\-]+|.',paragraph)
        for token in tokens:
            if not line and token.isspace():
                continue
            if pdfmetrics.stringWidth(token,font,size)>width:
                units=list(token)
            else:
                units=[token]
            for unit in units:
                if line and pdfmetrics.stringWidth(line+unit,font,size)>width:
                    if unit in '，。；：！？、）】》」』':
                        match=re.search(r'[A-Za-z0-9_@./%+\-]+$',line)
                        move=match.group(0) if match else line[-1]
                        result.append(line[:-len(move)].rstrip())
                        line=move+unit
                    else:
                        result.append(line.rstrip())
                        line=unit.lstrip()
                else:
                    line+=unit
        result.append(line.rstrip())
    return result


class Pack:
    def __init__(self, output, metadata):
        self.c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
        self.c.setTitle('Harbour Hair Salon | 到店設定及營運交接工作冊')
        self.c.setAuthor('Harbour Hair Salon')
        self.c.setSubject('廣東話可填寫交接表；不記錄密碼、金鑰或私密日曆網址')
        self.meta = metadata
        self.page_no = 0

    def text(self, text, x, top, size=10, color=INK, font='CJK'):
        self.c.setFillColor(color)
        self.c.setFont(font, size)
        self.c.drawString(x, H - top - size * .85, str(text))

    def para(self, text, x, top, width=CW, size=10, leading=15, color=INK):
        lines = wrapped(text, width, size)
        for i, line in enumerate(lines):
            self.text(line, x, top + i * leading, size, color)
        return top + len(lines) * leading

    def box(self, x, top, width, height, fill=PALE, stroke=None, radius=6):
        self.c.setFillColor(fill)
        self.c.setStrokeColor(stroke or fill)
        self.c.roundRect(x, H - top - height, width, height, radius, fill=1, stroke=bool(stroke))

    def line(self, x, top, width, color=LINE):
        self.c.setStrokeColor(color)
        self.c.setLineWidth(.55)
        self.c.line(x, H-top, x+width, H-top)

    def page(self, number, title, intro, tag):
        if self.page_no:
            self.c.showPage()
        self.page_no = number
        PAGES.append({'number': number, 'title': title, 'tag': tag})
        self.box(0, 0, W, 44, NAVY, radius=0)
        self.text('HARBOUR HAIR SALON', M, 16, 10.5, white, 'Helvetica-Bold')
        self.text('到店設定及營運交接工作冊', 336, 16, 9, white)
        self.text(f'{number:02d}', M, 66, 25, TEAL, 'Helvetica-Bold')
        self.text(title, M+47, 66, 21, NAVY)
        self.text(tag, M+48, 96, 8.1, MUTED, 'Helvetica')
        self.para(intro, M, 119, CW, 10.2, 15)
        self.line(M, 789, CW)
        self.text('空白主本 | 填好後另存副本 | 私密憑證只記 vault 項目位置', M, 799, 8, MUTED)
        self.text(f'{number:02d} / 16', W-M-40, 799, 8.5, MUTED, 'Helvetica')

    def section(self, title, top, subtitle=None):
        self.text(title, M, top, 12.4, NAVY)
        if subtitle:
            self.text(subtitle, M, top+20, 8.8, MUTED)

    def field(self, name, x, top, width, height=27, tooltip='', multiline=True, size=10):
        if name in {f['name'] for f in FIELDS}:
            raise ValueError(f'Duplicate field {name}')
        if top + height > 781:
            raise ValueError(f'Field outside content region: {name} {top+height}')
        self.c.acroForm.textfield(name=name, tooltip=tooltip or name,
            x=x, y=H-top-height, width=width, height=height,
            value='', fontName='Helvetica', fontSize=size,
            borderWidth=.6, borderColor=LINE, fillColor=PALE,
            textColor=INK, forceBorder=True, fieldFlags='multiline' if multiline else '',
            maxlen=5000)
        FIELDS.append({'name':name,'type':'text','page':self.page_no,'rect':[x,top,width,height]})

    def entry(self, label, name, x, top, width, height=29, size=9.4):
        self.text(label, x, top, size, MUTED)
        self.field(name, x, top+15, width, height, label)
        return top+15+height

    def check(self, label, name, x, top, width=CW, size=10):
        if name in {f['name'] for f in FIELDS}:
            raise ValueError(name)
        self.c.acroForm.checkbox(name=name, tooltip=label, x=x, y=H-top-12,
            size=12, checked=False, buttonStyle='check', shape='square',
            fillColor=white, borderColor=TEAL, textColor=NAVY, borderWidth=.9,
            forceBorder=True)
        FIELDS.append({'name':name,'type':'checkbox','page':self.page_no,'rect':[x,top,12,12]})
        return self.para(label, x+20, top-1, width-20, size, 14)+5

    def notice(self, text, top, height=49, fill=WARM):
        self.box(M, top, CW, height, fill)
        self.para(text, M+12, top+10, CW-24, 9.4, 14)

    def source(self, title, url, top):
        # Human-readable official title with an actual PDF link annotation.
        self.text('官方參考：'+title, M, top, 8.1, TEAL)
        self.c.linkURL(url, (M,H-top-12,W-M,H-top+2), relative=0, thickness=0)

    def grid(self, top, columns, rows, prefix, row_height=39, label_col=True):
        """Rows are label strings; columns are (title, fraction) cells."""
        widths = [CW * c[1] for c in columns]
        self.box(M, top, CW, 26, NAVY, radius=3)
        x=M
        for (title,_), width in zip(columns,widths):
            self.text(title,x+6,top+8,8.7,white)
            x+=width
        y=top+26
        for index, row in enumerate(rows):
            x=M
            for j,width in enumerate(widths):
                if j==0 and label_col:
                    self.para(row,x+5,y+9,width-10,9.4,13)
                else:
                    self.field(f'{prefix}_{index+1}_{j}',x+3,y+4,width-6,row_height-8,
                        f'{row} - {columns[j][0]}',size=9.4)
                x+=width
            self.line(M,y+row_height,CW)
            y+=row_height
        return y

    def finish(self):
        self.c.save()


def pages(p):
    half=(CW-14)/2
    p.page(1,'到店工作總覽','帶齊決策人、獨立邀請電郵及真實更表；完成一項就勾選，未核實嘅項目留白並記錄負責人。','VISIT PLAN / RELEASE STATUS')
    p.box(M,162,CW,125,NAVY)
    p.text(p.meta.get('release_status','部署進行中'),M+16,177,16,white)
    p.para(p.meta.get('release_summary','程式更新正準備部署；帳戶、DNS、實際平台訂閱及真實寄信仍要到店驗收。'),M+16,202,CW-32,10,15,white)
    p.text('版本：'+p.meta.get('release_ref','待部署完成後記錄'),M+16,247,9,white)
    p.text('狀態記錄：'+p.meta.get('recorded_at','2026-09-11 / Europe-London'),M+16,264,8.5,white)
    p.entry('到店日期及時間','visit_datetime',M,305,half)
    p.entry('店主／有權決策人','visit_owner',M+half+14,305,half)
    p.entry('技術負責人／聯絡方法','visit_technical',M,360,half)
    p.entry('Reception 驗收人／聯絡方法','visit_reception',M+half+14,360,half)
    p.section('今日要帶走嘅成果',424)
    for i,label in enumerate([
      '每個平台正確帳戶已確認，獨立邀請已接受；店主保留 MFA、復原及付款控制。',
      '四位員工、更表、服務時長／價錢，以及實際平台 IDs 已填好。',
      '日曆兩個方向都有設定及實際事件證據；未做到嘅地方有替代流程。',
      '電郵、日曆、通知、備份驗收有日期；上線模式同責任人有明確簽收。']):
        p.check(label,f'visit_goal_{i+1}',M,451+i*34)
    p.notice('填寫方法：淡藍欄可直接輸入，中英文字可混合；方格可點選。先另存一份工作副本，再儲存、關閉及重新開啟核對。長答案可用第 14 頁備註；密碼、API key、私密 ICS URL 一律唔填入本表。',601,68)
    p.section('工作次序',692)
    p.para('02 帳戶 → 03-05 設定與平台 → 06-07 員工更表 → 08-09 雙向證據\n10-11 服務及流程 → 12 費用與復原 → 13 驗收 → 14 決定及簽收\n15 程式與部署分析 → 16 系統邊界、Neon 配額與成本',M,716,CW,10,17)

    p.page(2,'帳戶控制與獨立邀請','Google 登入身份、Resend 網域驗證、各平台存取權係三件事。唔需要收集店主嘅 Google 主密碼。','OWNER / ACCESS / RECOVERY')
    p.entry('店主控制嘅管理電郵','owner_admin_email',M,165,half)
    p.entry('技術人員獨立邀請電郵','technical_invite_email',M+half+14,165,half)
    p.entry('備用管理人／MFA 保管人','backup_admin',M,220,half)
    p.entry('Salon vault 名稱／授權聯絡人（唔填 secret）','vault_location',M+half+14,220,half)
    p.grid(282,[('平台／資產',.22),('Owner／team 或 project ID',.38),('邀請對象／角色／接受日期',.40)],
      ['Google /\nBusiness Profile','Google Cloud OAuth','Resend','Treatwell','Fresha','Domain / DNS','Vercel / GitHub','Neon / Upstash'],'account',38)
    p.check('店主可自行登入；MFA 及復原電郵／電話已核對，只記結果。','account_owner_login',M,626)
    p.check('只授予實際工作需要嘅角色；離任後可撤銷技術 access。','account_min_roles',M,655)
    p.check('平台冇合適邀請角色時，由店主在場登入、完成驗證及敏感設定。','account_owner_present',M,684)
    p.entry('復原核對日期／撤銷或檢討 access 日期','account_review_date',M,717,CW,23)
    p.source('Google：Gmail delegation 與商戶 owner／manager 係獨立權限','https://support.google.com/business/answer/3403100?hl=en',772)

    p.page(3,'網域、聯絡資料與 Resend','先搵到真正 DNS 管理人，再核對 salon 寄件網域。登入到 Resend 並唔代表 harbourhair.co.uk 已可發信。','DOMAIN / DNS / BRANDED EMAIL')
    items=[('正式網域／www 或無 www','canonical_domain'),('Domain 註冊商／續費人／日期','domain_renewal'),('DNS 平台／可改記錄嘅聯絡人','dns_owner'),('現有 mailbox 供應商','mail_provider'),('公開電話／WhatsApp','public_phone'),('公開查詢電郵','public_email'),('Salon 通知 mailbox／每日閱讀人','salon_notify_mailbox'),('Reply-to mailbox／代班負責人','reply_mailbox')]
    for i,(label,name) in enumerate(items):
        p.entry(label,name,M+(i%2)*(half+14),163+(i//2)*52,half,26)
    p.section('Resend 現場核對',379)
    p.entry('Salon team 名稱／ID／管理員','resend_team',M,406,half,26)
    p.entry('寄件 domain／From 顯示名稱及地址','resend_sender',M+half+14,406,half,26)
    p.entry('DNS 加記錄人／完成時間／原記錄備份位置','resend_dns_evidence',M,458,CW,29)
    p.entry('Domain verified／sending enabled 證據位置；key 所屬 team 及 vault 項目','resend_key_evidence',M,516,CW,35)
    for i,label in enumerate(['按 Resend dashboard 加 SPF／DKIM；DMARC 另行確認，保留原有收信設定。','Production key、寄件 domain、From 一致；secret 已私密載入 Vercel。','兩個不同郵件供應商測試：客人及 salon 實收、spam、reply 都核對。']):
        p.check(label,f'resend_check_{i+1}',M,583+i*30)
    p.entry('收件／回覆結果及時間；測試地址只用獲准地址','resend_delivery_result',M,685,CW,39)
    p.source('Resend：Managing Teams / Managing Domains（點擊開啟）','https://resend.com/docs/dashboard/domains/introduction',762)

    p.page(4,'Google 登入與網站資料','Google Business Profile、Gmail delegation、Cloud IAM／OAuth 要分開授權；基本 Google 登入唔會自動取得 Calendar API 權限。','GOOGLE OAUTH / PUBLIC DETAILS')
    p.entry('Google Business Profile URL／Primary owner','google_business_owner',M,165,CW,27)
    p.entry('Google Cloud project 名稱／ID／IAM 管理人','google_cloud_project',M,218,CW,29)
    p.entry('OAuth client ID（非 secret）／用途','google_oauth_client_id',M,273,CW,27)
    p.entry('正式 origin；authorized redirect URI = 正式 origin + /api/auth/google/callback','google_redirect_uri',M,327,CW,33)
    p.entry('Client secret／SESSION_SECRET 嘅 vault 項目及載入環境（唔填值）','google_secret_location',M,387,CW,29)
    p.check('Consent screen 名稱、正式網域、私隱政策及發布狀態已核對。','google_consent_checked',M,446)
    p.check('正式網址登入、登出、重新登入成功；普通客戶無 admin 權限。','google_login_checked',M,475)
    p.section('公開內容由店主批准',514)
    p.entry('公司／salon 名稱、地址、postcode；Google／平台資料對齊','public_identity',M,541,CW,41)
    p.entry('相片／logo／staff 介紹／評價使用權；價目／私隱／條款批准人及日期','public_content_approval',M,613,CW,48)
    p.check('如需 Gmail 代管，已用獨立 delegation；唔當作其他服務嘅登入授權。','gmail_delegation_scope',M,692)
    p.source('Google OpenID Connect：scope 及 redirect URI','https://developers.google.com/identity/openid-connect/openid-connect',735)
    p.source('Google Cloud：project IAM access','https://docs.cloud.google.com/resource-manager/docs/access-control-proj',753)
    p.source('Google Gmail：delegation','https://support.google.com/mail/answer/138350?hl=en',771)

    p.page(5,'Treatwell 與 Fresha 實際能力','先確認產品、國家、venue／workspace 同角色，再確認每位員工可以用嘅日曆方向。未有證據就保持「未確認」。','PLATFORM CAPABILITY / CONTRACT RIGHTS')
    p.section('Treatwell：唔預設英國帳戶有 feed 匯出或 appointment API',162)
    p.entry('Connect／Pro／其他；國家、登入 URL、venue 名稱及 ID','tw_venue_identity',M,188,CW,31)
    p.entry('Owner／合約人／技術角色；正式 booking URL','tw_owner_role_url',M,248,CW,31)
    p.entry('可用功能：匯入／匯出／每員工／API；支援文件或 support case 位置','tw_capability_evidence',M,308,CW,47)
    p.check('Owner 已實測所需員工及日曆設定權；無法操作嘅步驟有指定負責人。','tw_access_verified',M,377)
    p.section('Fresha：workspace、location、staff 逐個核對',419)
    p.entry('Workspace／location 名稱及 ID；owner／付款人','fr_workspace_identity',M,446,CW,31)
    p.entry('正式 booking URL；技術邀請／角色；新增 access 費用批准','fr_access_cost_url',M,506,CW,31)
    p.entry('Linked calendars 實際設定及官方來源；每 staff 方向記第 8-9 頁','fr_capability_evidence',M,566,CW,37)
    p.notice('Fresha 英文官方文件描述 ICS 匯入／匯出及 blocked time，更新可能需最多 15 分鐘。呢個唔係本網站已完成接駁或全程延遲保證；Treatwell feed／API 仍要本店帳戶或官方書面確認。',635,65)
    p.entry('合約／第三方存取／資料匯出／佣金責任待確認事項及 support 負責人','platform_contract_open',M,713,CW,25)
    p.source('Fresha：Link your calendar（英文官方文件）','https://www.fresha.com/help-center/knowledge-base/calendar/101373-sync-your-fresha-calendar',759)
    p.source('Treatwell：external calendar support（現場核對入口）','https://partnercare.treatwell.com/s/article/How-to-sync-Connect-with-other-calendar-softwares?language=en_GB',774)

    for number,staffs in [(6,[1,2]),(7,[3,4])]:
        p.page(number,'四位員工：身份、工時與資格','每人填足七日；休息日寫「休」。所有時間用 Europe/London，固定休息、假期及臨時加更要有維護人。','STAFF MAPPING / WEEKLY HOURS')
        for pos,staff in enumerate(staffs):
            top=164+pos*289
            p.box(M,top,CW,26,NAVY, radius=3)
            p.text(f'員工 {staff:02d}  /  STAFF {staff:02d}',M+10,top+8,10,white)
            p.entry('姓名／網站 stylist ID',f'staff_{staff}_identity',M,top+37,half,24)
            p.entry('Treatwell staff ID；Fresha member／location ID',f'staff_{staff}_external_ids',M+half+14,top+37,half,24,8.7)
            colw=CW/7
            for day,label in enumerate(['星期一','星期二','星期三','星期四','星期五','星期六','星期日']):
                x=M+day*colw
                p.text(label,x+4,top+91,9,NAVY)
                p.field(f'staff_{staff}_hours_{day+1}',x+2,top+110,colw-4,65,f'員工{staff} {label}：開工-收工；休息時段',size=9.2)
            p.text('每格填：開工-收工／午飯或休息；例如 09:00-18:00，13:00-14:00 休息。',M+3,top+182,8.7,MUTED)
            p.entry('可做服務／價級；假期表位置；生效日期／維護人',f'staff_{staff}_services_effective',M,top+207,CW,35)
        p.entry('共用更表位置／假期及臨時更改流程／最少提前更新時間',f'staff_page_{number}_roster',M,750,CW,16,8.7)

    for number,direction,prefix in [(8,'平台 → 網站','inbound'),(9,'網站 → 平台','outbound')]:
        intro='每一行對應一位員工及一個平台。唔使用嘅渠道寫「不適用＋原因」；真正 feed URL 只放 private vault。'
        p.page(number,'日曆證據：'+direction,intro,'CALENDAR DIRECTION / PER-STAFF EVIDENCE')
        p.notice(('匯入 busy time 只係封鎖時段，唔會建立完整平台預約／付款／退款。網站每 30 分鐘拉取一次；要實測來源更新、輪詢及快取累積延遲。' if prefix=='inbound' else '要喺收資料嘅平台睇到已儲存 subscription 同測試 busy block。網站輸出只含網站預約，唔會轉發另一平台匯入事件；兩個 marketplace 互相防撞期要另有流程。'),160,59)
        y=231
        for staff in range(1,5):
            for provider,short in [('Treatwell','tw'),('Fresha','fr')]:
                p.text(f'{staff:02d} / {provider}',M,y+4,9.5,NAVY)
                p.check('',f'{prefix}_{staff}_{short}_passed',M,y+23,17)
                p.text('通過',M+19,y+24,8,MUTED)
                p.field(f'{prefix}_{staff}_{short}_setup',M+95,y,CW*.41,49,
                    f'{direction} 員工{staff} {provider}：ID、vault項目、訂閱／設定證據',size=9.2)
                p.field(f'{prefix}_{staff}_{short}_tests',M+102+CW*.41,y,CW-(102+CW*.41),49,
                    f'{direction} 員工{staff} {provider}：新增／改期／取消／時間／延遲／正確員工證據',size=9.2)
                if staff==1 and short=='tw':
                    p.text('ID／vault 項目／設定證據',M+99,y-12,8,MUTED)
                    p.text('事件代號／時間／延遲／結果',M+106+CW*.41,y-12,8,MUTED)
                p.line(M,y+55,CW)
                y+=62
        p.para('每行證據需涵蓋：新增封鎖、改期釋放舊時段、取消釋放、只影響正確員工、無回圈。Feed 失效／過期保留 busy blocks；重複規則或不支援格式要先解決。',M,735,CW,9.1,13)

    p.page(10,'服務、價錢與共享資源','每個服務／variation 分開一行。資料唔夠就加附件，記低附件位置；唔好將不同長度、價級或 processing time 混成一項。','SERVICE MAPPING / CAPACITY')
    columns=[('服務／網站及平台 IDs',.28),('時長／佔用／buffer',.20),('價錢／fixed 或 from',.18),('員工／資源／前置要求',.34)]
    p.grid(163,columns,[f'服務 {i}' for i in range(1,7)],'service',62,label_col=False)
    p.entry('幣種／VAT 是否包括；平台差價／優惠；批准人；更多 service 表附件位置','service_pricing_policy',M,578,CW,36)
    p.entry('共享椅／洗頭位／房間數量；同時接客上限；processing time 保守佔用規則','shared_resources',M,639,CW,36)
    p.entry('Anyone 可選員工／分配規則；未能表示嘅共享資源／服務暫緩安排','anyone_allocation',M,700,CW,40)
    p.text('每項要求：服務 IDs、總時長／實際佔用／buffer、售價、可做員工、patch test 或 consultation。',M,770,8.4,MUTED)

    p.page(11,'預約規則與每日操作','現有網站流程係 PENDING → salon 核對 → CONFIRMED。ICS 有延遲，確認之前仍要核對平台最新預約。','BOOKING POLICY / RECEPTION RUNBOOK')
    decisions=[
      ('誰批准 pending；營業／非營業時段回覆目標；佔位與解除處理','policy_approval'),
      ('可提前幾日／即日預約／時間格；整段服務最多 90 日減 45 分鐘內','policy_horizon'),
      ('Patch test／consultation／新客／未成年要求；有效期及紀錄人','policy_preconditions'),
      ('現有 24 小時取消／改期政策是否採用；平台差異及例外批准','policy_cancellation'),
      ('訂金／no-show／付款／退款及平台佣金由誰處理；未實作功能嘅手工流程','policy_payment'),
      ('網站／Treatwell／Fresha／電話各由誰建單改期取消；跨平台衝突最終核對人','policy_source_of_truth')]
    for i,(label,name) in enumerate(decisions):
        p.entry(label,name,M,162+i*69,CW,40,9.1)
    p.section('Reception 每日核對',597)
    for i,label in enumerate(['查看 pending、salon mailbox 同最近各平台預約；確認前再核對時段。','查看 Operations 同 Integrations；同步過期、寄信失敗有人跟進。','通知結果不明或已過安全重試窗口，先對 Resend 紀錄，唔直接重寄。']):
        p.check(label,f'reception_routine_{i+1}',M,625+i*29,size=9.5)
    p.entry('緊急關閉 booking／手工記單／對數負責人及聯絡方法','incident_contact',M,718,CW,33)

    p.page(12,'擁有權、費用、備份與設定','逐項確認 salon 擁有邊啲資產及付款責任。部署、搬 account 或 migration 前，先確認可用備份及回復方法。','OWNERSHIP / COST / RECOVERY / ENVIRONMENT')
    p.grid(161,[('資產',.18),('Owner／team／project；移交方法',.43),('方案／月費／上限／付款／批准',.39)],
      ['Domain / mailbox','Resend','Treatwell / Fresha','Vercel / GitHub','Neon','Upstash'],'ownership_cost',35)
    p.entry('每月總預算／用量告警收件人；新增 recurring cost 批准紀錄','monthly_cost_approval',M,412,CW,26)
    p.entry('Neon plan／restore window；snapshot 或加密備份位置／頻率／保存期（唔填 key）','backup_plan',M,465,CW,33)
    p.entry('RPO／RTO；上次安全副本復原日期／樣本核對／復原負責人','restore_evidence',M,525,CW,33)
    p.entry('Production env／vault 項目、載入人、deployment 證據（唔填任何 secret）','runtime_env_evidence',M,585,CW,30)
    p.para('NEXT_PUBLIC_SITE_URL、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_SECRET；\nRESEND_API_KEY、EMAIL_FROM、EMAIL_REPLY_TO、SALON_NOTIFY_EMAIL；\nPOSTGRES_URL、POSTGRES_URL_NON_POOLING；CRON_SECRET；\nUPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN（或 KV_REST_API_URL + KV_REST_API_TOKEN）；\nNOTIFICATIONS_ENABLED／CALENDAR_SYNC_ENABLED；通知與日曆每 30 分鐘，reminder 每日 08:00 UTC。',M,640,CW,8.15,12.5)
    p.check('Vercel transfer 後逐個重接 integration；Neon／Upstash 先確認支援嘅移交方法。','transfer_integrations',M,713,size=9.2)
    p.source('Vercel project transfer','https://vercel.com/docs/projects/transferring-projects',750)
    p.source('Neon project transfer / Upstash team 權限需另行核對','https://neon.com/docs/manage/orgs-project-transfer',769)

    p.page(13,'上線驗收：每項有結果及證據','只剔真正通過嘅項目；不適用要寫原因。使用獲准測試帳戶／收件地址，完成後清理測試預約及日曆封鎖。','ACCEPTANCE / RELEASE EVIDENCE')
    tests=[
      '店主可登入／復原／付款；技術 access 可撤銷',
      '正式 Google 登入；普通客戶無 admin 權限',
      '手機／桌面資料、價目、電話及 booking links 正確',
      '四位 staff 工時／休息／假期／服務逐人核對',
      '網站建單正確；只一單；客人及 salon 實收通知',
      '兩人同搶時段只接受一單；Anyone／資源正確',
      'Patch test／consultation／pending approval 正確',
      '取消／改期邊界；舊／新時段及通知正確',
      '平台 → 網站：每員工新增／改期／取消（第 8 頁）',
      '網站 → 平台：訂閱及忙碌證據／無回圈（第 9 頁）',
      'GMT／BST、跨日／全日事件時間一致',
      'Feed 失效／過期保留 busy；關閉及跟進有效',
      '寄信失敗／重試；無重複建單或不明狀態重寄',
      'Redis 實際共享限制；唔只睇 PING 或 configured',
      '正式 cron 成功紀錄／時間／頻率／成本已批准',
      'Operations 當前設定全通過；啟用前 24 小時內報告',
      '安全副本成功 restore；Reception 可操作及停用']
    p.box(M,161,CW,24,NAVY,radius=3)
    p.text('通過',M+7,168,8.6,white)
    p.text('驗收項目',M+46,168,8.6,white)
    p.text('結果／日期／證據位置／不適用原因',M+324,168,8.1,white)
    for i,label in enumerate(tests):
        y=190+i*32.4
        p.check('',f'acceptance_{i+1}_passed',M+9,y+5,17)
        p.para(label,M+44,y+4,270,8.5,11.5)
        p.field(f'acceptance_{i+1}_evidence',M+323,y,CW-326,28,label+'：結果／日期／證據',size=8.8)
        p.line(M,y+31,CW)
    p.text('Diagnostics 係只讀檢查；Process due notifications 會發送真實電郵，須由獲授權人操作。',M,758,8.7,MUTED)
    p.text('若平台未有官方可用同步，只可記錄真實採用模式，唔可以剔「雙向同步通過」。',M,773,8.7,MUTED)

    p.page(14,'未完成事項、上線決定與簽收','空白唔代表通過。每個阻擋項目要有負責人、完成日期及接受風險／替代流程；店主保管填好嘅副本。','FOLLOW-UP / DECISION / SIGN-OFF')
    for i in range(3):
        p.entry(f'跟進 {i+1}：未完成項目／影響／需要證據／負責人／期限／是否阻擋上線',f'followup_{i+1}',M,161+i*64,CW,39,9.1)
    p.section('本次決定（只選一項）',366)
    options=[('只公開網站及已核實外部入口','decision_external_only'),('內部測試','decision_internal_test'),('批准啟用網站預約','decision_enable_booking'),('暫緩','decision_defer')]
    for i,(label,name) in enumerate(options):
        p.check(label,name,M+(i%2)*(half+14),395+(i//2)*29,half,9.8)
    p.entry('已驗證 deployment／版本；正式啟用時間；採用日曆及人工確認模式','signoff_release_mode',M,462,CW,37)
    p.entry('備註／已接受限制、補救安排及附件位置','signoff_notes',M,526,CW,67)
    p.check('私密憑證已安全交接；測試資料已清理；店主／Reception 知道停用及故障流程。','signoff_handover_complete',M,616,size=9.3)
    p.entry('店主／授權決策人姓名確認','signoff_owner',M,656,half,25)
    p.entry('技術負責人姓名確認','signoff_technical',M+half+14,656,half,25)
    p.entry('日期／下一次跟進時間','signoff_date_followup',M,708,CW,25)
    p.text('姓名欄為交接確認紀錄；需要手寫簽署時可列印簽署。請保留空白主本，另存已填副本。',M,765,8.5,MUTED)


    p.page(15,'分析：已修正內容與正式狀態','程式測試、production 部署，同 salon 真實帳戶驗收要分開睇。以下記錄交付範圍；可填寫驗收表仍以第 1-14 頁為準。','ANALYSIS / IMPLEMENTATION / LIVE BLOCKERS')
    p.box(M,161,CW,84,NAVY)
    p.text(p.meta.get('release_status','部署進行中'),M+13,174,13,white)
    p.para(p.meta.get('deployment_evidence','Production 部署及第 13 個 migration 正等待確認；網站預約、通知與日曆開關保持關閉。'),M+13,197,CW-26,9.4,14,white)
    changes=[
      ('預約一致性','Named／Anyone 同用時段檢查；價錢及時長保存於預約。建立、折扣使用、通知紀錄一齊 commit；失敗一齊 rollback。'),
      ('並發／改期／確認','Serializable 交易重新核對工時及忙碌時段；取消／改期競爭唔會被舊操作覆蓋。整段服務限於 90 日減 45 分鐘內。'),
      ('通知與重試','通知入資料庫佇列；穩定事件 key、lease、退避及逾時。超過安全窗口先核對供應商紀錄；成功／過時通知清除個人 payload。'),
      ('日曆及後台','每位員工獨立 inbound／outbound 設定；失敗保留 busy blocks。Integrations 檢查連線；Operations 顯示診斷、cron 及通知結果。'),
      ('開放預約保護','要求完整更表、活躍平台同步及訂閱證據、正確寄信／Redis／cron 設定。啟用前要近 24 小時當前設定診斷；之後唔靠每日人工重跑續期。'),
      ('已完成本機驗證','382 個測試、lint、TypeScript 及 production build 通過；13 個 migrations 空白及有舊資料測試通過；真 PostgreSQL 並發／回滾及模擬通知驗證通過。')]
    y=262
    for label,body in changes:
        p.text(label,M,y,10.2,NAVY)
        p.para(body,M+102,y,CW-102,9.3,13)
        p.line(M,y+50,CW)
        y+=59
    p.notice('修正前 live audit（2026-09-11）：4 位 staff 只有 1 位有完整工時；未有成功外部匯入、Fresha URL 空白；salon 寄件 domain 未在當時 Resend team 驗證、Redis hostname DNS 失敗。呢啲要重驗，唔會因為 deploy 程式就自動完成。',625,76)
    p.entry('到店重驗結果／部署證據／仍阻擋接客嘅項目及負責人','analysis_live_recheck',M,717,CW,36)
    p.text('本機測試用虛構資料及模擬 provider，唔代表真實 salon 收件／平台訂閱或零撞期保證。',M,774,8.4,MUTED)

    p.page(16,'分析：系統邊界、配額與成本','網站可交換 busy time，但跨平台輪詢有延遲。店主要知道邊啲已實作、邊啲仍需正式平台資格及日常人工核對。','ANALYSIS / SYSTEM FLOW / NEON / COST')
    p.box(M+151,165,217,53,NAVY)
    p.text('Harbour Hair 網站',M+173,177,12,white)
    p.text('PENDING → 核對 → CONFIRMED',M+171,198,8.4,white)
    p.box(M,271,225,51,PALE,LINE)
    p.text('Treatwell 員工日曆',M+14,283,11,NAVY)
    p.text('實際匯入／匯出能力須本店核實',M+14,304,8.5,MUTED)
    p.box(W-M-225,271,225,51,PALE,LINE)
    p.text('Fresha 員工日曆',W-M-211,283,11,NAVY)
    p.text('官方 ICS 功能仍需逐方向驗收',W-M-211,304,8.5,MUTED)
    p.c.setStrokeColor(TEAL)
    p.c.setLineWidth(1.2)
    for x in [M+112.5,W-M-112.5]:
        p.c.line(W/2,H-223,x,H-262)
        # Arrowheads at each end indicate separately configured directions.
        for ax,ay,d in [(x,262,1),(W/2,223,-1)]:
            p.c.line(ax,H-ay,ax-3,H-ay+5*d)
            p.c.line(ax,H-ay,ax+3,H-ay+5*d)
    p.text('私密 ICS／busy time',M+35,237,8.2,TEAL)
    p.text('私密 ICS／busy time',W-M-166,237,8.2,TEAL)
    p.para('網站 outbound 只含網站預約，唔會轉發另一平台嘅匯入事件；上圖唔代表 Treatwell 同 Fresha 已互相同步。冇完整平台訂單／付款／退款 API，亦冇跨平台即時鎖位。',M,337,CW,9.8,15)
    p.section('Neon 用量唔需要去到 100% 先運作',399)
    p.para('100% 代表接近或耗盡方案配額，唔係網站 ready 指標。先睇真實方案、剩餘用量及告警；早前約 6.34 CU-hours，如配額係 100 CU-hours，即約 6.3%。以店主 dashboard 當日顯示為準。',M,425,CW,9.8,15)
    p.section('排程頻率影響 compute 用量',485)
    p.para('粗略比較：0.25 CU、每次喚醒後約 5 分鐘先休眠，每 30 分鐘一次、30 日約 30 CU-hours 起；每 5 分鐘令 compute 持續開啟，約 180 CU-hours／月。網站流量、平台訂閱請求、執行時間及其他工作會再增加用量；呢個係估算，唔係月費保證。',M,510,CW,9.8,15)
    p.section('6 小時 PITR 唔等於長期獨立備份',587)
    p.para('目前核對到嘅 6 小時還原窗口，要配合實際 plan 及可用還原點；唔應當作已建立長期 snapshots／獨立備份。訂明 RPO、RTO、保存期及告警，並喺安全副本真正 restore 一次（第 12 頁）。',M,612,CW,9.8,15)
    p.source('Fresha：Link your calendar（同步可能需最多 15 分鐘）','https://www.fresha.com/help-center/knowledge-base/calendar/101373-sync-your-fresha-calendar',673)
    p.source('Neon：官方 Free plan limits / quotas（實際帳戶方案為準）','https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md',691)
    p.source('Vercel：cron 管理；排程唔保證補跑或 exactly-once','https://vercel.com/docs/cron-jobs/manage-cron-jobs',709)
    p.source('Resend：idempotency key 保留 24 小時','https://resend.com/docs/dashboard/emails/idempotency-keys',727)
    p.entry('店主確認嘅方案／成本／同步限制及備份決定；更多分析見專案交接文件','analysis_owner_decisions',M,749,CW,16,8.6)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--metadata',type=Path,default=ROOT/'scripts/pdf/release-metadata.json')
    parser.add_argument('--font',type=Path,default=Path(os.environ.get('SALON_PDF_CJK_FONT','/System/Library/Fonts/STHeiti Light.ttc')))
    parser.add_argument('--output',type=Path,default=ROOT/'output/pdf/harbour-hair-salon-handover-fillable.pdf')
    args=parser.parse_args()
    if not args.font.is_file():
        raise SystemExit('Supply a complete CJK TrueType font using --font or SALON_PDF_CJK_FONT.')
    metadata=json.loads(args.metadata.read_text()) if args.metadata.exists() else {}
    pdfmetrics.registerFont(TTFont('CJK',str(args.font)))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temp=ROOT/'tmp/pdfs/harbour-hair-base.pdf'
    temp.parent.mkdir(parents=True,exist_ok=True)
    pack=Pack(temp,metadata)
    pages(pack)
    pack.finish()
    from unicode_forms import embed_form_font
    embed_form_font(temp,args.output,args.font)
    manifest={'pages':PAGES,'fields':FIELDS,'text_count':sum(f['type']=='text' for f in FIELDS),'checkbox_count':sum(f['type']=='checkbox' for f in FIELDS),'release_metadata':metadata}
    (ROOT/'tmp/pdfs/field-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print(json.dumps({'output':str(args.output),'pages':len(PAGES),'fields':len(FIELDS),'text':manifest['text_count'],'checkboxes':manifest['checkbox_count']}))

if __name__=='__main__':
    main()
