import type { Localized, Messages } from '../types';

const local: Localized<Messages['local']> = {
  meta: {
    title: '列斯市中心髮型屋｜Central Arcade',
    description: 'Harbour Hair Salon 位於列斯 Central Arcade 上層，Trinity Leeds 對面。香港培訓髮型師提供剪髮、染髮及電髮服務，可用廣東話或英語溝通。',
    ogTitle: 'Harbour Hair Salon｜列斯市中心髮型屋',
  },
  breadcrumb: { home: '主頁', local: '列斯市中心髮型屋' },
  links: { guide: '列斯市中心到訪指南', about: '認識我們的店舖' },
  hero: {
    eyebrow: 'Central Arcade · Leeds LS1 6DX',
    title: '列斯市中心，為你打理理想髮型。',
    intro: '香港培訓髮型師，於列斯市中心提供細緻剪髮、染髮、電髮及護理服務。你可以用廣東話或英語，輕鬆講出心目中的造型。',
    imageAlt: '列斯 Central Arcade 的 Harbour Hair Salon 店內髮型椅及發光鏡',
  },
  visit: {
    title: '我們就在 Central Arcade 裡面',
    arrival: 'Harbour Hair Salon 位於上層 Unit 15。Central Arcade 連接 Briggate 與 Central Road，就在 Trinity Leeds 的 Briggate 入口對面。',
    access: '店舖位於上層。如有出入或無障礙通道需要，請在到訪前致電，讓我們為你提供資料。',
    directions: '在 Google 地圖查看路線',
    contact: '聯絡方法及完整營業時間',
    hours: '營業時間',
    phone: '致電店舖',
  },
  nearby: {
    title: '逛市中心，也可以安排一個髮型預約',
    intro: '無論你正在列斯市中心購物，還是專程前來，以下地標都可以幫你找到 Central Arcade。',
    briggateTitle: 'Briggate 與 Trinity Leeds',
    briggate: 'Central Arcade 位於 Briggate，Trinity Leeds 對面。進入商場後，請前往上層 Unit 15；我們在 Central Arcade 裡面，並非 Trinity 商場內。',
    marketTitle: 'Central Road 與 Kirkgate Market',
    market: '商場另一邊通往 Central Road，鄰近 Vicar Lane 及 Leeds Kirkgate Market 一帶的市中心購物區。市集的主要入口位於 Vicar Lane。',
    cornTitle: 'Corn Exchange 與 Call Lane',
    corn: 'Leeds Corn Exchange 位於 Kirkgate 一帶的 Call Lane。如果你正在逛裡面的獨立商店，可以用我們的 Central Arcade 地址規劃接下來前往店舖的路線。',
  },
  expertise: {
    eyebrow: '香港培訓 · 細心溝通',
    title: '選擇適合你理想造型的髮型師。',
    body: '我們的香港培訓團隊歡迎不同背景的客人。無論用廣東話或英語，都可以告訴我們你的髮質、日常打理習慣及期望效果。帶一張參考照片，也能幫助我們了解你的想法。',
    cutsTitle: '剪髮及造型',
    cuts: '查看洗剪吹等選項，按你的髮長及預約需要選擇合適服務。',
    colourTitle: '染髮及挑染',
    colour: '查看全頭染髮、挑染及 Balayage 服務。如不確定應選哪項染髮服務，或是否需要皮膚測試，請先聯絡我們。',
    permsTitle: '電髮及護理',
    perms: '查看電髮、順滑及修護服務。改變造型前，可以先與團隊討論你的染燙紀錄及服務是否適合。',
    services: '查看服務及價錢',
    stylists: '認識髮型師',
    about: '認識我們的店舖',
  },
  booking: {
    title: '找到我們了？現在選擇預約。',
    body: '透過預約選項選擇服務及時間。如想先了解哪項服務適合你，歡迎直接致電店舖。',
    button: '查看預約方法',
    call: '致電 {phone}',
  },
};

export default local;
