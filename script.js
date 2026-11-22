const toast = document.querySelector('#toast');
const searchInput = document.querySelector('#search-input');
const categorySelect = document.querySelector('#category-select');
const lostList = document.querySelector('#lost-list');
const emptyState = document.querySelector('#empty-state');
const itemCount = document.querySelector('#item-count');
const searchResultCount = document.querySelector('#search-result-count');
const RETENTION_MONTHS = 6;
let lostItems = [...document.querySelectorAll('.lost-item')];
let baseOrder = [...lostItems];
let toastTimer;
const fallbackStorageLocations = {
  '黑色無線耳機': '學務處失物招領室', '深藍色折傘': '學務處失物招領室', '學生證一張': '學務處失物招領室', '透明筆袋': '學務處失物招領室',
  '銀色隨身碟': '電算中心服務櫃台', '白色充電線': '學務處失物招領室', '灰色筆電包': '圖書館服務台', '粉色保溫瓶': '女宿管理室',
  '米白色圍巾': '學務處失物招領室', '黑色棒球帽': '體育室服務台', '鑰匙一串': '學務處失物招領室', '棕色短夾': '學務處失物招領室',
  '悠遊卡一張': '校安中心', '校園卡套': '活動中心服務台', '藍色原子筆組': '圖書館服務台', '科學計算機': '工程館系辦',
  '透明雨衣': '體育室服務台', '運動水壺': '健身房櫃台', '白色資料夾': '學務處失物招領室', '黑色眼鏡盒': '校門口警衛室'
};
const fallbackDetails = {
  '黑色無線耳機': '充電盒上有一個白色星星貼紙', '深藍色折傘': '傘柄掛著一個小雲朵吊飾', '學生證一張': '姓名：王○明', '透明筆袋': '透明筆袋內有一支藍色原子筆',
  '銀色隨身碟': '外殼有銀色刮痕', '白色充電線': '接頭處有白色膠帶標記', '灰色筆電包': '包面右下角有灰色布標', '粉色保溫瓶': '瓶身有白色貼紙',
  '米白色圍巾': '圍巾末端有細條紋', '黑色棒球帽': '帽沿內側有白色字樣', '鑰匙一串': '鑰匙圈是藍色圓環', '棕色短夾': '皮夾外側有縫線裝飾',
  '悠遊卡一張': '姓名：已隱藏', '校園卡套': '姓名：已隱藏', '藍色原子筆組': '筆身有藍色筆蓋', '科學計算機': '外殼右上角有刮痕',
  '透明雨衣': '雨衣收納袋為透明色', '運動水壺': '瓶蓋為黑色，瓶身有刻度', '白色資料夾': '封面右上角有藍色貼紙', '黑色眼鏡盒': '盒面有細長白色標記'
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

document.querySelectorAll('[data-toast]').forEach((element) => {
  element.addEventListener('click', () => showToast(element.dataset.toast));
});

function bindDetailButtons() {
  document.querySelectorAll('.detail-button').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.lost-item');
      const image = card?.querySelector('.item-thumb img');
      if (!image) return showToast(`「${button.dataset.item}」目前沒有照片`);
      let details = card.querySelector('.inline-details');
      if (!details) {
        details = document.createElement('div');
        details.className = 'inline-details';
        details.hidden = true;
        const inputId = `verification-input-${Date.now()}`;
        const verificationMarkup = card.dataset.document === 'true'
          ? `<div class="verification-box"><div class="verification-heading"><strong>核對是不是你的證件</strong><span>AI 辨識遮罩</span></div><p>${escapeHtml(card.dataset.verificationPrompt || '請輸入姓名、學號或證件上其他可核對本人身分的資訊')}</p><form class="verification-form"><label class="sr-only" for="${inputId}">核對資訊</label><input id="${inputId}" type="text" placeholder="輸入姓名、學號或可核對資訊" autocomplete="off" /><button type="submit">送出核對</button></form><div class="verification-feedback" role="status" hidden></div></div>`
          : '';
        details.innerHTML = `<img src="${escapeHtml(image.currentSrc || image.src)}" alt="${escapeHtml(image.alt)}" /><div><p><strong>現在保管</strong>${escapeHtml(card.dataset.storage || '學務處失物招領室')}</p><p><strong>物品特徵</strong>${escapeHtml(card.dataset.details || '無補充資訊')}</p>${verificationMarkup}</div>`;
        card.append(details);
        const verificationForm = details.querySelector('.verification-form');
        if (verificationForm) {
          verificationForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const input = verificationForm.querySelector('input');
            const feedback = verificationForm.parentElement.querySelector('.verification-feedback');
            const submitButton = verificationForm.querySelector('button');
            if (!input.value.trim()) {
              feedback.textContent = '請輸入可用於核對身分的資訊。';
              feedback.hidden = false;
              feedback.className = 'verification-feedback is-error';
              return;
            }
            feedback.textContent = 'AI 正在辨識證件並核對資料…';
            feedback.hidden = false;
            feedback.className = 'verification-feedback is-pending';
            submitButton.disabled = true;
            submitButton.textContent = '核對中…';

            try {
              const response = await fetch('/api/verify-identity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  claim: input.value.trim(),
                  image_url: image.currentSrc || image.src,
                  item_name: button.dataset.item
                })
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'AI 核對服務暫時無法使用。');

              if (result.requires_manual_review) {
                feedback.textContent = `AI 判定：需要人工確認。${result.safe_reason || ''}`;
                feedback.className = 'verification-feedback is-warning';
              } else if (result.is_match) {
                feedback.textContent = `AI 判定：符合你的證件。${result.safe_reason || ''}`;
                feedback.className = 'verification-feedback is-success';
              } else {
                feedback.textContent = `AI 判定：不是你的證件。${result.safe_reason || ''}`;
                feedback.className = 'verification-feedback is-error';
              }
            } catch (error) {
              feedback.textContent = `無法完成 AI 核對：${error.message}。請確認已用 node server.js 啟動網站。`;
              feedback.className = 'verification-feedback is-error';
            } finally {
              submitButton.disabled = false;
              submitButton.textContent = '送出核對';
              input.value = '';
            }
          });
        }
      }
      const isOpen = !details.hidden;
      details.hidden = isOpen;
      card.classList.toggle('details-open', !isOpen);
      button.innerHTML = isOpen ? '查看詳情 <span>→</span>' : '收合詳情 <span>↑</span>';
    });
  });
}

function filterItems() {
  const keyword = searchInput.value.trim().toLowerCase();
  const category = categorySelect.value;
  let visibleCount = 0;
  const shouldPrioritize = keyword || category !== 'all';
  const orderedItems = shouldPrioritize
    ? [...baseOrder].sort((first, second) => {
      const firstKeywordMatch = keyword && first.dataset.search.toLowerCase().includes(keyword);
      const secondKeywordMatch = keyword && second.dataset.search.toLowerCase().includes(keyword);
      const firstCategoryMatch = category !== 'all' && first.dataset.category === category;
      const secondCategoryMatch = category !== 'all' && second.dataset.category === category;
      const firstPriority = Number(firstKeywordMatch) * 2 + Number(firstCategoryMatch);
      const secondPriority = Number(secondKeywordMatch) * 2 + Number(secondCategoryMatch);
      return secondPriority - firstPriority;
    })
    : [...baseOrder];

  orderedItems.forEach((item) => lostList.appendChild(item));
  lostItems = orderedItems;

  lostItems.forEach((item) => {
    const matchesKeyword = item.dataset.search.toLowerCase().includes(keyword);
    const matchesCategory = category === 'all' || item.dataset.category === category;
    const isVisible = matchesKeyword && matchesCategory;
    item.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  emptyState.hidden = visibleCount !== 0;
  searchResultCount.textContent = keyword ? `找到 ${visibleCount} 筆符合結果` : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

function getCategory(item) {
  const text = `${item.item} ${item.keywords}`;
  if (text.includes('3C')) return '3C';
  if (text.includes('衣物')) return '衣物';
  if (text.includes('證件') || text.includes('卡片')) return '證件';
  if (text.includes('文具')) return '文具';
  return '生活';
}

function isDocument(item) {
  return getCategory(item) === '證件' || item.verification_required === true;
}

function getTagClass(category) {
  return ({
    '3C': 'tag-blue',
    '生活': 'tag-green',
    '證件': 'tag-purple',
    '文具': 'tag-orange',
    '衣物': 'tag-orange'
  })[category] || 'tag-green';
}

function getCategoryLabel(category) {
  return ({
    '3C': '3C 用品',
    '生活': '生活用品',
    '證件': '證件／卡片',
    '文具': '文具用品',
    '衣物': '衣物用品'
  })[category] || '生活用品';
}

function getSafeDetails(item) {
  const details = String(item.details || '').trim();
  if (getCategory(item) !== '證件') return details || '無補充資訊';
  const safeFields = details.match(/(?:姓名|學號)\s*[:：]\s*[^，,；;。]+/g) || [];
  return safeFields.length ? safeFields.join('、') : '姓名或學號已隱藏';
}

function parseFoundDate(value) {
  const normalized = String(value ?? '').replace(' ', 'T');
  return new Date(normalized);
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function cleanExpiredItems(items, now = new Date()) {
  return items.filter((item) => {
    const foundDate = parseFoundDate(item.date);
    if (Number.isNaN(foundDate.getTime())) return true;
    return addMonths(foundDate, RETENTION_MONTHS) >= now;
  });
}

function renderDatabaseItems(items) {
  const foundItems = items.filter((item) => item.type === 'found');
  lostList.innerHTML = foundItems.map((item) => {
    const category = getCategory(item);
    const searchText = `${item.item} ${item.keywords} ${item.location} ${item.date}`;
    const storageLocation = item.storage_location || '學務處失物招領室';
    const details = getSafeDetails(item);
    const documentItem = isDocument(item);
    const verificationPrompt = item.verification_prompt || '請輸入姓名、學號或證件上其他可核對本人身分的資訊';
    return `<article class="lost-item" data-category="${escapeHtml(category)}" data-storage="${escapeHtml(storageLocation)}" data-details="${escapeHtml(details)}" data-document="${documentItem}" data-verification-prompt="${escapeHtml(verificationPrompt)}" data-search="${escapeHtml(searchText)}">
      <div class="item-thumb"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.item)}照片" /></div>
      <div class="item-info"><div class="item-tags"><span class="tag ${getTagClass(category)}">${getCategoryLabel(category)}</span><span class="item-time"><b>拾獲時間</b> ${escapeHtml(item.date)}</span></div><h3>${escapeHtml(item.item)}</h3><p class="item-location"><strong>拾獲地點</strong>${escapeHtml(item.location)}</p></div>
      <button class="detail-button" type="button" data-item="${escapeHtml(item.item)}">查看詳情 <span>→</span></button>
    </article>`;
  }).join('');

  itemCount.textContent = `共 ${foundItems.length} 件物品`;
  lostItems = [...document.querySelectorAll('.lost-item')];
  baseOrder = [...lostItems];
  bindDetailButtons();
  filterItems();
}

function enrichFallbackItems() {
  document.querySelectorAll('.lost-item').forEach((card) => {
    const info = card.querySelector('.item-info');
    const time = card.querySelector('.item-time');
    const location = info?.querySelector('p');
    if (!info || !time || !location || info.dataset.enriched) return;

    const foundTime = time.textContent.trim();
    const foundLocation = location.textContent.replace(/^地點：/, '').trim();
    const itemName = info.querySelector('h3')?.textContent.trim();
    const storageLocation = card.dataset.storage || fallbackStorageLocations[itemName] || '學務處失物招領室';
    card.dataset.details = fallbackDetails[itemName] || '無補充資訊';
    card.dataset.document = card.dataset.category === '證件' ? 'true' : 'false';
    card.dataset.verificationPrompt = '請輸入姓名、學號或證件上其他可核對本人身分的資訊';
    card.dataset.storage = storageLocation;
    time.innerHTML = `<b>拾獲時間</b> ${escapeHtml(foundTime)}`;
    location.outerHTML = `<p class="item-location"><strong>拾獲地點</strong>${escapeHtml(foundLocation)}</p>`;
    card.querySelector('.item-status')?.remove();
    info.dataset.enriched = 'true';
  });
  lostItems = [...document.querySelectorAll('.lost-item')];
  baseOrder = [...lostItems];
}

async function loadLostItemDatabase() {
  try {
    if (window.location.protocol === 'file:' && Array.isArray(window.lostItemDatabase)) {
      renderDatabaseItems(cleanExpiredItems(window.lostItemDatabase));
      return;
    }
    const apiResponse = await fetch('/api/lost-items', { cache: 'no-store' });
    if (apiResponse.ok) {
      const payload = await apiResponse.json();
      renderDatabaseItems(payload.items || []);
      return;
    }
    const response = await fetch('./遺失物清單.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Database request failed: ${response.status}`);
    const items = await response.json();
    renderDatabaseItems(cleanExpiredItems(items));
  } catch (error) {
    if (Array.isArray(window.lostItemDatabase)) {
      renderDatabaseItems(cleanExpiredItems(window.lostItemDatabase));
      return;
    }
    // 直接以 file:// 開啟時，瀏覽器可能禁止 fetch；保留 HTML 內的備援資料。
    console.info('遺失物清單資料庫尚未載入，使用頁面備援資料。', error);
    enrichFallbackItems();
    bindDetailButtons();
    filterItems();
  }
}

searchInput.addEventListener('input', filterItems);
categorySelect.addEventListener('change', filterItems);
document.querySelector('#filter-button').addEventListener('click', () => {
  categorySelect.focus();
  showToast('請選擇想查看的物品類別');
});

loadLostItemDatabase();
