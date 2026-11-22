'use strict';

// ============================================================
// 10. RECIPE BOOK FORMAT, URL AUTO-IMPORTER & KROGER MATCHER
// ============================================================

const recipeUiState = {
  scale: 1,
  rightTab: 'directions', // 'directions' | 'notes'
  mobileTab: 'ingredients', // 'ingredients' | 'directions' | 'notes'
  stampPickerOpen: false,
  importing: false,
  importUrl: '',
  importError: '',
  checkedIngredients: {}, // `${recipeId}:${ingId}` -> boolean
  checkedSteps: {},       // `${recipeId}:${stepId}` -> boolean
  activeTimer: null,      // { label, remainingSec, intervalId }
  // Kroger Ingredient Matcher Modal state
  sendModalRecipe: null,
  sendModalScale: 1,
  sendTargetKey: '', // `${bookId}::${listId}`
  matcherByIng: {}   // ingId -> { include, loading, error, query, results: [], chosenUpc: string | 'manual' }
};

function getActiveRecipeCard(rb) {
  if (!rb || !Array.isArray(rb.recipes) || rb.recipes.length === 0) return null;
  return rb.recipes.find(r => r.id === rb.activeRecipeId) || rb.recipes[0];
}

function fmtRecipeQty(val) {
  if (val == null || Number.isNaN(val)) return '';
  const rounded = Math.round(val * 8) / 8;
  const whole = Math.floor(rounded);
  const frac = +(rounded - whole).toFixed(3);
  const fracMap = { 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' };
  const fracStr = fracMap[frac] || (frac > 0 ? String(frac).replace(/^0/, '') : '');
  if (whole > 0 && fracStr) return `${whole} ${fracStr}`;
  if (whole > 0) return String(whole);
  return fracStr || '0';
}

function parseQuickIngredientClient(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let rest = s;
  let qty = 1;
  let hasExplicitQty = false;
  let unit = '';
  const mQty = rest.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+/);
  if (mQty) {
    const qStr = mQty[1].trim();
    const mixed = qStr.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    const frac = qStr.match(/^(\d+)\/(\d+)$/);
    if (mixed) qty = parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
    else if (frac) qty = parseInt(frac[1], 10) / parseInt(frac[2], 10);
    else qty = parseFloat(qStr) || 1;
    hasExplicitQty = true;
    rest = rest.slice(mQty[0].length).trim();
  }
  const mUnit = rest.match(/^(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|cloves?|cans?|pkgs?|packages?|bags?|bunches?|heads?|slices?|stalks?|sticks?|jars?|bottles?|boxes?|pints?|quarts?)\b\.?\s+/i);
  if (mUnit) {
    unit = mUnit[1].replace(/\.$/, '');
    rest = rest.slice(mUnit[0].length).trim();
  }
  return {
    id: uid('ri'),
    qty: +qty.toFixed(3),
    hasExplicitQty,
    unit,
    name: rest || s,
    pantry: /\b(salt|pepper|water|olive oil|vegetable oil|flour|sugar|baking soda|baking powder)\b/i.test(rest || s)
  };
}

function detectStepTimerClient(text) {
  const m = String(text || '').match(/\b(\d{1,3})(?:\s*[-–to]+\s*\d{1,3})?\s*(?:minutes?|mins?)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 240) return n;
  }
  return null;
}

function cleanIngredientForKrogerQuery(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\b(fresh|freshly|finely|roughly|thinly|chopped|minced|diced|sliced|grated|shredded|melted|softened|cooked|uncooked|trimmed|halved|quartered|peeled|deveined|boneless|skinless|optional|to taste|divided|room temperature|packed|plus more.*)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48) || String(name || '').trim().slice(0, 48);
}

// Ensure a dietary/recipe stamp exists in state.stamps so it integrates with Card Index & Stamp Lens!
function ensureLibraryStampByLabel(label, color = '#4c7c53') {
  if (!Array.isArray(state.stamps)) state.stamps = deepClone(DEFAULT_STAMPS);
  const existing = state.stamps.find(s => s.label.toLowerCase() === String(label).toLowerCase());
  if (existing) return existing;
  const created = { id: uid('st'), label: String(label).trim(), color };
  state.stamps.push(created);
  return created;
}

function syncRecipeBookStampsToPages(book) {
  if (!book || !book.recipeBook || !Array.isArray(book.pages) || book.pages.length === 0) return;
  const allIds = new Set();
  for (const r of book.recipeBook.recipes || []) {
    for (const sid of r.stamps || []) allIds.add(sid);
  }
  book.pages[0].stamps = Array.from(allIds);
}

function startRecipeStepTimer(minutes, stepNum) {
  if (recipeUiState.activeTimer?.intervalId) {
    clearInterval(recipeUiState.activeTimer.intervalId);
  }
  recipeUiState.activeTimer = {
    label: `Step ${stepNum}`,
    remainingSec: Math.max(1, Math.round(minutes * 60)),
    intervalId: setInterval(() => {
      if (!recipeUiState.activeTimer) return;
      recipeUiState.activeTimer.remainingSec -= 1;
      if (recipeUiState.activeTimer.remainingSec <= 0) {
        clearInterval(recipeUiState.activeTimer.intervalId);
        recipeUiState.activeTimer = null;
        playCozySound?.('chime');
        showToast(`Step ${stepNum} timer finished!`);
      }
      updateRecipeTimerReadouts();
    }, 1000)
  };
  playCozySound?.('paper');
  renderOpenBook(false);
  showToast(`Started ${minutes} min timer for Step ${stepNum}`);
}

function stopRecipeStepTimer() {
  if (recipeUiState.activeTimer?.intervalId) {
    clearInterval(recipeUiState.activeTimer.intervalId);
  }
  recipeUiState.activeTimer = null;
  renderOpenBook(false);
}

function updateRecipeTimerReadouts() {
  document.querySelectorAll('.recipe-timer-pill').forEach(el => {
    if (!recipeUiState.activeTimer) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
      const m = Math.floor(recipeUiState.activeTimer.remainingSec / 60);
      const s = String(recipeUiState.activeTimer.remainingSec % 60).padStart(2, '0');
      el.textContent = `⏱ ${recipeUiState.activeTimer.label}: ${m}:${s} ×`;
    }
  });
}

async function importRecipeUrlIntoBook(book, rawUrl) {
  const url = String(rawUrl || '').trim();
  recipeUiState.importUrl = url;
  if (!url) {
    recipeUiState.importError = 'Paste a recipe URL (e.g. https://www.allrecipes.com/...)';
    renderOpenBook(false);
    return;
  }
  recipeUiState.importing = true;
  recipeUiState.importError = '';
  renderOpenBook(false);
  try {
    const resp = await fetch('/api/recipe/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Could not import recipe from that URL.');
    const imp = data.recipe;
    const pal = getPalette();
    const rb = book.recipeBook;

    // Resolve suggested dietary stamps into real Library Stamps
    const stampIds = [];
    for (const lbl of imp.suggestedStamps || []) {
      const preset = RECIPE_DIETARY_STAMP_PRESETS.find(p => p.label.toLowerCase() === lbl.toLowerCase());
      const st = ensureLibraryStampByLabel(lbl, preset?.color || '#4c7c53');
      if (st && !stampIds.includes(st.id)) stampIds.push(st.id);
    }

    const newCard = {
      id: uid('rc'),
      title: imp.title || 'Imported Recipe',
      sourceUrl: imp.sourceUrl || url,
      sourceHost: imp.sourceHost || '',
      imageUrl: imp.imageUrl || '',
      emoji: '🍽️',
      color: pal[rb.recipes.length % pal.length].id,
      prepMin: imp.prepMin || 0,
      cookMin: imp.cookMin || 0,
      baseServings: imp.baseServings || 4,
      stamps: stampIds,
      notes: imp.notes || '',
      ingredients: (imp.ingredients || []).map(i => ({
        id: uid('ri'),
        qty: i.qty || 1,
        hasExplicitQty: i.hasExplicitQty !== false,
        unit: i.unit || '',
        name: i.name || '',
        pantry: Boolean(i.pantry)
      })),
      steps: (imp.steps || []).map(st => ({
        id: uid('rs'),
        text: st.text || '',
        timerMin: st.timerMin || null
      }))
    };

    // If current recipe is a blank placeholder, replace it cleanly
    const cur = getActiveRecipeCard(rb);
    if (rb.recipes.length === 1 && cur && cur.ingredients.length === 0 && cur.steps.length === 0 && !cur.sourceUrl) {
      rb.recipes[0] = newCard;
    } else {
      rb.recipes.push(newCard);
    }
    rb.activeRecipeId = newCard.id;
    recipeUiState.scale = 1;
    recipeUiState.importUrl = '';
    syncRecipeBookStampsToPages(book);
    playCozySound?.('chime');
    commitChange();
    showToast(imp.partial
      ? `Imported title & photo for "${newCard.title}" — add ingredients & steps manually.`
      : `Imported "${newCard.title}" (${newCard.ingredients.length} ingredients, ${newCard.steps.length} steps)!`);
  } catch (err) {
    recipeUiState.importError = err.message || 'Import failed';
    renderOpenBook(false);
  } finally {
    recipeUiState.importing = false;
    renderOpenBook(false);
  }
}

// ============================================================
// OPEN BOOK MODAL RENDERER FOR RECIPE BOOKS
// ============================================================
function renderRecipeBookOpenBook(container, sw) {
  const { isCart, hall, book } = container;
  if (!book.recipeBook) book.recipeBook = createDefaultRecipeBookData();
  const rb = book.recipeBook;
  const rec = getActiveRecipeCard(rb);
  if (!rec) return;

  bookSpreadWrap.classList.toggle('recipe-mobile-tab-ingredients', recipeUiState.mobileTab === 'ingredients');
  bookSpreadWrap.classList.toggle('recipe-mobile-tab-directions', recipeUiState.mobileTab === 'directions');
  bookSpreadWrap.classList.toggle('recipe-mobile-tab-notes', recipeUiState.mobileTab === 'notes');

  const scaledServings = Math.max(1, Math.round((rec.baseServings || 4) * recipeUiState.scale));
  const allLibraryStamps = getStamps();
  const appliedStamps = (rec.stamps || []).map(id => allLibraryStamps.find(s => s.id === id)).filter(Boolean);

  const mobileTabBarHtml = `
    <div class="flex md:hidden items-center gap-1 mb-2.5 p-1 rounded-xl" style="background:#efe3cc; border:1.5px solid #c5ab86;">
      ${[
        ['ingredients', `Ingredients (${rec.ingredients.length})`],
        ['directions', `Directions (${rec.steps.length})`],
        ['notes', `Notes`]
      ].map(([id, lbl]) => `
        <button type="button" data-rec-mob-tab="${id}" class="flex-1 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border-0"
          style="background:${recipeUiState.mobileTab === id ? '#fffdf7' : 'transparent'}; color:${recipeUiState.mobileTab === id ? '#362316' : '#7a5c44'};">${lbl}</button>
      `).join('')}
    </div>
  `;

  // Build stamp picker options: existing library stamps + missing dietary presets
  const existingLabelsLower = new Set(allLibraryStamps.map(s => s.label.toLowerCase()));
  const missingPresets = RECIPE_DIETARY_STAMP_PRESETS.filter(p => !existingLabelsLower.has(p.label.toLowerCase()));

  // ---- LEFT PAGE: URL IMPORTER, RECIPE HEADER, STAMPS, SCALER & INGREDIENTS ----
  bookLeftEl.innerHTML = `
    ${mobileTabBarHtml}
    <div class="pb-2.5 border-b space-y-2" style="border-color:rgba(122,92,68,0.22);">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="library-stamp shrink-0" style="color:#c96843;">Recipe Book</span>
          <input id="rec-book-title" type="text" value="${esc(book.title)}" class="font-storybook font-bold text-sm bg-transparent border-0 outline-none min-w-0 flex-1" style="color:#5e4430;" />
        </div>
      </div>

      <!-- URL Auto-Fill Bar -->
      <form id="rec-import-form" class="flex gap-1.5">
        <input id="rec-import-url" type="url" value="${esc(recipeUiState.importUrl)}" placeholder="Paste recipe URL to auto-fill…" class="market-paper-input flex-1 rounded-xl px-2.5 py-1 text-xs" />
        <button type="submit" ${recipeUiState.importing ? 'disabled' : ''} class="rounded-xl px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0 disabled:opacity-50" style="background:#c96843; color:#fffaf2; border:1.5px solid #3c2516;">
          ${recipeUiState.importing ? 'Importing…' : '&#10024; Import URL'}
        </button>
      </form>
      ${recipeUiState.importError ? `<div class="rounded-xl px-2.5 py-1.5 text-[11px] font-semibold" style="background:#fbe3df; color:#a33728; border:1px solid #e0a79e;">${esc(recipeUiState.importError)}</div>` : ''}

      <!-- Recipe Card Banner -->
      <div class="rounded-2xl p-2.5 flex items-center gap-2.5" style="background:#f5ebd7; border:1.5px solid #d7c3a1;">
        <div class="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0" style="background:#fffdf8; border:1.5px solid #c5ab86;">
          ${rec.imageUrl
            ? `<img src="${esc(rec.imageUrl)}" alt="" class="w-full h-full object-cover" loading="lazy" />`
            : `<span class="text-2xl">${esc(rec.emoji || '🍽️')}</span>`}
        </div>
        <div class="min-w-0 flex-1 space-y-1">
          <input id="rec-card-title" type="text" value="${esc(rec.title)}" placeholder="Recipe Title…" class="font-storybook font-bold text-base bg-transparent border-0 outline-none w-full" style="color:#2d1a0f;" />
          <div class="flex flex-wrap items-center gap-2 text-[11px]" style="color:#7a5c44;">
            <label class="flex items-center gap-1">Prep <input id="rec-prep-min" type="number" min="0" max="999" value="${rec.prepMin}" class="w-11 rounded-md px-1 py-0.2 text-center font-mono text-[11px] market-paper-input" />m</label>
            <label class="flex items-center gap-1">Cook <input id="rec-cook-min" type="number" min="0" max="999" value="${rec.cookMin}" class="w-11 rounded-md px-1 py-0.2 text-center font-mono text-[11px] market-paper-input" />m</label>
            ${rec.sourceUrl ? `<a href="${esc(rec.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="underline font-semibold truncate max-w-[130px]" style="color:#0d47a1;">${esc(rec.sourceHost || 'Source')}</a>` : ''}
          </div>
        </div>
      </div>

      <!-- Library Stamps (Vegetarian, Keto, Gluten-Free, etc.) -->
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          ${appliedStamps.map(st => `
            <button type="button" data-rec-toggle-stamp="${st.id}" title="Click to remove ${esc(st.label)} stamp"
              class="library-stamp cursor-pointer bg-transparent" style="color:${st.color}; background:${st.color}14;">
              <span>${esc(st.label)}</span>
              <span class="opacity-65">&times;</span>
            </button>
          `).join('')}
          <button id="rec-stamp-picker-btn" type="button" class="px-2 py-0.5 rounded-lg text-[10.5px] font-bold cursor-pointer" style="background:#f3e8d2; color:#5e4430; border:1.2px dashed #a88762;">
            ${recipeUiState.stampPickerOpen ? 'Done' : '+ Stamp'}
          </button>
        </div>
        ${recipeUiState.stampPickerOpen ? `
          <div class="rounded-xl p-2 flex flex-wrap gap-1.5" style="background:#f5ebd7; border:1.2px solid #d7c3a1;">
            ${allLibraryStamps.map(st => {
              const has = (rec.stamps || []).includes(st.id);
              return `
                <button type="button" data-rec-toggle-stamp="${st.id}" class="library-stamp cursor-pointer"
                  style="color:${st.color}; background:${has ? st.color + '26' : '#fffdf8'}; opacity:${has ? '1' : '0.75'};">
                  ${has ? '&#10003; ' : '+ '}${esc(st.label)}
                </button>
              `;
            }).join('')}
            ${missingPresets.map(pr => `
              <button type="button" data-rec-add-preset="${esc(pr.label)}|${esc(pr.color)}" class="library-stamp cursor-pointer"
                style="color:${pr.color}; background:#fffdf8; opacity:0.8;">
                + ${esc(pr.label)}
              </button>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Servings Scaler & Send to Shopping List -->
      <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-bold" style="color:#2d1a0f;">Servings: ${scaledServings}</span>
          <div class="flex rounded-xl p-0.5" style="background:#efe3cc; border:1.5px solid #c5ab86;">
            ${[0.5, 1, 2, 3].map(mult => `
              <button type="button" data-rec-scale="${mult}" class="px-2 py-0.5 rounded-lg text-[10.5px] font-bold cursor-pointer border-0"
                style="background:${recipeUiState.scale === mult ? '#c96843' : 'transparent'}; color:${recipeUiState.scale === mult ? '#fffaf2' : '#5e4430'};">${mult}x</button>
            `).join('')}
          </div>
        </div>
        <button id="rec-send-to-market" type="button" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer transition-transform hover:scale-105"
          style="background:#4f7c54; color:#fffaf2; border:1.5px solid #2d5a34;">
          &#128722; Send to Shopping List
        </button>
      </div>
    </div>

    <!-- Ingredients List + Quick Add -->
    <div class="flex-1 overflow-y-auto nice-scroll pt-2.5 pr-1 space-y-1.5">
      <div class="text-[11px] font-storybook font-bold uppercase tracking-wider" style="color:#7a5c44;">Ingredients (${rec.ingredients.length})</div>
      ${rec.ingredients.length === 0 ? `
        <div class="text-center py-6 text-xs" style="color:#7a5c44;">Paste a recipe URL above to auto-fill, or add ingredients below!</div>
      ` : rec.ingredients.map(ing => {
        const key = `${rec.id}:${ing.id}`;
        const checked = Boolean(recipeUiState.checkedIngredients[key]);
        const scaled = (ing.qty || 1) * recipeUiState.scale;
        return `
          <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl transition-opacity ${checked ? 'opacity-55' : ''}"
            style="background:#fffdf8; border:1.4px solid ${checked ? '#dfd1b8' : '#d7c3a1'};">
            <label class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
              <input type="checkbox" data-rec-ing-chk="${key}" ${checked ? 'checked' : ''} class="w-4 h-4 accent-[#4f7c54] shrink-0" />
              <span class="text-xs leading-snug ${checked ? 'line-through' : ''}" style="color:#2d1a0f;">
                ${ing.hasExplicitQty !== false ? `<strong class="font-mono" style="color:#c96843;">${fmtRecipeQty(scaled)}${ing.unit ? ' ' + esc(ing.unit) : ''}</strong> ` : ''}
                <span>${esc(ing.name)}</span>
              </span>
            </label>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" data-rec-ing-pantry="${ing.id}" title="Toggle Pantry Staple (unchecked by default when sending to shopping list)"
                class="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full cursor-pointer border-0"
                style="background:${ing.pantry ? '#efe5d2' : 'transparent'}; color:${ing.pantry ? '#7a5c44' : '#b59d82'};">
                ${ing.pantry ? 'Pantry' : '·'}
              </button>
              <button type="button" data-rec-ing-del="${ing.id}" title="Remove ingredient" class="w-5 h-5 rounded text-xs font-bold bg-transparent border-0 cursor-pointer hover:text-red-700" style="color:#8f7054;">&times;</button>
            </div>
          </div>
        `;
      }).join('')}

      <form id="rec-add-ing-form" class="flex gap-1.5 pt-1">
        <input id="rec-add-ing-input" type="text" placeholder="+ Add ingredient (e.g. 2 cups baby spinach)…" class="market-paper-input flex-1 rounded-xl px-2.5 py-1.5 text-xs" />
        <button type="submit" class="rounded-xl px-2.5 py-1.5 text-xs font-bold cursor-pointer" style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">Add</button>
      </form>
    </div>

    <div class="pt-2.5 mt-2 border-t flex items-center justify-between gap-2 flex-wrap" style="border-color:rgba(122,92,68,0.2);">
      <button id="open-jump-hall" class="text-xs font-semibold hover:underline bg-transparent border-0 p-0 cursor-pointer" style="color:#78573d;">&larr; ${isCart ? 'Sorting Pile' : 'Edit ' + esc(truncate(hall.title, 16))}</button>
      <button id="open-del-book" class="text-[11px] font-semibold px-2.5 py-1 rounded-xl cursor-pointer bg-transparent border border-red-400/50 text-red-700 hover:bg-red-500/10">Delete Book</button>
    </div>
  `;

  // ---- RIGHT PAGE: FULL-HEIGHT DIRECTIONS + SEPARATE CHEF'S NOTES TAB ----
  const showNotes = recipeUiState.rightTab === 'notes' || recipeUiState.mobileTab === 'notes';
  bookRightEl.innerHTML = `
    ${mobileTabBarHtml}
    <div class="flex items-center justify-between gap-2 pb-2.5 border-b flex-wrap" style="border-color:rgba(122,92,68,0.22);">
      <div class="flex rounded-xl p-0.5" style="background:#efe3cc; border:1.5px solid #c5ab86;">
        <button type="button" data-rec-right-tab="directions" class="px-3 py-1 rounded-lg text-xs font-storybook font-bold cursor-pointer border-0"
          style="background:${!showNotes ? '#fffdf7' : 'transparent'}; color:${!showNotes ? '#2d1a0f' : '#7a5c44'};">Directions</button>
        <button type="button" data-rec-right-tab="notes" class="px-3 py-1 rounded-lg text-xs font-storybook font-bold cursor-pointer border-0"
          style="background:${showNotes ? '#fffdf7' : 'transparent'}; color:${showNotes ? '#2d1a0f' : '#7a5c44'};">Chef's Notes</button>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" id="rec-stop-timer" title="Click to stop timer" class="recipe-timer-pill ${recipeUiState.activeTimer ? '' : 'hidden'} px-2.5 py-1 rounded-full text-[11px] font-mono font-bold cursor-pointer border-0" style="background:#c96843; color:#fffaf2;"></button>
        ${rb.recipes.length > 1 ? `<button id="rec-del-card" type="button" title="Delete this recipe card" class="rounded-xl px-2 py-1 text-[11px] font-bold cursor-pointer bg-transparent border border-red-400/50 text-red-700">&times;</button>` : ''}
      </div>
    </div>

    <div class="flex-1 overflow-y-auto nice-scroll pt-3 pr-1 space-y-2.5">
      ${!showNotes ? `
        ${rec.steps.length === 0 ? `
          <div class="text-center py-10 text-xs" style="color:#7a5c44;">No cooking directions yet — import from a URL or add steps below!</div>
        ` : rec.steps.map((st, idx) => {
          const key = `${rec.id}:${st.id}`;
          const done = Boolean(recipeUiState.checkedSteps[key]);
          return `
            <div class="rounded-2xl p-3 transition-all ${done ? 'opacity-55' : ''}" style="background:#fffdf8; border:1.5px solid ${done ? '#dfd1b8' : '#d7c3a1'};">
              <div class="flex items-start gap-2.5">
                <button type="button" data-rec-step-chk="${key}" title="Tap to check off step"
                  class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 cursor-pointer mt-0.5"
                  style="background:${done ? '#4f7c54' : '#f3e8d2'}; color:${done ? '#fffaf2' : '#362316'}; border:1.5px solid ${done ? '#2d5a34' : '#c5ab86'};">
                  ${done ? '&#10003;' : idx + 1}
                </button>
                <div class="flex-1 min-w-0 space-y-1.5">
                  <p class="text-[13px] leading-relaxed ${done ? 'line-through' : ''}" style="color:#2d1a0f;">${esc(st.text)}</p>
                  ${st.timerMin ? `
                    <button type="button" data-rec-start-timer="${st.timerMin}|${idx + 1}"
                      class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold cursor-pointer"
                      style="background:#fdf0d5; color:#9a6210; border:1px solid #d6b672;">
                      &#9201; Start ${st.timerMin} min timer
                    </button>
                  ` : ''}
                </div>
                <button type="button" data-rec-step-del="${st.id}" title="Remove step" class="w-5 h-5 rounded text-xs font-bold bg-transparent border-0 cursor-pointer hover:text-red-700 shrink-0" style="color:#8f7054;">&times;</button>
              </div>
            </div>
          `;
        }).join('')}

        <form id="rec-add-step-form" class="flex gap-1.5 pt-1">
          <input id="rec-add-step-input" type="text" placeholder="+ Add cooking step (include e.g. '12 minutes' for auto-timer)…" class="market-paper-input flex-1 rounded-xl px-2.5 py-1.5 text-xs" />
          <button type="submit" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer" style="background:#f3e8d2; color:#362316; border:1.5px solid #c5ab86;">Add</button>
        </form>
      ` : `
        <div class="space-y-3">
          <div class="space-y-1">
            <label class="text-xs font-storybook font-bold" style="color:#5e4430;">Chef's Notes &amp; Variations</label>
            <textarea id="rec-notes-input" rows="8" placeholder="Add tweaks, substitutions, pairing ideas, or family notes…" class="market-paper-input w-full rounded-2xl p-3 text-xs leading-relaxed resize-y">${esc(rec.notes || '')}</textarea>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div class="space-y-1">
              <label class="text-[11px] font-bold" style="color:#5e4430;">Base Servings</label>
              <input id="rec-base-servings" type="number" min="1" max="100" value="${rec.baseServings || 4}" class="market-paper-input w-full rounded-xl px-2.5 py-1.5 text-xs" />
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-bold" style="color:#5e4430;">Recipe Photo URL</label>
              <input id="rec-image-url" type="url" value="${esc(rec.imageUrl || '')}" placeholder="https://…" class="market-paper-input w-full rounded-xl px-2.5 py-1.5 text-xs" />
            </div>
          </div>
          <div class="space-y-1 text-xs">
            <label class="text-[11px] font-bold" style="color:#5e4430;">Source URL</label>
            <input id="rec-source-url" type="url" value="${esc(rec.sourceUrl || '')}" placeholder="https://…" class="market-paper-input w-full rounded-xl px-2.5 py-1.5 text-xs" />
          </div>
        </div>
      `}
    </div>
  `;

  // ---- RIGHT-EDGE CHAPTER TABS (ALL RECIPES IN THIS BOOK) ----
  const pal = getPalette();
  bookChapterTabsEl.innerHTML = `
    ${rb.recipes.map((r, idx) => {
      const isAct = r.id === rec.id;
      const csw = getSwatch(r.color || pal[idx % pal.length].id);
      const tot = (r.prepMin || 0) + (r.cookMin || 0);
      return `
        <button type="button" data-rec-tab-card="${r.id}"
          class="chapter-tab-btn text-left px-3 py-2 cursor-pointer transition-transform ${isAct ? 'translate-x-1.5 shadow-md' : 'opacity-90 hover:translate-x-1'}"
          style="background:${isAct ? csw.fill : '#f3e8d2'}; color:${isAct ? '#fffaf2' : '#362316'}; border:2px solid #3c2516; border-left:0; border-radius:0 12px 12px 0;">
          <div class="font-storybook font-bold text-xs truncate">${esc(r.title)}</div>
          <div class="text-[10px] opacity-85">${tot > 0 ? `${tot} min` : `${(r.ingredients || []).length} ing.`}</div>
        </button>
      `;
    }).join('')}
    <button id="rec-add-card-tab" type="button"
      class="text-left px-3 py-1.5 cursor-pointer text-[11px] font-bold"
      style="background:#fffaf0; color:#5e4430; border:2px dashed #8a6544; border-left:0; border-radius:0 12px 12px 0;">
      + New Recipe
    </button>
  `;
  bookBottomRibbonsEl.innerHTML = '';
  updateRecipeTimerReadouts();

  // ---- WIRE EVENTS ----
  const bindMobTabs = (root) => {
    root.querySelectorAll('[data-rec-mob-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.recMobTab;
        recipeUiState.mobileTab = t;
        if (t === 'directions') recipeUiState.rightTab = 'directions';
        if (t === 'notes') recipeUiState.rightTab = 'notes';
        renderOpenBook(false);
      });
    });
  };
  bindMobTabs(bookLeftEl);
  bindMobTabs(bookRightEl);

  document.getElementById('rec-book-title')?.addEventListener('input', e => {
    book.title = e.target.value;
    persistState();
    renderMap();
  });
  document.getElementById('rec-book-title')?.addEventListener('change', () => pushHistory());

  document.getElementById('rec-import-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const val = document.getElementById('rec-import-url')?.value || '';
    importRecipeUrlIntoBook(book, val);
  });

  document.getElementById('rec-card-title')?.addEventListener('input', e => {
    rec.title = e.target.value;
    persistState();
  });
  document.getElementById('rec-card-title')?.addEventListener('change', () => { pushHistory(); renderOpenBook(false); });
  document.getElementById('rec-prep-min')?.addEventListener('change', e => { rec.prepMin = Math.max(0, parseInt(e.target.value, 10) || 0); commitChange(); });
  document.getElementById('rec-cook-min')?.addEventListener('change', e => { rec.cookMin = Math.max(0, parseInt(e.target.value, 10) || 0); commitChange(); });

  document.getElementById('rec-stamp-picker-btn')?.addEventListener('click', () => {
    recipeUiState.stampPickerOpen = !recipeUiState.stampPickerOpen;
    renderOpenBook(false);
  });
  bookLeftEl.querySelectorAll('[data-rec-toggle-stamp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset.recToggleStamp;
      if (!Array.isArray(rec.stamps)) rec.stamps = [];
      if (rec.stamps.includes(sid)) rec.stamps = rec.stamps.filter(x => x !== sid);
      else rec.stamps.push(sid);
      syncRecipeBookStampsToPages(book);
      commitChange();
    });
  });
  bookLeftEl.querySelectorAll('[data-rec-add-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [label, color] = btn.dataset.recAddPreset.split('|');
      const st = ensureLibraryStampByLabel(label, color);
      if (!Array.isArray(rec.stamps)) rec.stamps = [];
      if (!rec.stamps.includes(st.id)) rec.stamps.push(st.id);
      syncRecipeBookStampsToPages(book);
      commitChange();
      showToast(`Added "${st.label}" stamp!`);
    });
  });

  bookLeftEl.querySelectorAll('[data-rec-scale]').forEach(btn => {
    btn.addEventListener('click', () => {
      recipeUiState.scale = parseFloat(btn.dataset.recScale) || 1;
      renderOpenBook(false);
    });
  });

  document.getElementById('rec-send-to-market')?.addEventListener('click', () => openRecipeSendModal(rec, recipeUiState.scale));

  bookLeftEl.querySelectorAll('[data-rec-ing-chk]').forEach(el => {
    el.addEventListener('change', () => {
      recipeUiState.checkedIngredients[el.dataset.recIngChk] = el.checked;
      renderOpenBook(false);
    });
  });
  bookLeftEl.querySelectorAll('[data-rec-ing-pantry]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ing = rec.ingredients.find(x => x.id === btn.dataset.recIngPantry);
      if (ing) { ing.pantry = !ing.pantry; commitChange(); }
    });
  });
  bookLeftEl.querySelectorAll('[data-rec-ing-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      rec.ingredients = rec.ingredients.filter(x => x.id !== btn.dataset.recIngDel);
      commitChange();
    });
  });
  document.getElementById('rec-add-ing-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const inp = document.getElementById('rec-add-ing-input');
    const parsed = parseQuickIngredientClient(inp?.value || '');
    if (!parsed) return;
    rec.ingredients.push(parsed);
    inp.value = '';
    commitChange();
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

  bookRightEl.querySelectorAll('[data-rec-right-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      recipeUiState.rightTab = btn.dataset.recRightTab;
      if (recipeUiState.mobileTab !== 'ingredients') recipeUiState.mobileTab = btn.dataset.recRightTab;
      renderOpenBook(false);
    });
  });
  document.getElementById('rec-stop-timer')?.addEventListener('click', () => stopRecipeStepTimer());
  document.getElementById('rec-del-card')?.addEventListener('click', () => {
    if (rb.recipes.length <= 1) return;
    if (!confirm(`Delete recipe "${rec.title}"?`)) return;
    rb.recipes = rb.recipes.filter(r => r.id !== rec.id);
    rb.activeRecipeId = rb.recipes[0].id;
    syncRecipeBookStampsToPages(book);
    commitChange();
  });
  bookRightEl.querySelectorAll('[data-rec-step-chk]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.recStepChk;
      recipeUiState.checkedSteps[k] = !recipeUiState.checkedSteps[k];
      renderOpenBook(false);
    });
  });
  bookRightEl.querySelectorAll('[data-rec-start-timer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [mins, num] = btn.dataset.recStartTimer.split('|').map(Number);
      startRecipeStepTimer(mins, num);
    });
  });
  bookRightEl.querySelectorAll('[data-rec-step-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      rec.steps = rec.steps.filter(s => s.id !== btn.dataset.recStepDel);
      commitChange();
    });
  });
  document.getElementById('rec-add-step-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const inp = document.getElementById('rec-add-step-input');
    const txt = (inp?.value || '').trim();
    if (!txt) return;
    rec.steps.push({ id: uid('rs'), text: txt, timerMin: detectStepTimerClient(txt) });
    inp.value = '';
    commitChange();
  });

  document.getElementById('rec-notes-input')?.addEventListener('input', e => { rec.notes = e.target.value; persistState(); });
  document.getElementById('rec-notes-input')?.addEventListener('change', () => pushHistory());
  document.getElementById('rec-base-servings')?.addEventListener('change', e => { rec.baseServings = Math.max(1, parseInt(e.target.value, 10) || 4); commitChange(); });
  document.getElementById('rec-image-url')?.addEventListener('change', e => { rec.imageUrl = e.target.value.trim(); commitChange(); });
  document.getElementById('rec-source-url')?.addEventListener('change', e => {
    rec.sourceUrl = e.target.value.trim();
    try { rec.sourceHost = rec.sourceUrl ? new URL(rec.sourceUrl).hostname.replace(/^www\./i, '') : ''; } catch (err) { rec.sourceHost = ''; }
    commitChange();
  });

  bookChapterTabsEl.querySelectorAll('[data-rec-tab-card]').forEach(btn => {
    btn.addEventListener('click', () => {
      rb.activeRecipeId = btn.dataset.recTabCard;
      recipeUiState.scale = 1;
      recipeUiState.stampPickerOpen = false;
      commitChange();
    });
  });
  document.getElementById('rec-add-card-tab')?.addEventListener('click', () => {
    const newCard = createEmptyRecipeCard(`Recipe ${rb.recipes.length + 1}`);
    newCard.color = pal[rb.recipes.length % pal.length].id;
    rb.recipes.push(newCard);
    rb.activeRecipeId = newCard.id;
    recipeUiState.scale = 1;
    commitChange();
  });
}

// ============================================================
// RECIPE -> KROGER API INGREDIENT MATCHER MODAL
// ============================================================
const recipeSendModal = document.getElementById('recipe-send-modal');
const recipeSendCard = document.getElementById('recipe-send-card');

function closeRecipeSendModal() {
  recipeSendModal?.classList.add('hidden');
}

function getAllMarketListTargets() {
  const targets = [];
  if (typeof getAllMarketLedgers === 'function') {
    for (const entry of getAllMarketLedgers()) {
      for (const list of entry.book.marketLedger?.lists || []) {
        targets.push({
          key: `${entry.book.id}::${list.id}`,
          book: entry.book,
          list,
          label: `${entry.book.title} › ${list.name}`
        });
      }
    }
  }
  return targets;
}

async function searchKrogerForIngredient(ingId, customTerm = null) {
  const m = recipeUiState.matcherByIng[ingId];
  if (!m) return;
  if (customTerm !== null) m.query = customTerm.trim();
  if (!m.query || m.query.length < 2) return;
  if (typeof krogerState === 'undefined' || !krogerState.configured) {
    m.loading = false;
    m.results = [];
    m.chosenUpc = 'manual';
    renderRecipeSendModal();
    return;
  }
  m.loading = true;
  m.error = '';
  renderRecipeSendModal();
  try {
    const loc = krogerState.store?.locationId || '';
    const qs = new URLSearchParams({ term: m.query, limit: '4' });
    if (loc) qs.set('locationId', loc);
    const resp = await fetch(`/api/kroger/products?${qs.toString()}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Search failed');
    m.results = Array.isArray(data.products) ? data.products : [];
    m.chosenUpc = m.results[0] ? (m.results[0].upc || m.results[0].productId) : 'manual';
  } catch (err) {
    m.error = err.message || 'Kroger lookup failed';
    m.results = [];
    m.chosenUpc = 'manual';
  } finally {
    m.loading = false;
    renderRecipeSendModal();
  }
}

function openRecipeSendModal(recipe, scale = 1) {
  if (!recipeSendModal) return;
  if (!recipe.ingredients || recipe.ingredients.length === 0) {
    showToast('Add some ingredients to this recipe first!');
    return;
  }
  recipeUiState.sendModalRecipe = recipe;
  recipeUiState.sendModalScale = scale;
  const targets = getAllMarketListTargets();
  recipeUiState.sendTargetKey = targets[0]?.key || '';
  recipeUiState.matcherByIng = {};

  for (const ing of recipe.ingredients) {
    const q = cleanIngredientForKrogerQuery(ing.name);
    recipeUiState.matcherByIng[ing.id] = {
      include: !ing.pantry,
      loading: Boolean(typeof krogerState !== 'undefined' && krogerState.configured && !ing.pantry),
      error: '',
      query: q,
      results: [],
      chosenUpc: 'manual'
    };
  }

  recipeSendModal.classList.remove('hidden');
  renderRecipeSendModal();

  // Trigger parallel Kroger API lookups for all included ingredients
  if (typeof krogerState !== 'undefined' && krogerState.configured) {
    const toSearch = recipe.ingredients.filter(ing => !ing.pantry);
    // Run in small parallel batches of 4 to stay fast and polite to Kroger API
    (async () => {
      for (let i = 0; i < toSearch.length; i += 4) {
        const batch = toSearch.slice(i, i + 4);
        await Promise.all(batch.map(ing => searchKrogerForIngredient(ing.id)));
      }
    })();
  }
}

function renderRecipeSendModal() {
  if (!recipeSendCard || !recipeUiState.sendModalRecipe) return;
  const rec = recipeUiState.sendModalRecipe;
  const scale = recipeUiState.sendModalScale;
  const targets = getAllMarketListTargets();
  const krogerReady = typeof krogerState !== 'undefined' && krogerState.configured;

  let selectedCount = 0;
  let estTotal = 0;
  for (const ing of rec.ingredients) {
    const m = recipeUiState.matcherByIng[ing.id];
    if (!m?.include) continue;
    selectedCount += 1;
    const picked = m.results.find(p => (p.upc || p.productId) === m.chosenUpc);
    if (picked) {
      const eff = (typeof picked.promo === 'number' && picked.promo > 0) ? picked.promo : picked.price;
      if (typeof eff === 'number') estTotal += eff;
    }
  }

  recipeSendCard.innerHTML = `
    <div class="px-4 py-3 border-b flex items-center justify-between gap-2" style="border-color:var(--ui-border);">
      <div class="min-w-0">
        <div class="font-storybook font-bold text-base truncate" style="color:var(--ui-ink);">Match Kroger Products &amp; Send to List</div>
        <div class="text-[11px] truncate" style="color:var(--ui-muted);">
          ${esc(rec.title)} (${scale}x) ${krogerReady && krogerState.store ? `· ${esc(krogerState.store.name)}` : ''}
        </div>
      </div>
      <button id="rec-send-close" type="button" class="storybook-btn rounded-xl px-2.5 py-1 text-xs font-bold cursor-pointer">&times;</button>
    </div>

    <div class="px-4 py-2.5 border-b flex items-center justify-between gap-2 flex-wrap text-xs" style="border-color:var(--ui-border); background:var(--ui-surface-alt);">
      <label class="font-bold" style="color:var(--ui-ink);">Target Shopping List:</label>
      ${targets.length > 0 ? `
        <select id="rec-send-target-sel" class="storybook-input rounded-xl px-2.5 py-1 text-xs font-semibold cursor-pointer">
          ${targets.map(t => `<option value="${esc(t.key)}" ${t.key === recipeUiState.sendTargetKey ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>
      ` : `
        <span class="text-[11px] font-semibold" style="color:var(--ui-accent);">A new Market Ledger will be created automatically!</span>
      `}
    </div>

    ${!krogerReady ? `
      <div class="mx-4 mt-3 rounded-xl px-3 py-2 text-[11px] flex items-center justify-between gap-2" style="background:#fdf0d5; border:1px solid #d6b672; color:#5a3b14;">
        <span>Kroger API isn't configured yet — items will be added as plain text.</span>
        <button id="rec-send-kroger-cfg" type="button" class="underline font-bold cursor-pointer bg-transparent border-0" style="color:#8f3a1c;">Set Up Kroger</button>
      </div>
    ` : ''}

    <div class="p-4 space-y-2.5 overflow-y-auto nice-scroll flex-1">
      ${rec.ingredients.map(ing => {
        const m = recipeUiState.matcherByIng[ing.id];
        if (!m) return '';
        const scaled = (ing.qty || 1) * scale;
        return `
          <div class="rounded-2xl p-3 space-y-2 transition-opacity ${m.include ? '' : 'opacity-50'}" style="background:var(--ui-surface-solid); border:1.5px solid var(--ui-border);">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <label class="flex items-center gap-2 cursor-pointer text-xs font-bold min-w-0 flex-1" style="color:var(--ui-ink);">
                <input type="checkbox" data-rm-inc="${ing.id}" ${m.include ? 'checked' : ''} class="w-4 h-4 accent-[#4f7c54] shrink-0" />
                <span class="truncate">
                  ${ing.hasExplicitQty !== false ? `<span class="font-mono" style="color:var(--ui-accent);">${fmtRecipeQty(scaled)}${ing.unit ? ' ' + esc(ing.unit) : ''}</span> ` : ''}
                  ${esc(ing.name)}
                </span>
              </label>
              ${ing.pantry ? `<span class="text-[10px] font-semibold px-1.5 py-0.2 rounded-full shrink-0" style="background:var(--ui-surface-alt); color:var(--ui-muted);">Pantry</span>` : ''}
            </div>

            ${m.include && krogerReady ? `
              <div class="pl-6 space-y-1.5">
                <form data-rm-refine-form="${ing.id}" class="flex gap-1.5">
                  <input type="text" data-rm-refine-inp="${ing.id}" value="${esc(m.query)}" placeholder="Refine Kroger search…" class="storybook-input flex-1 rounded-lg px-2 py-0.5 text-[11px]" />
                  <button type="submit" ${m.loading ? 'disabled' : ''} class="storybook-btn rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer">
                    ${m.loading ? '…' : 'Search'}
                  </button>
                </form>

                ${m.loading ? `<div class="text-[11px] py-1" style="color:var(--ui-muted);">Searching Kroger…</div>` : ''}
                ${m.error ? `<div class="text-[11px] font-semibold text-red-600">${esc(m.error)}</div>` : ''}

                ${!m.loading && m.results.length > 0 ? m.results.map(p => {
                  const key = p.upc || p.productId;
                  const active = m.chosenUpc === key;
                  const hasPromo = typeof p.promo === 'number' && typeof p.price === 'number' && p.promo < p.price;
                  const eff = hasPromo ? p.promo : p.price;
                  return `
                    <button type="button" data-rm-pick="${ing.id}|${esc(key)}"
                      class="w-full text-left rounded-xl px-2.5 py-1.5 flex items-center gap-2 text-xs cursor-pointer transition-all"
                      style="background:${active ? '#e3f0e4' : 'var(--ui-surface-alt)'}; border:1.5px solid ${active ? '#4f7c54' : 'var(--ui-border)'}; color:#2d1a0f;">
                      ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" class="w-8 h-8 rounded-lg object-contain bg-white border border-amber-900/15 shrink-0" />` : ''}
                      <span class="min-w-0 flex-1">
                        <span class="font-bold block truncate">${active ? '● ' : '○ '}${esc(p.brand ? `${p.brand} — ${p.name}` : p.name)}</span>
                        <span class="text-[10.5px] opacity-75">${esc(p.size || '')}${p.aisle ? ` · ${esc(p.aisle)}` : ''}${p.stockLevel === 'TEMPORARILY_OUT_OF_STOCK' ? ' · Out of Stock' : ''}</span>
                      </span>
                      <span class="text-right shrink-0 font-mono font-bold tabular-nums">
                        ${hasPromo ? `<span style="color:#b54534;">$${p.promo.toFixed(2)}</span> <span class="text-[10px] line-through opacity-65">$${p.price.toFixed(2)}</span>` : (typeof eff === 'number' ? `$${eff.toFixed(2)}` : 'N/A')}
                      </span>
                    </button>
                  `;
                }).join('') : ''}

                <button type="button" data-rm-pick="${ing.id}|manual"
                  class="w-full text-left rounded-xl px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
                  style="background:${m.chosenUpc === 'manual' ? 'var(--ui-accent-soft)' : 'transparent'}; border:1px dashed var(--ui-border); color:var(--ui-muted);">
                  ${m.chosenUpc === 'manual' ? '● ' : '○ '}Add as plain text item (no Kroger link)
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>

    <div class="px-4 py-3 border-t flex items-center justify-between gap-2 flex-wrap" style="border-color:var(--ui-border); background:var(--ui-surface-alt);">
      <div class="text-xs" style="color:var(--ui-ink);">
        <strong>${selectedCount} item${selectedCount === 1 ? '' : 's'}</strong>
        ${estTotal > 0 ? `<span style="color:var(--ui-muted);"> &middot; Est. </span><strong class="font-mono">$${estTotal.toFixed(2)}</strong>` : ''}
      </div>
      <button id="rec-send-confirm" type="button" class="rounded-xl px-4 py-2 text-xs font-bold cursor-pointer" style="background:#4f7c54; color:#fffaf2; border:1.5px solid #2d5a34;">
        Add ${selectedCount} Item${selectedCount === 1 ? '' : 's'} to Shopping List
      </button>
    </div>
  `;

  document.getElementById('rec-send-close')?.addEventListener('click', closeRecipeSendModal);
  document.getElementById('rec-send-target-sel')?.addEventListener('change', e => {
    recipeUiState.sendTargetKey = e.target.value;
  });
  document.getElementById('rec-send-kroger-cfg')?.addEventListener('click', () => {
    closeRecipeSendModal();
    if (typeof openKrogerSettingsModal === 'function') openKrogerSettingsModal();
  });

  recipeSendCard.querySelectorAll('[data-rm-inc]').forEach(el => {
    el.addEventListener('change', () => {
      const id = el.dataset.rmInc;
      const m = recipeUiState.matcherByIng[id];
      if (!m) return;
      m.include = el.checked;
      if (m.include && krogerReady && m.results.length === 0 && !m.loading) {
        searchKrogerForIngredient(id);
      } else {
        renderRecipeSendModal();
      }
    });
  });

  recipeSendCard.querySelectorAll('[data-rm-refine-form]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const id = form.dataset.rmRefineForm;
      const inp = form.querySelector(`[data-rm-refine-inp="${id}"]`);
      searchKrogerForIngredient(id, inp?.value || '');
    });
  });

  recipeSendCard.querySelectorAll('[data-rm-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [id, upc] = btn.dataset.rmPick.split('|');
      if (recipeUiState.matcherByIng[id]) {
        recipeUiState.matcherByIng[id].chosenUpc = upc;
        renderRecipeSendModal();
      }
    });
  });

  document.getElementById('rec-send-confirm')?.addEventListener('click', () => {
    if (selectedCount === 0) {
      showToast('Select at least one ingredient to send.');
      return;
    }

    // Resolve target Market Ledger list (or auto-create a Market Ledger in the first Hall!)
    let targetList = null;
    let targetBook = null;
    const allTargets = getAllMarketListTargets();
    const chosen = allTargets.find(t => t.key === recipeUiState.sendTargetKey) || allTargets[0];
    if (chosen) {
      targetBook = chosen.book;
      targetList = chosen.list;
    } else if (state.halls?.[0]) {
      const hall = state.halls[0];
      const pal = getPalette();
      const sage = pal.find(s => s.id === 'sage') || pal[0];
      const chId = uid('ch');
      const pId = uid('p');
      targetBook = {
        id: uid('b'),
        itemType: 'book',
        title: 'Market Ledger',
        color: sage.id,
        pinned: false,
        summary: 'Shopping Lists & Kroger Price Lookup',
        marketLedger: createDefaultMarketLedgerData('Weekly Groceries'),
        chapters: [{ id: chId, title: 'Shopping Lists', color: sage.id }],
        pages: [{ id: pId, chapterId: chId, title: 'Market Ledger', stamps: [], properties: [], body: '', html: '' }]
      };
      hall.books.push(targetBook);
      targetList = targetBook.marketLedger.lists[0];
    }

    if (!targetList) {
      showToast('Create a Hall first to store a Market Ledger.');
      return;
    }

    let added = 0;
    const nowIso = new Date().toISOString();
    for (const ing of rec.ingredients) {
      const m = recipeUiState.matcherByIng[ing.id];
      if (!m?.include) continue;
      const picked = m.results.find(p => (p.upc || p.productId) === m.chosenUpc);
      if (picked) {
        const key = picked.upc || picked.productId;
        const existing = targetList.items.find(i => (i.upc && i.upc === key) || (i.productId && i.productId === key));
        if (existing) {
          existing.qty = Math.min(99, (existing.qty || 1) + 1);
          existing.checked = false;
        } else {
          targetList.items.push({
            id: uid('mi'),
            name: picked.name || ing.name,
            brand: picked.brand || '',
            size: picked.size || '',
            qty: 1,
            checked: false,
            note: `For ${rec.title}`,
            deal: '',
            upc: picked.upc || picked.productId || '',
            productId: picked.productId || picked.upc || '',
            price: typeof picked.price === 'number' ? picked.price : null,
            promo: typeof picked.promo === 'number' ? picked.promo : null,
            stockLevel: picked.stockLevel || 'UNKNOWN',
            aisle: picked.aisle || 'Grocery',
            imageUrl: picked.imageUrl || '',
            url: picked.url || '',
            updatedAt: nowIso
          });
        }
      } else {
        const scaled = (ing.qty || 1) * scale;
        const label = ing.hasExplicitQty !== false
          ? `${fmtRecipeQty(scaled)}${ing.unit ? ' ' + ing.unit : ''} ${ing.name}`.trim()
          : ing.name;
        targetList.items.push({
          id: uid('mi'),
          name: label,
          brand: '',
          size: '',
          qty: 1,
          checked: false,
          note: `For ${rec.title}`,
          deal: '',
          upc: '',
          productId: '',
          price: null,
          promo: null,
          stockLevel: 'UNKNOWN',
          aisle: 'Custom / Other',
          imageUrl: '',
          url: '',
          updatedAt: nowIso
        });
      }
      added += 1;
    }

    if (targetBook && targetBook.marketLedger) {
      targetBook.marketLedger.activeListId = targetList.id;
    }
    closeRecipeSendModal();
    playCozySound?.('chime');
    commitChange();
    showToast(`Added ${added} item${added === 1 ? '' : 's'} from "${rec.title}" to ${targetList.name}!`);
  });
}

recipeSendModal?.addEventListener('click', e => {
  if (e.target === recipeSendModal) closeRecipeSendModal();
});
