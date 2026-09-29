/** The standalone file follows its explicit language query; no browser/cookie preference overrides it. */
export function parseLocale(search = '') {
  const parameters = new URLSearchParams(search);
  const requested = [...parameters].find(([key]) => key.toLowerCase() === 'lang')?.[1];
  return /^zh(?:-|$)/i.test((requested || '').trim().replaceAll('_', '-')) ? 'zh-HK' : 'en-GB';
}

export const locale = parseLocale(globalThis.location?.search || '');

// Exact English copy is the key, shared by static markup and dynamic renderer/interface messages.
export const messages = Object.freeze({
  'Step inside a miniature Harbour Hair. Explore a photo-inspired 3D salon, walk inside, and change the light.': '走進迷你 Harbour Hair，探索以實景照片為參考的 3D 髮廊，親身漫遊並調整光線。',
  'Harbour Hair — A little world of good hair': 'Harbour Hair — 迷你髮型世界',
  'Harbour Hair interactive 3D salon tour': 'Harbour Hair 互動 3D 髮廊導覽',
  'Interactive 3D model of Harbour Hair salon. Drag to rotate, scroll to zoom. Choose Walk inside to explore from eye level.': 'Harbour Hair 髮廊互動 3D 模型。拖曳可旋轉，滾動可縮放。選擇「步行導覽」，以第一身視角探索。',
  'Salon room labels': '髮廊區域標籤',
  'Leeds, in miniature': '迷你列斯',
  'Choose viewing mode': '選擇瀏覽模式',
  'Dollhouse': '立體模型',
  'Model': '模型',
  'Walk inside': '步行導覽',
  'Walk': '步行',
  'Floor plan': '平面圖',
  'Plan': '平面',
  'Clean model view': '只顯示模型',
  'Hide viewing controls and labels': '隱藏瀏覽控制項及標籤',
  'Show viewing controls and labels': '顯示瀏覽控制項及標籤',
  'Reset the view and lighting': '重設視角與光線',
  'Save a PNG image of this view': '將目前視角儲存為 PNG 圖片',
  'Save this view': '儲存此視角',
  'View settings': '瀏覽設定',
  'View': '設定',
  'About the salon tour': '關於髮廊導覽',
  'A little world of good hair': '迷你髮型世界',
  'Make yourself': '放鬆一下，',
  'at home.': '自在如家。',
  'Step into Harbour Hair. Explore the salon up close and choose your favourite light.': '走進 Harbour Hair，近距離探索髮廊的每個角落，選擇你喜歡的光線。',
  'Lighting and salon references': '光線設定與髮廊參考照片',
  'Set the atmosphere': '營造氣氛',
  'Lighting presets': '預設光線',
  'Daylight': '日光',
  'Fresh & natural': '清新自然',
  'Golden hour': '黃昏金光',
  'A warm little glow': '溫暖柔和',
  'After hours': '夜間',
  'Lights on, world off': '亮起燈光，享受寧靜',
  'Light level': '光線強度',
  'Open real salon reference photos': '開啟髮廊實景參考照片',
  'A photograph of Harbour Hair salon used as a design reference': '用作設計參考的 Harbour Hair 髮廊實景照片',
  'Real salon': '實景照片',
  'A familiar place, reimagined.': '熟悉的髮廊，全新的視角。',
  'Inspired by photographs of our salon in Central Arcade, Leeds.': '以我們位於列斯 Central Arcade 的髮廊照片為參考。',
  'View salon photos': '查看髮廊照片',
  'Drag to orbit': '拖曳旋轉',
  'Scroll to zoom': '滾動縮放',
  'WASD / arrows to walk · Drag to look': 'WASD／方向鍵移動 · 拖曳環視',
  'Drag to move · Scroll to zoom': '拖曳移動 · 滾動縮放',
  'Drag to orbit · Scroll to zoom': '拖曳旋轉 · 滾動縮放',
  'Walk inside Harbour Hair. Use W A S D or arrow keys to move and drag to look around.': '在 Harbour Hair 內步行探索。使用 W A S D 或方向鍵移動，拖曳可環視四周。',
  'Overhead floor plan of Harbour Hair. Drag to move and scroll to zoom.': 'Harbour Hair 俯視平面圖。拖曳可移動，滾動可縮放。',
  'Interactive 3D model of Harbour Hair salon. Drag to rotate and scroll to zoom.': 'Harbour Hair 髮廊互動 3D 模型。拖曳可旋轉，滾動可縮放。',
  'Take a little tour': '來一趟小導覽',
  'Pause the tour': '暫停導覽',
  'Explore salon areas': '探索髮廊區域',
  'Welcome': '歡迎光臨',
  'Welcome in': '歡迎光臨',
  'Styling floor': '髮型設計',
  'The styling floor': '髮型設計區',
  'Styling': '造型',
  'Wash & unwind': '洗髮放鬆',
  'Wash': '洗髮',
  'Colour corner': '染髮天地',
  'Colour': '染髮',
  'Visit': '前往',
  'Walk movement controls': '步行移動控制',
  'Walk forward': '向前走',
  'Walk left': '向左走',
  'Walk backward': '向後走',
  'Walk right': '向右走',
  'Photo-inspired concept': '以實景照片為參考',
  'Approximate layout, not a measured plan': '佈局為概略示意，並非實測平面圖',
  'A little world is taking shape.': '迷你世界正在成形。',
  'Opening Harbour Hair': '正在開啟 Harbour Hair',
  'The 3D view couldn’t open.': '無法開啟 3D 視圖。',
  'Open this file in a current browser with hardware acceleration enabled, then reload.': '請使用新版瀏覽器開啟此檔案，啟用硬件加速後重新載入。',
  'The 3D graphics context was interrupted. Reload this file to reopen the studio.': '3D 圖像顯示已中斷。請重新載入此檔案以再次開啟導覽。',
  'This browser could not start the 3D view. Open this HTML in a recent Chrome, Edge, Safari or Firefox with WebGL enabled. The real salon photos are still available.': '此瀏覽器無法啟動 3D 視圖。請使用已啟用 WebGL 的新版 Chrome、Edge、Safari 或 Firefox 開啟此 HTML 檔案。你仍可查看髮廊實景照片。',
  'Try again': '重試',
  'See salon photos': '查看髮廊照片',
  'View and lighting reset.': '視角與光線已重設。',
  'Close view settings': '關閉瀏覽設定',
  'Save a PNG of this view': '將此視角儲存為 PNG',
  'The real Harbour Hair': '真實的 Harbour Hair',
  'The photographs behind this little world.': '這個迷你世界的實景參考照片。',
  'Close salon photos': '關閉髮廊照片',
  "Harbour Hair is at Unit 15, Central Arcade, Leeds LS1 6DX. This model follows salon photographs and the owner's layout corrections: a recessed glass entrance with chrome hardware and rectangular privacy panels, pale fluted reception with a wooden sign, a six-panel white toilet door, and an oak-topped washing counter with a steel sink and upper storage. Three compact shampoo couches sit behind the divider, followed by open colour shelves. The side passage has two steps up to styling, with a circular coat rack beside the glass return near the entrance. Dimensions and areas not shown in the photos remain approximate.": 'Harbour Hair 位於 Unit 15, Central Arcade, Leeds LS1 6DX。此模型以髮廊照片及店主的佈局修正為依據：內凹的玻璃入口配有鍍鉻五金及長方形私隱玻璃面板、淺色直紋接待櫃檯配木製店牌、六格白色洗手間門，以及配有鋼製洗滌盆和上方收納櫃的橡木檯面洗滌櫃。隔板後方設有三張精巧的洗髮躺椅，再往後是開放式染髮用品層架。側邊通道有兩級台階通往造型區，入口附近的玻璃轉角旁設有圓形衣帽架。尺寸及照片未涵蓋的區域仍為概略示意。',
  'Explore the salon in daylight, golden hour or after hours with the lighting controls.': '使用光線控制項，體驗髮廊在日光、黃昏金光或夜間的不同氣氛。',
  'The styling floor · Halo mirrors & hydraulic chairs': '造型區 · 環形燈鏡與油壓理髮椅',
  'Reception · Charcoal slats & the wooden salon sign': '接待區 · 炭灰色條板與木製店牌',
  'Wash & treatment · Twin basins and the calligraphy wall': '洗髮與護理 · 雙洗髮盆及書法牆',
  'Styling stations · Illuminated round mirrors': '造型工作位 · 發光圓鏡',
  'Natural light · The window and professional machines': '自然光 · 窗戶與專業設備',
  'Colour & care · Product shelves and rolled towels': '染髮與護理 · 產品層架及捲毛巾',
  'The little details · Precision styling tools': '細節之美 · 專業造型工具',
  'Sources:': '資料來源：',
  'Harbour Hair website': 'Harbour Hair 官方網站',
  'Harbour Hair on Treatwell': 'Treatwell 上的 Harbour Hair',
  'Salon imagery belongs to its respective owners. This is an interior concept, not an architectural survey.': '髮廊照片版權屬各自擁有人所有。本模型為室內概念示意，並非建築測量成果。',
  'Your studio view': '你的髮廊視角',
  'Close image preview': '關閉圖片預覽',
  'Your current Harbour Hair 3D salon view': '你目前的 Harbour Hair 髮廊 3D 視角',
  'Download PNG': '下載 PNG',
  'You can also right-click or hold the image to save it.': '你也可以按滑鼠右鍵或長按圖片儲存。',
});

export function t(english, language = locale) {
  return language === 'zh-HK' && Object.hasOwn(messages, english) ? messages[english] : english;
}

/** Translate exact text nodes/reader-facing attributes, preserving markup, URLs, IDs and branding. */
export function initI18n(doc = globalThis.document, language = locale) {
  if (!doc?.documentElement) return;
  doc.documentElement.lang = language;
  const walker = doc.createTreeWalker(doc.documentElement, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script,style,noscript,[translate="no"]')) continue;
    const source = node.nodeValue.trim();
    const translated = t(source, language);
    if (translated !== source) node.nodeValue = node.nodeValue.replace(source, translated);
  }
  for (const element of doc.querySelectorAll('[aria-label],[title],[alt],[placeholder],meta[name="description"]')) {
    if (element.closest('[translate="no"]')) continue;
    for (const attribute of ['aria-label', 'title', 'alt', 'placeholder', 'content']) {
      const source = element.getAttribute(attribute);
      if (source !== null) element.setAttribute(attribute, t(source, language));
    }
  }
  for (const secondary of doc.querySelectorAll('[data-i18n-secondary]')) {
    secondary.classList.toggle('hidden', language === 'zh-HK');
  }
}
