'use strict';

// ============================================================
// 9. MARKET LEDGER SHOPPING LISTS & KROGER API INTEGRATION
// ============================================================

const krogerState = {
  loaded: false,
  configured: false,
  fromEnv: false,
  env: 'prod',
  connected: false,
  store: null,
  redirectUri: '',
  // Transient UI state for open Market Ledger
  leftTab: 'search', // 'search' | 'url'
  quickMode: 'search', // 'search' | 'recent' | 'favorites' | 'on_sale'
  mobileTab: 'list', // 'list' | 'search'
  searchQuery: '',
  stockFilter: 'all', // 'all' | 'in_stock' | 'on_sale'
  searchLoading: false,
  searchError: '',
  searchResults: [],
  dealsLoading: false,
  dealsError: '',
  dealsResults: [],
  favorites: [],
  favoritesRefreshing: false,
  recentSearches: [],
  urlInput: '',
  urlLoading: false,
  urlError: '',
  urlResult: null,
  refreshing: false,
  syncingCart: false,
  // Quick toolbar drawer selection
  drawerBookId: null
};

async function fetchKrogerStatus(silent = true) {
  try {
    const resp = await fetch('/api/kroger/status', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    krogerState.loaded = true;
    krogerState.configured = Boolean(data.configured);
    krogerState.fromEnv = Boolean(data.fromEnv);
    krogerState.env = data.env || 'prod';
    krogerState.connected = Boolean(data.connected);
    krogerState.store = data.store || null;
    krogerState.redirectUri = data.redirectUri || `${window.location.origin}/api/kroger/auth/callback`;
    if (Array.isArray(data.favorites)) krogerState.favorites = data.favorites;
    if (Array.isArray(data.recentSearches)) krogerState.recentSearches = data.recentSearches;
    updateGlobalMarketMenuUI();
    if (openBookState.bookId) {
      const container = findOpenBookContainer(openBookState.hallId, openBookState.bookId);
      if (container && isMarketLedger(container.book)) {
        renderOpenBook(false);
      }
    }
  } catch (err) {
    if (!silent) showToast('Could not reach Kroger status endpoint');
  }
}

function getAllMarketLedgers() {
  const entries = [];
  if (typeof getAllBooksFlat === 'function') {
    for (const e of getAllBooksFlat()) {
      if (isMarketLedger(e.book)) entries.push(e);
    }
  }
  return entries;
}

function getActiveMarketList(ledger) {
  if (!ledger || !Array.isArray(ledger.lists) || ledger.lists.length === 0) return null;
  return ledger.lists.find(l => l.id === ledger.activeListId) || ledger.lists[0];
}

function computeMarketListStats(list) {
  let total = 0;
  let savings = 0;
  let totalQty = 0;
  let checkedRows = 0;
  let uncheckedKroger = 0;
  const items = list?.items || [];
  for (const it of items) {
    const q = Math.max(1, Number(it.qty) || 1);
    totalQty += q;
    if (it.checked) checkedRows += 1;
    else if (it.upc || it.productId) uncheckedKroger += 1;
    const unit = (typeof it.promo === 'number' && it.promo > 0)
      ? it.promo
      : ((typeof it.price === 'number' && it.price > 0) ? it.price : null);
    if (unit !== null) {
      total += unit * q;
      if (typeof it.promo === 'number' && typeof it.price === 'number' && it.price > it.promo) {
        savings += (it.price - it.promo) * q;
      }
    }
  }
  return {
    total,
    savings,
    totalQty,
    checkedRows,
    uncheckedRows: items.length - checkedRows,
    uncheckedKroger,
    rows: items.length
  };
}

function marketStockBadgeHtml(stockLevel) {
  if (stockLevel === 'HIGH') {
    return `<span class="market-stock-high inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold">&#9679; In Stock</span>`;
  }
  if (stockLevel === 'LOW') {
    return `<span class="market-stock-low inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold">&#9680; Low Stock</span>`;
  }
  if (stockLevel === 'TEMPORARILY_OUT_OF_STOCK') {
    return `<span class="market-stock-out inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold">&times; Out of Stock</span>`;
  }
  return `<span class="market-stock-unk inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">Stock N/A</span>`;
}

function addKrogerProductToBook(book, prod) {
  if (!book || !book.marketLedger || !prod) return;
  const list = getActiveMarketList(book.marketLedger);
  if (!list) return;
  const key = prod.upc || prod.productId;
  const existing = key ? list.items.find(i => (i.upc && i.upc === key) || (i.productId && i.productId === key)) : null;
  if (existing) {
    existing.qty = Math.min(99, (existing.qty || 1) + 1);
    existing.checked = false;
    existing.price = prod.price;
    existing.promo = prod.promo;
    existing.stockLevel = prod.stockLevel || existing.stockLevel;
    existing.aisle = prod.aisle || existing.aisle;
    existing.imageUrl = prod.imageUrl || existing.imageUrl;
    existing.updatedAt = new Date().toISOString();
    showToast(`Increased ${prod.name} to ${existing.qty}`);
  } else {
    list.items.push({
      id: uid('mi'),
      name: prod.name || 'Unnamed Product',
      brand: prod.brand || '',
      size: prod.size || '',
      qty: 1,
      checked: false,
      note: '',
      upc: prod.upc || prod.productId || '',
      productId: prod.productId || prod.upc || '',
      price: typeof prod.price === 'number' ? prod.price : null,
      promo: typeof prod.promo === 'number' ? prod.promo : null,
      stockLevel: prod.stockLevel || 'UNKNOWN',
      aisle: prod.aisle || 'Grocery',
      imageUrl: prod.imageUrl || '',
      url: prod.url || '',
      updatedAt: new Date().toISOString()
    });
    const eff = prod.promo ?? prod.price;
    showToast(`Added ${prod.name}${eff ? ` ($${eff.toFixed(2)})` : ''}`);
  }
  playCozySound?.('paper');
  commitChange();
}

function isKrogerFavorite(upcOrId) {
  if (!upcOrId) return false;
  return krogerState.favorites.some(f => f.upc === upcOrId || f.productId === upcOrId);
}

async function toggleKrogerFavorite(prod) {
  if (!prod) return;
  try {
    const resp = await fetch('/api/kroger/favorites/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: prod })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Could not update favorites');
    if (Array.isArray(data.favorites)) krogerState.favorites = data.favorites;
    showToast(data.isFavorite ? `Saved "${prod.name}" to Favorites` : `Removed "${prod.name}" from Favorites`);
    renderOpenBook(false);
  } catch (err) {
    showToast(err.message || 'Could not update favorites');
  }
}

async function refreshKrogerFavorites() {
  if (krogerState.favoritesRefreshing || krogerState.favorites.length === 0) return;
  if (!krogerState.configured) { openKrogerSettingsModal(); return; }
  krogerState.favoritesRefreshing = true;
  renderOpenBook(false);
  try {
    const upcs = krogerState.favorites.map(f => f.upc || f.productId).filter(Boolean);
    const resp = await fetch('/api/kroger/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upcs, locationId: krogerState.store?.locationId || '' })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Refresh failed');
    const map = data.products || {};
    krogerState.favorites = krogerState.favorites.map(f => {
      const fresh = map[f.upc] || map[f.productId];
      return fresh ? { ...f, ...fresh } : f;
    });
    showToast('Refreshed live prices & stock for your Favorites!');
  } catch (err) {
    showToast(err.message || 'Could not refresh favorites');
  } finally {
    krogerState.favoritesRefreshing = false;
    renderOpenBook(false);
  }
}

async function loadKrogerDeals(term = '') {
  if (!krogerState.configured) {
    krogerState.dealsError = 'Set up your Kroger API credentials in Kroger Settings to browse live store deals.';
    krogerState.dealsResults = [];
    renderOpenBook(false);
    return;
  }
  krogerState.dealsLoading = true;
  krogerState.dealsError = '';
  renderOpenBook(false);
  try {
    const loc = krogerState.store?.locationId || '';
    const qs = new URLSearchParams();
    if (loc) qs.set('locationId', loc);
    if ((term || '').trim().length >= 2) qs.set('term', term.trim());
    const resp = await fetch(`/api/kroger/deals?${qs.toString()}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Could not load sale items');
    krogerState.dealsResults = Array.isArray(data.deals) ? data.deals : [];
  } catch (err) {
    krogerState.dealsError = err.message || 'Could not load sale items';
    krogerState.dealsResults = [];
  } finally {
    krogerState.dealsLoading = false;
    renderOpenBook(false);
  }
}

async function clearKrogerRecentSearches() {
  try {
    const resp = await fetch('/api/kroger/recent/clear', { method: 'POST' });
    const data = await resp.json();
    if (resp.ok && Array.isArray(data.recentSearches)) {
      krogerState.recentSearches = data.recentSearches;
    } else {
      krogerState.recentSearches = [];
    }
    showToast('Cleared recent searches');
    renderOpenBook(false);
  } catch (err) {
    showToast('Could not clear recent searches');
  }
}

function renderKrogerProductCardHtml(prod, activeList) {
  const key = prod.upc || prod.productId;
  const existing = key && activeList
    ? activeList.items.find(i => (i.upc && i.upc === key) || (i.productId && i.productId === key))
    : null;
  const isFav = isKrogerFavorite(key);
  const hasPromo = typeof prod.promo === 'number' && typeof prod.price === 'number' && prod.promo < prod.price;
  const saveAmt = hasPromo ? (prod.price - prod.promo) : 0;
  const priceDisplay = hasPromo
    ? `<div class="font-storybook font-bold text-sm tabular-nums" style="color:#b54534;">$${prod.promo.toFixed(2)}</div>
       <div class="text-[10.5px] line-through tabular-nums" style="color:#7a5c44;">$${prod.price.toFixed(2)}</div>`
    : (typeof prod.price === 'number'
      ? `<div class="font-storybook font-bold text-sm tabular-nums" style="color:#2d1a0f;">$${prod.price.toFixed(2)}</div>`
      : `<div class="text-[11px] font-semibold" style="color:#7a5c44;">Price N/A</div>`);

  return `
    <div class="rounded-2xl p-2.5 flex items-center gap-2.5" style="background:#fffdf8; border:1.5px solid #d7c3a1;">
      <div class="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0" style="background:#f5ebd7; border:1px solid #d7c3a1;">
        ${prod.imageUrl
          ? `<img src="${esc(prod.imageUrl)}" alt="" class="w-full h-full object-contain p-0.5 bg-white" loading="lazy" />`
          : `<span class="text-lg" aria-hidden="true">&#128722;</span>`}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1 text-[10.5px] truncate" style="color:#7a5c44;">
          ${prod.brand ? `<span class="font-semibold">${esc(prod.brand)}</span>` : ''}
          ${prod.brand && prod.size ? `<span>&middot;</span>` : ''}
          ${prod.size ? `<span>${esc(prod.size)}</span>` : ''}
        </div>
        <div class="font-storybook font-bold text-xs leading-snug line-clamp-2" style="color:#2d1a0f;" title="${esc(prod.name)}">${esc(prod.name)}</div>
        <div class="flex flex-wrap items-center gap-1 mt-1">
          ${marketStockBadgeHtml(prod.stockLevel)}
          ${hasPromo ? `<span class="text-[10px] font-bold px-1.5 py-0.2 rounded-full" style="background:#fbe3df; color:#a33728;">Save $${saveAmt.toFixed(2)}</span>` : ''}
          ${prod.aisle ? `<span class="text-[10px] px-1.5 py-0.2 rounded-md truncate max-w-[130px]" style="background:#f3e8d2; color:#5e4430;">${esc(prod.aisle)}</span>` : ''}
        </div>
      </div>
      <div class="text-right shrink-0 flex flex-col items-end gap-1.5">
        <div class="flex items-start gap-1.5">
          <div>${priceDisplay}</div>
          <button type="button" data-market-fav-upc="${esc(key)}" title="${isFav ? 'Remove from Favorites' : 'Save to Favorites'}"
            class="w-6 h-6 rounded-lg flex items-center justify-center text-sm leading-none cursor-pointer bg-transparent border-0 transition-transform hover:scale-110"
            style="color:${isFav ? '#d69e42' : '#b59d82'};">
            ${isFav ? '&#9733;' : '&#9734;'}
          </button>
        </div>
        <button type="button" data-market-add-upc="${esc(key)}"
          class="rounded-xl px-2.5 py-1 text-[11px] font-bold cursor-pointer transition-transform hover:scale-105"
          style="background:${existing ? '#4f7c54' : '#c96843'}; color:#fffaf2; border:1.5px solid #3c2516;">
          ${existing ? `In List (${existing.qty}) +` : '+ Add'}
        </button>
      </div>
    </div>
  `;
}

async function runKrogerSearch(term) {
  const clean = (term || '').trim();
  krogerState.searchQuery = clean;
  krogerState.quickMode = 'search';
  if (clean.length < 2) {
    krogerState.searchError = 'Type at least 2 characters to search Kroger.';
    krogerState.searchResults = [];
    renderOpenBook(false);
    return;
  }
  krogerState.searchLoading = true;
  krogerState.searchError = '';
  renderOpenBook(false);
  try {
    const loc = krogerState.store?.locationId || '';
    const qs = new URLSearchParams({ term: clean, limit: '15' });
    if (loc) qs.set('locationId', loc);
    const resp = await fetch(`/api/kroger/products?${qs.toString()}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Kroger search failed');
    krogerState.searchResults = Array.isArray(data.products) ? data.products : [];
    if (Array.isArray(data.recentSearches)) krogerState.recentSearches = data.recentSearches;
  } catch (err) {
    krogerState.searchError = err.message || 'Search failed';
    krogerState.searchResults = [];
  } finally {
    krogerState.searchLoading = false;
    renderOpenBook(false);
  }
}

async function runKrogerUrlLookup(rawUrl) {
  const clean = (rawUrl || '').trim();
  krogerState.urlInput = clean;
  if (!clean) {
    krogerState.urlError = 'Paste a Kroger product URL or 13-digit UPC.';
    krogerState.urlResult = null;
    renderOpenBook(false);
    return;
  }
  krogerState.urlLoading = true;
  krogerState.urlError = '';
  krogerState.urlResult = null;
  renderOpenBook(false);
  try {
    const loc = krogerState.store?.locationId || '';
    const qs = new URLSearchParams({ url: clean });
    if (loc) qs.set('locationId', loc);
    const resp = await fetch(`/api/kroger/url?${qs.toString()}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Lookup failed');
    krogerState.urlResult = data.product || null;
  } catch (err) {
    krogerState.urlError = err.message || 'Lookup failed';
  } finally {
    krogerState.urlLoading = false;
    renderOpenBook(false);
  }
}

async function refreshMarketListPrices(book) {
  if (!book || !book.marketLedger || krogerState.refreshing) return;
  const list = getActiveMarketList(book.marketLedger);
  if (!list) return;
  const upcs = list.items.map(i => i.upc || i.productId).filter(Boolean);
  if (upcs.length === 0) {
    showToast('No Kroger-linked items to refresh on this list.');
    return;
  }
  if (!krogerState.configured) {
    openKrogerSettingsModal();
    return;
  }
  krogerState.refreshing = true;
  renderOpenBook(false);
  try {
    const resp = await fetch('/api/kroger/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upcs,
        locationId: krogerState.store?.locationId || ''
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Price refresh failed');
    const map = data.products || {};
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    for (const it of list.items) {
      const fresh = map[it.upc] || map[it.productId];
      if (fresh) {
        it.price = fresh.price;
        it.promo = fresh.promo;
        it.stockLevel = fresh.stockLevel;
        if (fresh.aisle) it.aisle = fresh.aisle;
        if (fresh.imageUrl) it.imageUrl = fresh.imageUrl;
        if (fresh.size) it.size = fresh.size;
        it.updatedAt = nowIso;
        updatedCount += 1;
      }
    }
    commitChange();
    showToast(`Refreshed live prices & stock for ${updatedCount} item${updatedCount === 1 ? '' : 's'}!`);
  } catch (err) {
    showToast(err.message || 'Price refresh failed');
  } finally {
    krogerState.refreshing = false;
    renderOpenBook(false);
  }
}

async function sendMarketListToKrogerCart(book) {
  if (!book || !book.marketLedger || krogerState.syncingCart) return;
  if (!krogerState.configured || !krogerState.connected) {
    openKrogerSettingsModal();
    return;
  }
  const list = getActiveMarketList(book.marketLedger);
  if (!list) return;
  const items = list.items
    .filter(it => !it.checked && (it.upc || it.productId))
    .map(it => ({ upc: it.upc || it.productId, quantity: it.qty || 1 }));
  if (items.length === 0) {
    showToast('No unchecked Kroger-linked items to send to cart.');
    return;
  }
  krogerState.syncingCart = true;
  renderOpenBook(false);
  try {
    const resp = await fetch('/api/kroger/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        modality: book.marketLedger.modality || 'PICKUP'
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to add to Kroger Cart');
    playCozySound?.('chime');
    showToast(`Sent ${data.addedCount} item${data.addedCount === 1 ? '' : 's'} to your Kroger ${data.modality === 'DELIVERY' ? 'Delivery' : 'Pickup'} Cart!`);
  } catch (err) {
    showToast(err.message || 'Kroger Cart sync failed');
    if (/reconnect|not connected|expired/i.test(err.message || '')) {
      fetchKrogerStatus();
    }
  } finally {
    krogerState.syncingCart = false;
    renderOpenBook(false);
    updateGlobalMarketMenuUI();
  }
}

function startKrogerOAuthPopup() {
  if (!krogerState.configured) {
    showToast('Save your Kroger Client ID & Secret first.');
    return;
  }
  const w = 520, h = 680;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open('/api/kroger/auth/start', 'kroger_oauth', `width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) {
    window.location.href = '/api/kroger/auth/start';
  }
}

// ============================================================
// OPEN BOOK MODAL RENDERER FOR MARKET LEDGER BOOKS
// ============================================================
function renderMarketLedgerOpenBook(container, sw) {
  const { isCart, hall, book } = container;
  if (!book.marketLedger) book.marketLedger = createDefaultMarketLedgerData();
  const ledger = book.marketLedger;
  const activeList = getActiveMarketList(ledger);
  const stats = computeMarketListStats(activeList);

  bookSpreadWrap.classList.toggle('market-mobile-tab-list', krogerState.mobileTab === 'list');
  bookSpreadWrap.classList.toggle('market-mobile-tab-search', krogerState.mobileTab === 'search');

  const storeLabel = krogerState.store
    ? `${krogerState.store.name}${krogerState.store.zipCode ? ` (${krogerState.store.zipCode})` : ''}`
    : (krogerState.configured ? 'No store selected yet' : 'Kroger API not configured');

  const mobileTabBarHtml = `
    <div class="flex md:hidden items-center gap-1.5 mb-2.5 p-1 rounded-xl" style="background:#efe3cc; border:1.5px solid #c5ab86;">
      <button type="button" data-market-mob-tab="list" class="flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0"
        style="background:${krogerState.mobileTab === 'list' ? '#fffdf7' : 'transparent'}; color:${krogerState.mobileTab === 'list' ? '#362316' : '#7a5c44'};">
        Shopping List (${stats.rows})
      </button>
      <button type="button" data-market-mob-tab="search" class="flex-1 py-1.5 rounded-lg text-xs font-bold cursor-pointer border-0"
        style="background:${krogerState.mobileTab === 'search' ? '#fffdf7' : 'transparent'}; color:${krogerState.mobileTab === 'search' ? '#362316' : '#7a5c44'};">
        Kroger Search &amp; URL
      </button>
    </div>
  `;

  // Filter current search results
  const filteredResults = krogerState.searchResults.filter(p => {
    if (krogerState.stockFilter === 'in_stock' && p.stockLevel === 'TEMPORARILY_OUT_OF_STOCK') return false;
    if (krogerState.stockFilter === 'on_sale' && !(typeof p.promo === 'number' && typeof p.price === 'number' && p.promo < p.price)) return false;
    return true;
  });

  // ---- LEFT PAGE: KROGER SEARCH & URL LOOKUP ----
  bookLeftEl.innerHTML = `
    ${mobileTabBarHtml}
    <div class="pb-2.5 border-b space-y-2" style="border-color:rgba(122,92,68,0.22);">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="library-stamp shrink-0" style="color:#4f7c54;">Market Ledger</span>
          <input id="market-book-title" type="text" value="${esc(book.title)}" class="font-storybook font-bold text-base bg-transparent border-0 outline-none min-w-0 flex-1" style="color:#2d1a0f;" />
        </div>
        <button id="market-open-settings" type="button" class="rounded-xl px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0 flex items-center gap-1"
          style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">
          <span>&#9881;</span>
          <span>Kroger Settings</span>
        </button>
      </div>

      <!-- Kroger Store & Account Bar -->
      <div class="rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 flex-wrap text-[11px]" style="background:#f5ebd7; border:1px solid #d7c3a1;">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="w-2 h-2 rounded-full shrink-0" style="background:${krogerState.configured ? (krogerState.store ? '#4f7c54' : '#d69e42') : '#9c8369'};"></span>
          <span class="font-semibold truncate" style="color:#362316;" title="${esc(storeLabel)}">${esc(storeLabel)}</span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${krogerState.configured
            ? (krogerState.connected
              ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold" style="background:#e3f0e4; color:#2e6134;">Kroger Account Linked &#10003;</span>`
              : `<button id="market-quick-connect" type="button" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:#0d47a1; color:#fff; border:1px solid #082f6e;">Connect Account</button>`)
            : `<button id="market-setup-cta" type="button" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:#c96843; color:#fffaf2; border:1px solid #3c2516;">Set Up Kroger API</button>`}
        </div>
      </div>

      <!-- Search vs Paste URL Switcher -->
      <div class="flex items-center justify-between gap-2">
        <span class="font-storybook font-bold text-xs" style="color:#5e4430;">Kroger Product Lookup</span>
        <div class="flex rounded-xl p-0.5" style="background:#efe3cc; border:1.5px solid #c5ab86;">
          <button id="market-tab-search" type="button" class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold cursor-pointer border-0"
            style="background:${krogerState.leftTab === 'search' ? '#fffdf7' : 'transparent'}; color:${krogerState.leftTab === 'search' ? '#362316' : '#7a5c44'};">Search</button>
          <button id="market-tab-url" type="button" class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold cursor-pointer border-0"
            style="background:${krogerState.leftTab === 'url' ? '#fffdf7' : 'transparent'}; color:${krogerState.leftTab === 'url' ? '#362316' : '#7a5c44'};">Paste URL</button>
        </div>
      </div>
    </div>

    <!-- Left Page Body -->
    <div class="flex-1 overflow-y-auto nice-scroll pt-3 pr-1 space-y-2.5">
      ${!krogerState.configured ? `
        <div class="rounded-2xl p-3 space-y-1.5 text-xs" style="background:#fdf0d5; border:1.5px solid #d6b672; color:#5a3b14;">
          <div class="font-bold">Connect Kroger Developer API for live search, prices &amp; stock</div>
          <p class="text-[11px] leading-relaxed">Register a free app at <strong>developer.kroger.com</strong> and paste your Client ID &amp; Secret in <strong>Kroger Settings</strong> (or set them in <code>docker-compose.yml</code>). You can still use manual shopping lists right now!</p>
        </div>
      ` : ''}

      ${krogerState.leftTab === 'search' ? `
        <form id="market-search-form" class="flex gap-1.5">
          <input id="market-search-input" type="text" value="${esc(krogerState.searchQuery)}" placeholder="Search Kroger (e.g., whole milk, avocados, eggs)…" class="market-paper-input flex-1 rounded-xl px-3 py-1.5 text-xs" />
          <select id="market-stock-filter" class="market-paper-input rounded-xl px-2 py-1.5 text-[11px] font-semibold cursor-pointer">
            <option value="all" ${krogerState.stockFilter === 'all' ? 'selected' : ''}>All</option>
            <option value="in_stock" ${krogerState.stockFilter === 'in_stock' ? 'selected' : ''}>In Stock</option>
            <option value="on_sale" ${krogerState.stockFilter === 'on_sale' ? 'selected' : ''}>On Sale</option>
          </select>
          <button type="submit" ${krogerState.searchLoading ? 'disabled' : ''} class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50" style="background:#c96843; color:#fffaf2; border:1.5px solid #3c2516;">
            ${krogerState.searchLoading ? '…' : 'Search'}
          </button>
        </form>

        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" data-market-qmode="recent"
            class="px-2.5 py-1 rounded-xl text-[11px] font-bold cursor-pointer flex items-center gap-1 transition-colors"
            style="background:${krogerState.quickMode === 'recent' ? '#c96843' : '#f3e8d2'}; color:${krogerState.quickMode === 'recent' ? '#fffaf2' : '#362316'}; border:1.5px solid ${krogerState.quickMode === 'recent' ? '#3c2516' : '#c5ab86'};">
            <span>&#128337;</span>
            <span>Recently Searched${krogerState.recentSearches.length ? ` (${krogerState.recentSearches.length})` : ''}</span>
          </button>
          <button type="button" data-market-qmode="favorites"
            class="px-2.5 py-1 rounded-xl text-[11px] font-bold cursor-pointer flex items-center gap-1 transition-colors"
            style="background:${krogerState.quickMode === 'favorites' ? '#d69e42' : '#f3e8d2'}; color:${krogerState.quickMode === 'favorites' ? '#352012' : '#362316'}; border:1.5px solid ${krogerState.quickMode === 'favorites' ? '#3c2516' : '#c5ab86'};">
            <span>&#9733;</span>
            <span>My Favorites${krogerState.favorites.length ? ` (${krogerState.favorites.length})` : ''}</span>
          </button>
          <button type="button" data-market-qmode="on_sale"
            class="px-2.5 py-1 rounded-xl text-[11px] font-bold cursor-pointer flex items-center gap-1 transition-colors"
            style="background:${krogerState.quickMode === 'on_sale' ? '#b54534' : '#f3e8d2'}; color:${krogerState.quickMode === 'on_sale' ? '#fffaf2' : '#362316'}; border:1.5px solid ${krogerState.quickMode === 'on_sale' ? '#3c2516' : '#c5ab86'};">
            <span>&#127991;</span>
            <span>On Sale</span>
          </button>
        </div>

        ${krogerState.quickMode === 'recent' ? `
          <div class="rounded-2xl p-3 space-y-2.5" style="background:#f5ebd7; border:1.5px solid #d7c3a1;">
            <div class="flex items-center justify-between gap-2">
              <span class="font-storybook font-bold text-xs" style="color:#2d1a0f;">Recently Searched</span>
              ${krogerState.recentSearches.length > 0 ? `<button id="market-clear-recent" type="button" class="text-[10.5px] font-semibold underline bg-transparent border-0 cursor-pointer" style="color:#7a5c44;">Clear History</button>` : ''}
            </div>
            ${krogerState.recentSearches.length > 0 ? `
              <div class="flex flex-wrap gap-1.5">
                ${krogerState.recentSearches.map(term => `
                  <button type="button" data-market-recent-term="${esc(term)}" class="px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer transition-transform hover:scale-105" style="background:#fffdf8; color:#362316; border:1.2px solid #c5ab86;">
                    &#128269; ${esc(term)}
                  </button>
                `).join('')}
              </div>
            ` : `
              <div class="text-xs py-3 text-center" style="color:#7a5c44;">Your recent Kroger searches will appear here automatically.</div>
            `}
          </div>
        ` : krogerState.quickMode === 'favorites' ? `
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2 px-0.5">
              <span class="font-storybook font-bold text-xs" style="color:#2d1a0f;">My Favorites (${krogerState.favorites.length})</span>
              ${krogerState.favorites.length > 0 ? `
                <button id="market-refresh-favs" type="button" ${krogerState.favoritesRefreshing ? 'disabled' : ''} class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer disabled:opacity-50" style="background:#f3e8d2; color:#362316; border:1px solid #c5ab86;">
                  ${krogerState.favoritesRefreshing ? 'Refreshing…' : '&#8635; Refresh Prices'}
                </button>
              ` : ''}
            </div>
            ${krogerState.favorites.length > 0 ? `
              <div class="space-y-2">
                ${krogerState.favorites.map(p => renderKrogerProductCardHtml(p, activeList)).join('')}
              </div>
            ` : `
              <div class="rounded-2xl p-4 text-center space-y-1 text-xs" style="background:#f5ebd7; border:1.5px solid #d7c3a1; color:#7a5c44;">
                <div class="font-bold" style="color:#2d1a0f;">No favorites saved yet</div>
                <p class="text-[11px]">Tap the <strong>&#9734;</strong> star on any Kroger product from Search, On Sale, or Paste URL to keep your go-to staples right here.</p>
              </div>
            `}
          </div>
        ` : krogerState.quickMode === 'on_sale' ? `
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2 px-0.5">
              <span class="font-storybook font-bold text-xs" style="color:#2d1a0f;">
                ${krogerState.searchQuery.trim().length >= 2 ? `On Sale for "${esc(krogerState.searchQuery.trim())}"` : 'On Sale at Your Store'}
              </span>
              <button id="market-reload-deals" type="button" ${krogerState.dealsLoading ? 'disabled' : ''} class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer disabled:opacity-50" style="background:#f3e8d2; color:#362316; border:1px solid #c5ab86;">
                ${krogerState.dealsLoading ? 'Loading…' : '&#8635; Refresh Deals'}
              </button>
            </div>
            ${krogerState.dealsError ? `<div class="rounded-xl p-2.5 text-xs font-semibold" style="background:#fbe3df; color:#a33728; border:1px solid #e0a79e;">${esc(krogerState.dealsError)}</div>` : ''}
            ${krogerState.dealsLoading ? `
              <div class="text-center py-8 text-xs" style="color:#7a5c44;">Checking live Kroger promotions at your store…</div>
            ` : (krogerState.dealsResults.length > 0 ? `
              <div class="space-y-2">
                ${krogerState.dealsResults.map(p => renderKrogerProductCardHtml(p, activeList)).join('')}
              </div>
            ` : `
              <div class="text-center py-8 text-xs" style="color:#7a5c44;">No active sale items found right now. Try searching a specific item above and clicking On Sale!</div>
            `)}
          </div>
        ` : `
          ${krogerState.searchError ? `<div class="rounded-xl p-2.5 text-xs font-semibold" style="background:#fbe3df; color:#a33728; border:1px solid #e0a79e;">${esc(krogerState.searchError)}</div>` : ''}

          ${krogerState.searchLoading ? `
            <div class="text-center py-8 text-xs" style="color:#7a5c44;">Searching Kroger catalog…</div>
          ` : (filteredResults.length > 0 ? `
            <div class="space-y-2">
              ${filteredResults.map(p => renderKrogerProductCardHtml(p, activeList)).join('')}
            </div>
          ` : `
            <div class="text-center py-8 text-xs" style="color:#7a5c44;">
              ${krogerState.searchResults.length > 0
                ? 'No items matched your stock/sale filter.'
                : 'Search for any grocery item above, or tap Recently Searched, My Favorites, or On Sale.'}
            </div>
          `)}
        `}
      ` : `
        <form id="market-url-form" class="rounded-2xl p-3 space-y-2.5" style="background:#f5ebd7; border:1.5px solid #c5ab86;">
          <div class="text-xs font-bold" style="color:#2d1a0f;">Paste a Kroger Product URL or 13-digit UPC</div>
          <p class="text-[11px]" style="color:#7a5c44;">Works with <code>kroger.com</code>, <code>kingsoopers.com</code>, <code>fredmeyer.com</code>, <code>ralphs.com</code>, <code>smithsfoodanddrug.com</code>, and other Kroger banners.</p>
          <div class="flex gap-1.5">
            <input id="market-url-input" type="text" value="${esc(krogerState.urlInput)}" placeholder="https://www.kroger.com/p/simple-truth-organic-whole-milk/0001111041700" class="market-paper-input flex-1 rounded-xl px-2.5 py-1.5 text-xs" />
            <button type="submit" ${krogerState.urlLoading ? 'disabled' : ''} class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50" style="background:#c96843; color:#fffaf2; border:1.5px solid #3c2516;">
              ${krogerState.urlLoading ? '…' : 'Lookup'}
            </button>
          </div>
        </form>
        ${krogerState.urlError ? `<div class="rounded-xl p-2.5 text-xs font-semibold" style="background:#fbe3df; color:#a33728; border:1px solid #e0a79e;">${esc(krogerState.urlError)}</div>` : ''}
        ${krogerState.urlLoading ? `<div class="text-center py-6 text-xs" style="color:#7a5c44;">Fetching live store data from Kroger…</div>` : ''}
        ${krogerState.urlResult ? renderKrogerProductCardHtml(krogerState.urlResult, activeList) : ''}
      `}
    </div>

    <div class="pt-2.5 mt-2 border-t flex items-center justify-between gap-2 flex-wrap" style="border-color:rgba(122,92,68,0.2);">
      <button id="open-jump-hall" class="text-xs font-semibold hover:underline bg-transparent border-0 p-0 cursor-pointer" style="color:#78573d;">&larr; ${isCart ? 'Sorting Pile' : 'Edit ' + esc(truncate(hall.title, 16))}</button>
      <button id="open-del-book" class="text-[11px] font-semibold px-2.5 py-1 rounded-xl cursor-pointer bg-transparent border border-red-400/50 text-red-700 hover:bg-red-500/10">Delete Ledger</button>
    </div>
  `;

  // ---- RIGHT PAGE: SHOPPING LIST ----
  const groups = {};
  const listItems = activeList?.items || [];
  if (ledger.groupBy === 'aisle') {
    for (const it of listItems) {
      const key = it.aisle || 'Custom / Other';
      (groups[key] ||= []).push(it);
    }
  } else {
    groups['All Items'] = listItems;
  }

  bookRightEl.innerHTML = `
    ${mobileTabBarHtml}
    <div class="pb-2.5 border-b flex items-center justify-between gap-2 flex-wrap" style="border-color:rgba(122,92,68,0.22);">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <input id="market-list-name" type="text" value="${esc(activeList?.name || 'Shopping List')}" class="font-storybook font-bold text-base bg-transparent border-0 outline-none min-w-0 flex-1" style="color:#2d1a0f;" />
        <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0" style="background:#f3e8d2; color:#7a5c44; border:1px solid #c5ab86;">${stats.checkedRows}/${stats.rows}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button id="market-toggle-group" type="button" class="rounded-xl px-2 py-1 text-[11px] font-semibold cursor-pointer" style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">
          ${ledger.groupBy === 'aisle' ? 'Group: Aisle' : 'Group: Flat'}
        </button>
        <button id="market-refresh-prices" type="button" ${krogerState.refreshing ? 'disabled' : ''} title="Refresh live Kroger prices &amp; stock" class="rounded-xl px-2 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-50" style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">
          ${krogerState.refreshing ? 'Refreshing…' : '&#8635; Refresh'}
        </button>
        ${ledger.lists.length > 1 ? `<button id="market-del-list" type="button" title="Delete this list tab" class="rounded-xl px-2 py-1 text-[11px] font-bold cursor-pointer bg-transparent border border-red-400/50 text-red-700">&times;</button>` : ''}
      </div>
    </div>

    <!-- Quick Manual Add -->
    <form id="market-manual-form" class="flex gap-1.5 pt-2.5 pb-2">
      <input id="market-manual-input" type="text" placeholder="+ Add custom item (e.g., Farmers market honey)…" class="market-paper-input flex-1 rounded-xl px-2.5 py-1.5 text-xs" />
      <button type="submit" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer" style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">Add</button>
    </form>

    <!-- List Items -->
    <div class="flex-1 overflow-y-auto nice-scroll space-y-2.5 pr-1 py-1">
      ${listItems.length === 0 ? `
        <div class="text-center py-12 text-xs" style="color:#7a5c44;">
          This shopping list is empty.<br/>Search Kroger on the left page or add a custom item above!
        </div>
      ` : Object.entries(groups).map(([groupName, rows]) => `
        <div class="space-y-1.5">
          ${ledger.groupBy === 'aisle' ? `
            <div class="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-wider px-1" style="color:#7a5c44;">
              <span>${esc(groupName)}</span>
              <span class="flex-1 h-px" style="background:rgba(122,92,68,0.2);"></span>
            </div>
          ` : ''}
          ${rows.map(it => {
            const unit = (typeof it.promo === 'number' && it.promo > 0) ? it.promo : ((typeof it.price === 'number' && it.price > 0) ? it.price : null);
            const lineTotal = unit !== null ? unit * (it.qty || 1) : null;
            return `
              <div class="rounded-xl px-2.5 py-2 flex items-center gap-2 transition-opacity ${it.checked ? 'opacity-55' : ''}" style="background:#fffdf8; border:1.5px solid ${it.checked ? '#dfd1b8' : '#d7c3a1'};">
                <input type="checkbox" data-mi-toggle="${it.id}" ${it.checked ? 'checked' : ''} class="w-4 h-4 accent-[#4f7c54] cursor-pointer shrink-0" />
                ${it.imageUrl ? `<img src="${esc(it.imageUrl)}" alt="" class="w-8 h-8 rounded-lg object-contain bg-white border border-amber-900/15 shrink-0" />` : ''}
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-bold leading-snug truncate ${it.checked ? 'line-through' : ''}" style="color:#2d1a0f;" title="${esc(it.name)}">${esc(it.name)}</div>
                  <div class="flex items-center gap-1.5 flex-wrap text-[10.5px]" style="color:#7a5c44;">
                    ${it.size ? `<span>${esc(it.size)}</span>` : `<span>${it.upc ? 'Kroger' : 'Custom'}</span>`}
                    ${it.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? `<span class="font-bold" style="color:#b54534;">&middot; Out of Stock</span>` : ''}
                    ${it.stockLevel === 'LOW' ? `<span class="font-bold" style="color:#9a6210;">&middot; Low Stock</span>` : ''}
                    ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" class="underline" style="color:#0d47a1;">Link</a>` : ''}
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button type="button" data-mi-dec="${it.id}" class="w-6 h-6 rounded-lg text-xs font-bold cursor-pointer" style="background:#f3e8d2; border:1px solid #c5ab86; color:#362316;">&minus;</button>
                  <span class="w-5 text-center text-xs font-mono font-bold tabular-nums" style="color:#2d1a0f;">${it.qty || 1}</span>
                  <button type="button" data-mi-inc="${it.id}" class="w-6 h-6 rounded-lg text-xs font-bold cursor-pointer" style="background:#f3e8d2; border:1px solid #c5ab86; color:#362316;">+</button>
                </div>
                <div class="w-14 text-right text-xs font-mono font-bold tabular-nums shrink-0" style="color:#2d1a0f;">
                  ${lineTotal !== null ? `$${lineTotal.toFixed(2)}` : '&mdash;'}
                </div>
                <button type="button" data-mi-del="${it.id}" title="Remove item" class="w-5 h-5 rounded text-xs font-bold bg-transparent border-0 cursor-pointer hover:text-red-700" style="color:#8f7054;">&times;</button>
              </div>
            `;
          }).join('')}
        </div>
      `).join('')}
    </div>

    <!-- Footer Totals & Kroger Cart Push -->
    <div class="pt-2.5 mt-2 border-t space-y-2" style="border-color:rgba(122,92,68,0.22);">
      <div class="flex items-center justify-between text-xs">
        <div>
          <div class="font-bold" style="color:#2d1a0f;">Estimated Total <span class="font-normal" style="color:#7a5c44;">(${stats.totalQty} item${stats.totalQty === 1 ? '' : 's'})</span></div>
          <div class="text-[11px] font-semibold" style="color:#4f7c54;">${stats.savings > 0 ? `Saving $${stats.savings.toFixed(2)} with Kroger deals` : 'Prices reflect your selected store'}</div>
        </div>
        <div class="text-right">
          <div class="font-storybook font-bold text-lg tabular-nums" style="color:#2d1a0f;">$${stats.total.toFixed(2)}</div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-1.5 flex-wrap">
        <div class="flex items-center gap-1.5">
          <button id="market-clear-checked" type="button" class="rounded-xl px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer" style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">Clear Checked</button>
          <select id="market-modality-sel" title="Kroger Cart Fulfillment" class="market-paper-input rounded-xl px-2 py-1.5 text-[11px] font-semibold cursor-pointer">
            <option value="PICKUP" ${ledger.modality === 'PICKUP' ? 'selected' : ''}>Pickup</option>
            <option value="DELIVERY" ${ledger.modality === 'DELIVERY' ? 'selected' : ''}>Delivery</option>
          </select>
        </div>
        <button id="market-push-cart" type="button" ${krogerState.syncingCart ? 'disabled' : ''} class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50" style="background:#0d47a1; color:#ffffff; border:1.5px solid #082f6e;">
          ${krogerState.syncingCart
            ? 'Sending to Kroger…'
            : (krogerState.connected
              ? `Send ${stats.uncheckedKroger} to Kroger Cart`
              : 'Connect Kroger to Send to Cart')}
        </button>
      </div>
    </div>
  `;

  // ---- RIGHT-EDGE CHAPTER TABS FOR MULTIPLE SHOPPING LISTS ----
  const pal = getPalette();
  bookChapterTabsEl.innerHTML = `
    ${ledger.lists.map((l, idx) => {
      const isAct = l.id === activeList?.id;
      const csw = getSwatch(l.color || pal[idx % pal.length].id);
      return `
        <button type="button" data-market-tab-list="${l.id}"
          class="chapter-tab-btn text-left px-3 py-2 cursor-pointer transition-transform ${isAct ? 'translate-x-1.5 shadow-md' : 'opacity-90 hover:translate-x-1'}"
          style="background:${isAct ? csw.fill : '#f3e8d2'}; color:${isAct ? '#fffaf2' : '#362316'}; border:2px solid #3c2516; border-left:0; border-radius:0 12px 12px 0;">
          <div class="font-storybook font-bold text-xs truncate">${esc(l.name)}</div>
          <div class="text-[10px] opacity-85">${(l.items || []).length} items</div>
        </button>
      `;
    }).join('')}
    <button id="market-add-list-tab" type="button"
      class="text-left px-3 py-1.5 cursor-pointer text-[11px] font-bold"
      style="background:#fffaf0; color:#5e4430; border:2px dashed #8a6544; border-left:0; border-radius:0 12px 12px 0;">
      + New List
    </button>
  `;
  bookBottomRibbonsEl.innerHTML = '';

  // ---- WIRE EVENTS ----
  const bindMobTabs = (root) => {
    root.querySelectorAll('[data-market-mob-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        krogerState.mobileTab = btn.dataset.marketMobTab;
        renderOpenBook(false);
      });
    });
  };
  bindMobTabs(bookLeftEl);
  bindMobTabs(bookRightEl);

  document.getElementById('market-book-title')?.addEventListener('input', (e) => {
    book.title = e.target.value;
    persistState();
    renderMap();
    updateGlobalMarketMenuUI();
  });
  document.getElementById('market-book-title')?.addEventListener('change', () => pushHistory());

  document.getElementById('market-open-settings')?.addEventListener('click', () => openKrogerSettingsModal());
  document.getElementById('market-setup-cta')?.addEventListener('click', () => openKrogerSettingsModal());
  document.getElementById('market-quick-connect')?.addEventListener('click', () => startKrogerOAuthPopup());

  document.getElementById('market-tab-search')?.addEventListener('click', () => {
    krogerState.leftTab = 'search';
    renderOpenBook(false);
  });
  document.getElementById('market-tab-url')?.addEventListener('click', () => {
    krogerState.leftTab = 'url';
    renderOpenBook(false);
  });

  document.getElementById('market-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('market-search-input');
    runKrogerSearch(inp?.value || '');
  });
  document.getElementById('market-stock-filter')?.addEventListener('change', (e) => {
    krogerState.stockFilter = e.target.value;
    renderOpenBook(false);
  });
  bookLeftEl.querySelectorAll('[data-market-qmode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.marketQmode;
      if (krogerState.quickMode === mode) {
        krogerState.quickMode = 'search';
        renderOpenBook(false);
        return;
      }
      krogerState.quickMode = mode;
      if (mode === 'on_sale') {
        const currentInput = (document.getElementById('market-search-input')?.value || krogerState.searchQuery || '').trim();
        krogerState.searchQuery = currentInput;
        loadKrogerDeals(currentInput);
        return;
      }
      renderOpenBook(false);
    });
  });

  bookLeftEl.querySelectorAll('[data-market-recent-term]').forEach(btn => {
    btn.addEventListener('click', () => runKrogerSearch(btn.dataset.marketRecentTerm));
  });
  document.getElementById('market-clear-recent')?.addEventListener('click', () => clearKrogerRecentSearches());
  document.getElementById('market-refresh-favs')?.addEventListener('click', () => refreshKrogerFavorites());
  document.getElementById('market-reload-deals')?.addEventListener('click', () => {
    const currentInput = (document.getElementById('market-search-input')?.value || krogerState.searchQuery || '').trim();
    loadKrogerDeals(currentInput);
  });

  document.getElementById('market-url-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('market-url-input');
    runKrogerUrlLookup(inp?.value || '');
  });

  const findProductByKey = (key) => {
    if (!key) return null;
    const pools = [
      krogerState.searchResults,
      krogerState.dealsResults,
      krogerState.favorites,
      krogerState.urlResult ? [krogerState.urlResult] : []
    ];
    for (const pool of pools) {
      const hit = pool.find(p => p && ((p.upc && p.upc === key) || (p.productId && p.productId === key)));
      if (hit) return hit;
    }
    return null;
  };

  bookLeftEl.querySelectorAll('[data-market-add-upc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prod = findProductByKey(btn.dataset.marketAddUpc);
      if (prod) addKrogerProductToBook(book, prod);
    });
  });

  bookLeftEl.querySelectorAll('[data-market-fav-upc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prod = findProductByKey(btn.dataset.marketFavUpc);
      if (prod) toggleKrogerFavorite(prod);
    });
  });

  document.getElementById('open-jump-hall')?.addEventListener('click', () => {
    closeOpenBook();
    if (isCart) openCartInspector();
    else selectNode('hall', hall.id, true);
  });
  document.getElementById('open-del-book')?.addEventListener('click', () => {
    if (confirm(`Move "${book.title}" to the Recycling Basket?`)) {
      recycleBook(isCart ? CART_HALL_ID : hall.id, book.id);
    }
  });

  document.getElementById('market-list-name')?.addEventListener('input', (e) => {
    if (activeList) {
      activeList.name = e.target.value;
      persistState();
      updateGlobalMarketMenuUI();
    }
  });
  document.getElementById('market-list-name')?.addEventListener('change', () => { pushHistory(); renderOpenBook(false); });

  document.getElementById('market-toggle-group')?.addEventListener('click', () => {
    ledger.groupBy = ledger.groupBy === 'aisle' ? 'flat' : 'aisle';
    commitChange();
  });
  document.getElementById('market-refresh-prices')?.addEventListener('click', () => refreshMarketListPrices(book));
  document.getElementById('market-del-list')?.addEventListener('click', () => {
    if (ledger.lists.length <= 1) return;
    if (!confirm(`Delete shopping list "${activeList.name}"?`)) return;
    ledger.lists = ledger.lists.filter(l => l.id !== activeList.id);
    ledger.activeListId = ledger.lists[0].id;
    commitChange();
  });

  document.getElementById('market-manual-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('market-manual-input');
    const name = (inp?.value || '').trim();
    if (!name || !activeList) return;
    activeList.items.push({
      id: uid('mi'),
      name,
      brand: '',
      size: '',
      qty: 1,
      checked: false,
      note: '',
      upc: '',
      productId: '',
      price: null,
      promo: null,
      stockLevel: 'UNKNOWN',
      aisle: 'Custom / Other',
      imageUrl: '',
      url: '',
      updatedAt: new Date().toISOString()
    });
    inp.value = '';
    commitChange();
  });

  bookRightEl.querySelectorAll('[data-mi-toggle]').forEach(el => {
    el.addEventListener('change', () => {
      const it = activeList?.items.find(x => x.id === el.dataset.miToggle);
      if (it) { it.checked = el.checked; commitChange(); }
    });
  });
  bookRightEl.querySelectorAll('[data-mi-dec]').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = activeList?.items.find(x => x.id === btn.dataset.miDec);
      if (it) { it.qty = Math.max(1, (it.qty || 1) - 1); commitChange(); }
    });
  });
  bookRightEl.querySelectorAll('[data-mi-inc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = activeList?.items.find(x => x.id === btn.dataset.miInc);
      if (it) { it.qty = Math.min(99, (it.qty || 1) + 1); commitChange(); }
    });
  });
  bookRightEl.querySelectorAll('[data-mi-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeList) return;
      activeList.items = activeList.items.filter(x => x.id !== btn.dataset.miDel);
      commitChange();
    });
  });

  document.getElementById('market-clear-checked')?.addEventListener('click', () => {
    if (!activeList) return;
    const before = activeList.items.length;
    activeList.items = activeList.items.filter(x => !x.checked);
    commitChange();
    showToast(`Cleared ${before - activeList.items.length} checked item(s)`);
  });
  document.getElementById('market-modality-sel')?.addEventListener('change', (e) => {
    ledger.modality = e.target.value === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    commitChange();
  });
  document.getElementById('market-push-cart')?.addEventListener('click', () => sendMarketListToKrogerCart(book));

  bookChapterTabsEl.querySelectorAll('[data-market-tab-list]').forEach(btn => {
    btn.addEventListener('click', () => {
      ledger.activeListId = btn.dataset.marketTabList;
      commitChange();
    });
  });
  document.getElementById('market-add-list-tab')?.addEventListener('click', () => {
    const newId = uid('ml');
    const col = pal[ledger.lists.length % pal.length].id;
    ledger.lists.push({ id: newId, name: `List ${ledger.lists.length + 1}`, color: col, items: [] });
    ledger.activeListId = newId;
    commitChange();
  });
}

// ============================================================
// KROGER SETTINGS & STORE PICKER MODAL
// ============================================================
const krogerSettingsModal = document.getElementById('kroger-settings-modal');
const krogerSettingsCard = document.getElementById('kroger-settings-card');
let storeSearchResults = [];
let storeSearchZip = '';
let storeSearching = false;
let storeSearchErr = '';

function closeKrogerSettingsModal() {
  krogerSettingsModal?.classList.add('hidden');
}

function openKrogerSettingsModal() {
  if (!krogerSettingsModal) return;
  krogerSettingsModal.classList.remove('hidden');
  renderKrogerSettingsModal();
  fetchKrogerStatus().then(() => renderKrogerSettingsModal());
}

function renderKrogerSettingsModal() {
  if (!krogerSettingsCard) return;
  const st = krogerState;
  krogerSettingsCard.innerHTML = `
    <div class="px-4 py-3 flex items-center justify-between border-b" style="border-color:var(--ui-border);">
      <div>
        <div class="font-storybook font-bold text-base" style="color:var(--ui-ink);">Kroger Store &amp; Account Settings</div>
        <div class="text-[11px]" style="color:var(--ui-muted);">Live local prices, aisle stock, URL lookup &amp; Kroger Cart sync</div>
      </div>
      <button id="kroger-modal-close" type="button" class="storybook-btn rounded-xl px-2.5 py-1 text-xs font-bold cursor-pointer">&times;</button>
    </div>

    <div class="p-4 overflow-y-auto nice-scroll space-y-4 text-xs" style="color:var(--ui-ink);">
      <!-- 1. Store Picker -->
      <section class="rounded-2xl p-3 space-y-2.5" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
        <div class="flex items-center justify-between gap-2">
          <div class="font-storybook font-bold text-sm">1. Local Kroger Store</div>
          ${st.store ? `<span class="text-[10.5px] font-bold px-2 py-0.5 rounded-full" style="background:#e3f0e4; color:#2e6134;">Selected</span>` : ''}
        </div>
        ${st.store ? `
          <div class="rounded-xl p-2.5 flex items-center justify-between gap-2" style="background:var(--ui-surface-solid); border:1px solid var(--ui-border);">
            <div class="min-w-0">
              <div class="font-bold truncate">${esc(st.store.name)}</div>
              <div class="text-[11px] truncate" style="color:var(--ui-muted);">${esc(st.store.address || st.store.zipCode)}</div>
            </div>
            <span class="text-[10.5px] font-mono px-1.5 py-0.5 rounded" style="background:var(--ui-surface-alt); color:var(--ui-muted);">#${esc(st.store.locationId)}</span>
          </div>
        ` : `<p class="text-[11px]" style="color:var(--ui-muted);">Search by 5-digit ZIP to pick your Kroger, King Soopers, Ralphs, Fred Meyer, or Smith's store for accurate pricing.</p>`}

        <form id="kroger-zip-form" class="flex gap-1.5">
          <input id="kroger-zip-input" type="text" maxlength="5" value="${esc(storeSearchZip)}" placeholder="Enter 5-digit ZIP (e.g., 43215)" class="storybook-input flex-1 rounded-xl px-3 py-1.5 text-xs" />
          <button type="submit" ${(!st.configured || storeSearching) ? 'disabled' : ''} class="storybook-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-45">
            ${storeSearching ? 'Finding…' : 'Find Stores'}
          </button>
        </form>
        ${storeSearchErr ? `<div class="text-[11px] font-semibold text-red-600">${esc(storeSearchErr)}</div>` : ''}
        ${storeSearchResults.length > 0 ? `
          <div class="space-y-1.5 max-h-40 overflow-y-auto nice-scroll pr-0.5">
            ${storeSearchResults.map(loc => `
              <button type="button" data-pick-store="${esc(loc.locationId)}" class="w-full text-left rounded-xl p-2 flex items-center justify-between gap-2 storybook-btn cursor-pointer">
                <div class="min-w-0">
                  <div class="font-bold truncate">${esc(loc.name)}</div>
                  <div class="text-[10.5px] truncate" style="color:var(--ui-muted);">${esc(loc.address)} ${esc(loc.zipCode)}</div>
                </div>
                <span class="text-[10.5px] font-bold shrink-0" style="color:var(--ui-accent);">Select</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
      </section>

      <!-- 2. Kroger Shopper Account Link (OAuth) -->
      <section class="rounded-2xl p-3 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
        <div class="flex items-center justify-between gap-2">
          <div class="font-storybook font-bold text-sm">2. Kroger Account Link (Cart Sync)</div>
          <span class="text-[10.5px] font-bold px-2 py-0.5 rounded-full" style="background:${st.connected ? '#e3f0e4' : 'var(--ui-surface-solid)'}; color:${st.connected ? '#2e6134' : 'var(--ui-muted)'};">
            ${st.connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <p class="text-[11px]" style="color:var(--ui-muted);">Sign in with your Kroger account via OAuth 2.0 so you can send shopping list items straight into your Kroger Pickup or Delivery cart.</p>
        <div class="flex items-center gap-2 flex-wrap">
          ${st.connected ? `
            <button id="kroger-btn-disconnect" type="button" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer bg-transparent border border-red-400/60 text-red-600">Disconnect Account</button>
          ` : `
            <button id="kroger-btn-connect" type="button" ${!st.configured ? 'disabled' : ''} class="rounded-xl px-3.5 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-45" style="background:#0d47a1; color:#ffffff; border:1.5px solid #082f6e;">
              Sign In with Kroger
            </button>
          `}
        </div>
      </section>

      <!-- 3. Developer API Credentials -->
      <section class="rounded-2xl p-3 space-y-2.5" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
        <div class="flex items-center justify-between gap-2">
          <div class="font-storybook font-bold text-sm">3. Kroger Developer API Credentials</div>
          <span class="text-[10.5px] font-bold px-2 py-0.5 rounded-full" style="background:${st.configured ? '#e3f0e4' : '#fdf0d5'}; color:${st.configured ? '#2e6134' : '#9a6210'};">
            ${st.configured ? (st.fromEnv ? 'Set via Env' : 'Configured') : 'Setup Needed'}
          </span>
        </div>
        <p class="text-[11px]" style="color:var(--ui-muted);">
          Create a free app at <a href="https://developer.kroger.com/" target="_blank" rel="noopener noreferrer" class="underline font-semibold" style="color:var(--ui-accent);">developer.kroger.com</a> and add this Redirect URI in your app settings:
        </p>
        <div class="flex items-center gap-1.5">
          <input id="kroger-redirect-display" type="text" readonly value="${esc(st.redirectUri)}" class="storybook-input flex-1 rounded-xl px-2.5 py-1 text-[11px] font-mono" />
          <button id="kroger-copy-redirect" type="button" class="storybook-btn rounded-xl px-2.5 py-1 text-[11px] font-bold cursor-pointer">Copy</button>
        </div>
        ${!st.fromEnv ? `
          <form id="kroger-creds-form" class="space-y-2 pt-1">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input id="kroger-client-id" type="text" placeholder="Client ID" class="storybook-input rounded-xl px-2.5 py-1.5 text-xs" />
              <input id="kroger-client-secret" type="password" placeholder="Client Secret" class="storybook-input rounded-xl px-2.5 py-1.5 text-xs" />
            </div>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <select id="kroger-env-sel" class="storybook-input rounded-xl px-2.5 py-1 text-xs cursor-pointer">
                <option value="prod" ${st.env === 'prod' ? 'selected' : ''}>Production (api.kroger.com)</option>
                <option value="ce" ${st.env === 'ce' ? 'selected' : ''}>Certification Sandbox (api-ce.kroger.com)</option>
              </select>
              <button type="submit" class="storybook-btn-primary rounded-xl px-3.5 py-1.5 text-xs font-bold cursor-pointer">Save Credentials</button>
            </div>
          </form>
        ` : `<div class="text-[11px]" style="color:var(--ui-muted);">Credentials are provided via server environment variables (<code>KROGER_CLIENT_ID</code> / <code>KROGER_CLIENT_SECRET</code>).</div>`}
      </section>
    </div>
  `;

  document.getElementById('kroger-modal-close')?.addEventListener('click', closeKrogerSettingsModal);
  document.getElementById('kroger-copy-redirect')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(krogerState.redirectUri);
      showToast('Copied Redirect URI!');
    } catch (e) {
      showToast('Select and copy the Redirect URI');
    }
  });

  document.getElementById('kroger-creds-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = (document.getElementById('kroger-client-id')?.value || '').trim();
    const clientSecret = (document.getElementById('kroger-client-secret')?.value || '').trim();
    const env = document.getElementById('kroger-env-sel')?.value || 'prod';
    if (!clientId || !clientSecret) {
      showToast('Enter both Client ID and Client Secret.');
      return;
    }
    try {
      const resp = await fetch('/api/kroger/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, env })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Save failed');
      await fetchKrogerStatus();
      renderKrogerSettingsModal();
      showToast('Saved Kroger API credentials!');
    } catch (err) {
      showToast(err.message || 'Could not save credentials');
    }
  });

  document.getElementById('kroger-zip-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const zip = (document.getElementById('kroger-zip-input')?.value || '').trim();
    storeSearchZip = zip;
    storeSearching = true;
    storeSearchErr = '';
    renderKrogerSettingsModal();
    try {
      const resp = await fetch(`/api/kroger/locations?zip=${encodeURIComponent(zip)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Store search failed');
      storeSearchResults = Array.isArray(data.locations) ? data.locations : [];
      if (storeSearchResults.length === 0) storeSearchErr = 'No Kroger family stores found near that ZIP.';
    } catch (err) {
      storeSearchErr = err.message || 'Store search failed';
      storeSearchResults = [];
    } finally {
      storeSearching = false;
      renderKrogerSettingsModal();
    }
  });

  krogerSettingsCard.querySelectorAll('[data-pick-store]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chosen = storeSearchResults.find(l => l.locationId === btn.dataset.pickStore);
      if (!chosen) return;
      try {
        const resp = await fetch('/api/kroger/store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: chosen })
        });
        if (!resp.ok) throw new Error('Could not save store');
        storeSearchResults = [];
        await fetchKrogerStatus();
        renderKrogerSettingsModal();
        showToast(`Selected ${chosen.name}!`);
      } catch (err) {
        showToast(err.message || 'Could not save store');
      }
    });
  });

  document.getElementById('kroger-btn-connect')?.addEventListener('click', () => startKrogerOAuthPopup());
  document.getElementById('kroger-btn-disconnect')?.addEventListener('click', async () => {
    await fetch('/api/kroger/auth/disconnect', { method: 'POST' });
    await fetchKrogerStatus();
    renderKrogerSettingsModal();
    showToast('Disconnected Kroger account.');
  });
}

krogerSettingsModal?.addEventListener('click', (e) => {
  if (e.target === krogerSettingsModal) closeKrogerSettingsModal();
});

// ============================================================
// UPPER-RIGHT GLOBAL MARKET TOOLBAR DRAWER (DESKTOP & MOBILE)
// ============================================================
const btnMarketMenu = document.getElementById('btn-market-menu');
const menuMarket = document.getElementById('menu-market');
const marketMenuBadge = document.getElementById('market-menu-badge');

function getDrawerMarketEntry() {
  const ledgers = getAllMarketLedgers();
  if (ledgers.length === 0) return null;
  if (krogerState.drawerBookId) {
    const found = ledgers.find(e => e.book.id === krogerState.drawerBookId);
    if (found) return found;
  }
  krogerState.drawerBookId = ledgers[0].book.id;
  return ledgers[0];
}

function updateGlobalMarketMenuUI() {
  const entry = getDrawerMarketEntry();
  if (marketMenuBadge) {
    if (!entry) {
      marketMenuBadge.textContent = '0';
    } else {
      const list = getActiveMarketList(entry.book.marketLedger);
      const stats = computeMarketListStats(list);
      marketMenuBadge.textContent = stats.total > 0
        ? `${stats.uncheckedRows} · $${stats.total.toFixed(2)}`
        : `${stats.uncheckedRows}`;
    }
  }
  if (menuMarket && !menuMarket.classList.contains('hidden')) {
    renderGlobalMarketMenu();
  }
}

function renderGlobalMarketMenu() {
  if (!menuMarket) return;
  const ledgers = getAllMarketLedgers();
  const entry = getDrawerMarketEntry();

  if (!entry) {
    const firstHall = state.halls?.[0];
    menuMarket.innerHTML = `
      <div class="flex items-center justify-between pb-2 mb-2 border-b" style="border-color:var(--ui-border);">
        <div class="font-storybook font-bold text-sm" style="color:var(--ui-ink);">Market &amp; Shopping Lists</div>
        <button id="drawer-market-close" type="button" class="storybook-btn rounded-lg px-2 py-0.5 text-xs font-bold cursor-pointer">&times;</button>
      </div>
      <div class="py-5 text-center space-y-3">
        <p class="text-xs" style="color:var(--ui-muted);">You don't have a Market Ledger in this library yet. Create one to track groceries, search Kroger prices &amp; stock, and sync to your Kroger Cart.</p>
        <div class="flex items-center justify-center gap-2 flex-wrap">
          ${firstHall ? `<button id="drawer-create-ledger" type="button" class="storybook-btn-primary rounded-xl px-3.5 py-2 text-xs font-bold cursor-pointer">+ Create Market Ledger</button>` : ''}
          <button id="drawer-kroger-settings" type="button" class="storybook-btn rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer">&#9881; Kroger Settings</button>
        </div>
      </div>
    `;
    document.getElementById('drawer-market-close')?.addEventListener('click', () => menuMarket.classList.add('hidden'));
    document.getElementById('drawer-kroger-settings')?.addEventListener('click', () => {
      menuMarket.classList.add('hidden');
      openKrogerSettingsModal();
    });
    document.getElementById('drawer-create-ledger')?.addEventListener('click', () => {
      menuMarket.classList.add('hidden');
      if (firstHall) createMarketLedgerBook(firstHall.id);
    });
    return;
  }

  const { hall, book } = entry;
  const ledger = book.marketLedger;
  const list = getActiveMarketList(ledger);
  const stats = computeMarketListStats(list);
  const items = list?.items || [];

  const groups = {};
  for (const it of items) {
    const k = it.aisle || 'Custom / Other';
    (groups[k] ||= []).push(it);
  }

  menuMarket.innerHTML = `
    <div class="flex items-center justify-between gap-2 pb-2 mb-2 border-b shrink-0" style="border-color:var(--ui-border);">
      <div class="min-w-0">
        <div class="font-storybook font-bold text-sm truncate" style="color:var(--ui-ink);">${esc(list?.name || book.title)}</div>
        <div class="text-[11px] truncate" style="color:var(--ui-muted);">
          ${krogerState.store ? esc(krogerState.store.name) : esc(book.title)} &middot; ${stats.checkedRows}/${stats.rows} done
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <span class="font-storybook font-bold text-sm tabular-nums" style="color:var(--ui-accent);">$${stats.total.toFixed(2)}</span>
        <button id="drawer-market-close" type="button" class="storybook-btn rounded-lg px-2 py-0.5 text-xs font-bold cursor-pointer">&times;</button>
      </div>
    </div>

    ${(ledgers.length > 1 || ledger.lists.length > 1) ? `
      <div class="flex items-center gap-1.5 mb-2 shrink-0">
        ${ledgers.length > 1 ? `
          <select id="drawer-ledger-sel" class="storybook-input flex-1 rounded-xl px-2 py-1 text-[11px] font-semibold cursor-pointer">
            ${ledgers.map(e => `<option value="${e.book.id}" ${e.book.id === book.id ? 'selected' : ''}>${esc(e.book.title)}</option>`).join('')}
          </select>
        ` : ''}
        ${ledger.lists.length > 1 ? `
          <select id="drawer-list-sel" class="storybook-input flex-1 rounded-xl px-2 py-1 text-[11px] font-semibold cursor-pointer">
            ${ledger.lists.map(l => `<option value="${l.id}" ${l.id === list.id ? 'selected' : ''}>${esc(l.name)} (${(l.items || []).length})</option>`).join('')}
          </select>
        ` : ''}
      </div>
    ` : ''}

    <form id="drawer-quick-add" class="flex gap-1.5 mb-2 shrink-0">
      <input id="drawer-quick-input" type="text" placeholder="+ Quick add item…" class="storybook-input flex-1 rounded-xl px-2.5 py-1.5 text-xs" />
      <button type="submit" class="storybook-btn rounded-xl px-2.5 py-1.5 text-xs font-bold cursor-pointer">Add</button>
    </form>

    <div class="flex-1 overflow-y-auto nice-scroll space-y-2 pr-0.5 min-h-[120px]">
      ${items.length === 0 ? `
        <div class="text-center py-8 text-xs" style="color:var(--ui-muted);">List is empty — add an item above or open Kroger Search!</div>
      ` : Object.entries(groups).map(([aisle, rows]) => `
        <div class="space-y-1">
          <div class="text-[10px] font-bold uppercase tracking-wider px-1" style="color:var(--ui-muted);">${esc(aisle)}</div>
          ${rows.map(it => {
            const unit = (typeof it.promo === 'number' && it.promo > 0) ? it.promo : ((typeof it.price === 'number' && it.price > 0) ? it.price : null);
            return `
              <label class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl cursor-pointer text-xs" style="background:var(--ui-surface-alt); border:1.2px solid var(--ui-border);">
                <span class="flex items-center gap-2 min-w-0">
                  <input type="checkbox" data-drawer-mi="${it.id}" ${it.checked ? 'checked' : ''} class="w-4 h-4 accent-[#4f7c54] shrink-0" />
                  <span class="truncate font-medium ${it.checked ? 'line-through opacity-55' : ''}" style="color:var(--ui-ink);">${esc(it.name)}</span>
                </span>
                <span class="font-mono text-[11px] font-bold tabular-nums shrink-0" style="color:var(--ui-muted);">
                  ${it.qty > 1 ? `${it.qty}x ` : ''}${unit !== null ? `$${(unit * (it.qty || 1)).toFixed(2)}` : ''}
                </span>
              </label>
            `;
          }).join('')}
        </div>
      `).join('')}
    </div>

    <div class="pt-2.5 mt-2 border-t flex items-center justify-between gap-1.5 flex-wrap shrink-0" style="border-color:var(--ui-border);">
      <button id="drawer-open-full" type="button" class="storybook-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer">
        Kroger Search &amp; Ledger &rarr;
      </button>
      <div class="flex items-center gap-1.5">
        ${krogerState.connected && stats.uncheckedKroger > 0 ? `
          <button id="drawer-push-cart" type="button" class="rounded-xl px-2.5 py-1.5 text-[11px] font-bold cursor-pointer" style="background:#0d47a1; color:#fff; border:1px solid #082f6e;">
            Cart (${stats.uncheckedKroger})
          </button>
        ` : ''}
        <button id="drawer-kroger-settings" type="button" title="Kroger Settings" class="storybook-btn rounded-xl px-2 py-1.5 text-xs font-bold cursor-pointer">&#9881;</button>
      </div>
    </div>
  `;

  document.getElementById('drawer-market-close')?.addEventListener('click', () => menuMarket.classList.add('hidden'));
  document.getElementById('drawer-ledger-sel')?.addEventListener('change', (e) => {
    krogerState.drawerBookId = e.target.value;
    updateGlobalMarketMenuUI();
  });
  document.getElementById('drawer-list-sel')?.addEventListener('change', (e) => {
    ledger.activeListId = e.target.value;
    commitChange();
  });
  document.getElementById('drawer-quick-add')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('drawer-quick-input');
    const name = (inp?.value || '').trim();
    if (!name || !list) return;
    list.items.push({
      id: uid('mi'),
      name,
      brand: '',
      size: '',
      qty: 1,
      checked: false,
      note: '',
      upc: '',
      productId: '',
      price: null,
      promo: null,
      stockLevel: 'UNKNOWN',
      aisle: 'Custom / Other',
      imageUrl: '',
      url: '',
      updatedAt: new Date().toISOString()
    });
    inp.value = '';
    commitChange();
  });
  menuMarket.querySelectorAll('[data-drawer-mi]').forEach(el => {
    el.addEventListener('change', () => {
      const it = list?.items.find(x => x.id === el.dataset.drawerMi);
      if (it) { it.checked = el.checked; commitChange(); }
    });
  });
  document.getElementById('drawer-open-full')?.addEventListener('click', () => {
    menuMarket.classList.add('hidden');
    openBookCenter(hall.id, book.id, book.pages?.[0]?.id || null, 'spread');
  });
  document.getElementById('drawer-push-cart')?.addEventListener('click', () => sendMarketListToKrogerCart(book));
  document.getElementById('drawer-kroger-settings')?.addEventListener('click', () => {
    menuMarket.classList.add('hidden');
    openKrogerSettingsModal();
  });
}

btnMarketMenu?.addEventListener('click', (e) => {
  e.stopPropagation();
  const wasOpen = !menuMarket.classList.contains('hidden');
  if (typeof closeAllMenus === 'function') closeAllMenus();
  if (!wasOpen) {
    menuMarket.classList.remove('hidden');
    renderGlobalMarketMenu();
  }
});

// Listen for OAuth completion popup or redirect param
window.addEventListener('message', (e) => {
  if (e.origin === window.location.origin && e.data && e.data.type === 'kroger-auth-done') {
    fetchKrogerStatus().then(() => {
      if (!krogerSettingsModal?.classList.contains('hidden')) renderKrogerSettingsModal();
      showToast('Kroger account connected!');
    });
  }
});

window.addEventListener('DOMContentLoaded', () => {
  fetchKrogerStatus();
  updateGlobalMarketMenuUI();
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kroger') === 'connected') {
      showToast('Kroger account connected!');
      params.delete('kroger');
      const nextUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
      window.history.replaceState({}, '', nextUrl);
    }
  } catch (err) {}
});
