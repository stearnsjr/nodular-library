// ============================================================
// 10. SEARCH (LIVE GLOW ON HALLS, BOOKS, RIBBONS, STAMPS & PAGES), GLOBAL TASKS LEDGER, TEMPLATES, IO
// ============================================================
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const btnClearSearch = document.getElementById('btn-clear-search');

function clearSearch(focusInput = false) {
  searchInput.value = '';
  hopIndex = -1;
  btnClearSearch.classList.add('hidden');
  searchResults.classList.add('hidden');
  clearEditorSearchHighlights();
  if (searchMatches.active) {
    searchMatches = computeSearchMatches('');
    renderMap();
    if (openBookState.bookId) renderOpenBook(false);
  }
  if (focusInput) searchInput.focus();
}

function updateSearch(rawQuery, showDropdown = true) {
  const q = (rawQuery || '').trim().toLowerCase();
  hopIndex = -1;
  searchMatches = computeSearchMatches(rawQuery);
  btnClearSearch.classList.toggle('hidden', !q);
  renderMap();
  if (openBookState.bookId) renderOpenBook(false);

  if (!q) {
    searchResults.classList.add('hidden');
    return;
  }
  if (!showDropdown) return;

  const hits = [];

  // Match Cross-Reference Stamps
  getStamps().forEach(st => {
    if (st.label.toLowerCase().includes(q)) {
      const c = findPagesWithStamp(st.id).length;
      hits.push({ type: 'stamp', label: `Stamp: ${st.label}`, sub: `${c} stamped page${c === 1 ? '' : 's'} · Click to glow on map`, stampId: st.id, color: st.color });
    }
  });

  // Match Cross-Reference Ribbons
  (state.ribbons || []).forEach(rib => {
    const fromEntry = findBookEntry(rib.fromBookId);
    const toEntry = findBookEntry(rib.toBookId);
    if (!fromEntry || !toEntry) return;
    const labelHit = (rib.label || '').toLowerCase().includes(q);
    if (labelHit) {
      hits.push({
        type: 'ribbon',
        label: `Ribbon: ${rib.label}`,
        sub: `${fromEntry.book.title} ↔ ${toEntry.book.title}`,
        ribbonId: rib.id,
        fromBookId: rib.fromBookId,
        toBookId: rib.toBookId,
        color: getSwatch(rib.colorId).fill
      });
    }
  });

  forEachHall((h, depth, ancestors) => {
    const pathLabel = ancestors.length ? ancestors.map(a => a.title).join(' › ') : 'Main Hall';
    if (h.title.toLowerCase().includes(q)) {
      hits.push({ type: 'hall', label: h.title, sub: depth > 0 ? `Sub-Hall in ${pathLabel}` : 'Main Hall', hallId: h.id, color: getSwatch(h.color).fill });
    }
    h.books.forEach(b => {
      if (b.title.toLowerCase().includes(q) || (b.summary || '').toLowerCase().includes(q)) {
        hits.push({ type: 'book', label: b.title, sub: `Book in ${h.title}`, hallId: h.id, bookId: b.id, color: getSwatch(b.color || h.color).fill });
      }
      b.chapters.forEach(c => {
        if (c.title.toLowerCase().includes(q)) {
          const fp = b.pages.find(p => p.chapterId === c.id);
          hits.push({ type: 'chapter', label: c.title, sub: `Chapter in ${b.title}`, hallId: h.id, bookId: b.id, pageId: fp?.id || null, chapterId: c.id, color: getSwatch(c.color || b.color).fill });
        }
      });
      b.pages.forEach(p => {
        const stampMatch = (p.stamps || []).some(sid => (getStamp(sid)?.label || '').toLowerCase().includes(q));
        if (p.title.toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q) || stampMatch) {
          const firstSt = (p.stamps || []).map(getStamp).find(Boolean);
          hits.push({ type: 'page', label: p.title, sub: `Page in ${b.title}`, hallId: h.id, bookId: b.id, pageId: p.id, color: firstSt ? firstSt.color : getSwatch(b.color).fill });
        }
      });
    });
  });

  // Also match unfiled books & loose papers in the lower-right Sorting Pile
  (state.cart?.books || []).forEach(b => {
    if (b.title.toLowerCase().includes(q) || (b.summary || '').toLowerCase().includes(q)) {
      hits.push({ type: 'book', label: b.title, sub: 'Unfiled Book in Sorting Pile', hallId: CART_HALL_ID, bookId: b.id, color: getSwatch(b.color).fill });
    }
    b.pages.forEach(p => {
      if (p.title.toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q)) {
        hits.push({ type: 'page', label: p.title, sub: `Page in ${b.title} (Sorting Pile)`, hallId: CART_HALL_ID, bookId: b.id, pageId: p.id, color: getSwatch(b.color).fill });
      }
    });
  });
  (state.cart?.pages || []).forEach(p => {
    if ((p.title || '').toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q)) {
      hits.push({ type: 'cart-page', label: p.title, sub: 'Loose Paper in Sorting Pile', cartPageId: p.id, color: '#c96843' });
    }
  });

  const glowParts = [];
  if (searchMatches.hallIds.size) glowParts.push(`${searchMatches.hallIds.size} hall${searchMatches.hallIds.size === 1 ? '' : 's'}`);
  if (searchMatches.bookIds.size) glowParts.push(`${searchMatches.bookIds.size} book${searchMatches.bookIds.size === 1 ? '' : 's'}`);
  if (searchMatches.ribbonIds.size) glowParts.push(`${searchMatches.ribbonIds.size} ribbon${searchMatches.ribbonIds.size === 1 ? '' : 's'}`);

  const glowHeader = glowParts.length
    ? `<div class="px-2.5 py-1.5 mb-1 rounded-xl text-[11px] font-semibold flex items-center justify-between gap-2" style="background:var(--ui-accent-soft); color:var(--ui-accent);">
         <span class="truncate">&#10022; Glowing: ${glowParts.join(' · ')}</span>
         <button type="button" id="search-res-clear" class="text-[10px] underline bg-transparent border-0 p-0 cursor-pointer shrink-0" style="color:inherit;">Clear</button>
       </div>`
    : '';

  if (hits.length === 0) {
    searchResults.innerHTML = `<div class="px-3 py-2 text-xs" style="color:var(--ui-muted);">No matching halls, books, ribbons, stamps, or pages.</div>`;
  } else {
    searchResults.innerHTML = glowHeader + hits.slice(0, 14).map((hit, idx) => `
      <button data-hit="${idx}" class="w-full text-left px-2.5 py-2 rounded-xl text-xs hover:bg-black/5 flex items-center gap-2 cursor-pointer bg-transparent border-0" style="color:var(--ui-ink);">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${hit.color};"></span>
        <span class="flex flex-col min-w-0">
          <span class="font-semibold truncate">${esc(hit.label)}</span>
          <span class="text-[11px] truncate" style="color:var(--ui-muted);">${esc(hit.sub)}</span>
        </span>
      </button>
    `).join('');
    searchResults.querySelector('#search-res-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearSearch(false);
    });
    searchResults.querySelectorAll('[data-hit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const hit = hits[Number(btn.dataset.hit)];
        searchResults.classList.add('hidden');
        if (hit.type === 'stamp') {
          clearSearch(false);
          closeOpenBook();
          expandedIndexStampId = hit.stampId;
          activeStampLensId = null;
          setStampLens(hit.stampId);
          openCardIndex('stamps', false);
        } else if (hit.type === 'ribbon') {
          closeOpenBook();
          const b1 = layoutCache.books[hit.fromBookId];
          const b2 = layoutCache.books[hit.toBookId];
          if (b1 && b2) flyTo((b1.spineTopX + b2.spineTopX) / 2, (b1.spineTopY + b2.spineTopY) / 2, 0.72);
          openCardIndex('ribbons', false);
        } else if (hit.type === 'cart-page') {
          openLoosePaperCenter(hit.cartPageId);
        } else if (hit.type === 'hall') {
          closeOpenBook();
          if (expandAncestorsOfHall(hit.hallId, false)) renderMap();
          selectNode('hall', hit.hallId, true);
        } else {
          if (hit.hallId !== CART_HALL_ID && expandAncestorsOfHall(hit.hallId, true)) renderMap();
          const bg = layoutCache.books[hit.bookId];
          if (bg) flyTo(bg.bayGeom.x, bg.bayGeom.y, 0.92);
          openBookCenter(hit.hallId, hit.bookId, hit.pageId || null);
          if (hit.type === 'chapter' && hit.chapterId) selectChapterTab(hit.chapterId);
        }
      });
    });
  }
  searchResults.classList.remove('hidden');
}

searchInput.addEventListener('input', () => updateSearch(searchInput.value, true));
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) updateSearch(searchInput.value, true);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && searchMatches.active) {
    e.preventDefault();
    searchResults.classList.add('hidden');
    hopToGlowMatch(e.shiftKey ? -1 : 1);
  }
});
btnClearSearch.addEventListener('click', (e) => {
  e.stopPropagation();
  clearSearch(true);
});
document.getElementById('btn-hop-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  searchResults.classList.add('hidden');
  hopToGlowMatch(-1);
});
document.getElementById('btn-hop-next').addEventListener('click', (e) => {
  e.stopPropagation();
  searchResults.classList.add('hidden');
  hopToGlowMatch(1);
});

// Visual Stamp Lens floating banner controls
document.getElementById('btn-lens-prev').addEventListener('click', () => hopToGlowMatch(-1));
document.getElementById('btn-lens-next').addEventListener('click', () => hopToGlowMatch(1));
document.getElementById('btn-clear-lens').addEventListener('click', () => setStampLens(null));

// Lower-Right Corner Tabletop Controls (Sorting Pile of Papers & Books + 11-Book Study Table)
document.getElementById('btn-corner-pile-inspect').addEventListener('click', () => {
  if (selection.type === 'cart' && !inspPanel.classList.contains('hidden-panel')) clearSelection();
  else selectNode('cart', null, false);
});
document.getElementById('btn-corner-add-paper').addEventListener('click', (e) => {
  e.stopPropagation();
  createCartPage(true);
});
document.getElementById('btn-corner-add-book').addEventListener('click', (e) => {
  e.stopPropagation();
  createCartBook();
});
document.getElementById('btn-corner-study-inspect').addEventListener('click', () => {
  if (selection.type === 'study' && !inspPanel.classList.contains('hidden-panel')) clearSelection();
  else selectNode('study', null, false);
});
document.getElementById('btn-corner-study-putback')?.addEventListener('click', (e) => {
  e.stopPropagation();
  putAllStudyTableBooksBack();
});
document.getElementById('btn-toggle-tabletop').addEventListener('click', (e) => {
  e.stopPropagation();
  tabletopCollapsed = !tabletopCollapsed;
  renderCornerTabletop();
});

// Allow dragging a page from an Open Book's TOC or Corkboard directly onto the lower-right Sorting Pile
const cornerPileZoneEl = document.getElementById('corner-pile-zone');
cornerPileZoneEl.addEventListener('dragover', (e) => {
  if (!listDrag || listDrag.type !== 'page') return;
  e.preventDefault();
  cornerPileZoneEl.classList.add('tabletop-drop-active');
});
cornerPileZoneEl.addEventListener('dragleave', () => {
  cornerPileZoneEl.classList.remove('tabletop-drop-active');
});
cornerPileZoneEl.addEventListener('drop', (e) => {
  if (!listDrag || listDrag.type !== 'page') return;
  e.preventDefault();
  cornerPileZoneEl.classList.remove('tabletop-drop-active');
  const { hallId: fHallId, bookId: fBookId, id: fPageId } = listDrag;
  listDrag = null;
  moveBookPageToSortingPile(fHallId, fBookId, fPageId);
});

// Lower-Right Wicker Recycling Basket: click to inspect/restore, or drop pages/books/scrolls via HTML5 drag!
document.getElementById('btn-corner-recycle-inspect')?.addEventListener('click', () => {
  if (selection.type === 'trash' && !inspPanel.classList.contains('hidden-panel')) clearSelection();
  else selectNode('trash', null, false);
});
const cornerRecycleZoneEl = document.getElementById('corner-recycle-zone');
const isRecyclableListDrag = (d) => Boolean(d && (d.type === 'page' || d.type === 'insp-book' || d.type === 'study-stack'));
cornerRecycleZoneEl?.addEventListener('dragover', (e) => {
  if (!isRecyclableListDrag(listDrag)) return;
  e.preventDefault();
  cornerRecycleZoneEl.classList.add('recycle-drop-active');
});
cornerRecycleZoneEl?.addEventListener('dragleave', () => {
  cornerRecycleZoneEl.classList.remove('recycle-drop-active');
});
cornerRecycleZoneEl?.addEventListener('drop', (e) => {
  if (!isRecyclableListDrag(listDrag)) return;
  e.preventDefault();
  cornerRecycleZoneEl.classList.remove('recycle-drop-active');
  const drag = listDrag;
  listDrag = null;
  if (drag.type === 'page') {
    recycleBookPage(drag.hallId, drag.bookId, drag.id);
  } else if (drag.type === 'insp-book' || drag.type === 'study-stack') {
    const entry = findBookEntry(drag.id);
    recycleBook(drag.hallId || entry?.hall?.id, drag.id);
  }
});

// Collapsible Corner Floorplan Minimap controls
const minimapBody = document.getElementById('minimap-body');
const btnToggleMinimap = document.getElementById('btn-toggle-minimap');
const minimapSvg = document.getElementById('minimap-svg');

function applyMinimapCollapsedState() {
  minimapBody.classList.toggle('hidden', minimapCollapsed);
  btnToggleMinimap.innerHTML = minimapCollapsed ? '+' : '&minus;';
  if (!minimapCollapsed) renderMinimap();
}
btnToggleMinimap.addEventListener('click', () => {
  minimapCollapsed = !minimapCollapsed;
  applyMinimapCollapsedState();
});

let minimapDragging = false;
function panFromMinimapEvent(e, animate = false) {
  const rect = minimapSvg.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { scale, offX, offY } = minimapTransform;
  if (!scale) return;
  const wx = (mx - offX) / scale;
  const wy = (my - offY) / scale;
  if (animate) flyTo(wx, wy, null, 260);
  else {
    if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
    cam.x = -wx * cam.scale;
    cam.y = -wy * cam.scale;
    applyCamera();
  }
}
minimapSvg.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  minimapDragging = true;
  minimapSvg.setPointerCapture(e.pointerId);
  panFromMinimapEvent(e, false);
});
minimapSvg.addEventListener('pointermove', (e) => {
  if (!minimapDragging) return;
  panFromMinimapEvent(e, false);
});
minimapSvg.addEventListener('pointerup', (e) => {
  if (!minimapDragging) return;
  minimapDragging = false;
  try { minimapSvg.releasePointerCapture(e.pointerId); } catch (err) {}
});

// ---- UPPER-RIGHT GLOBAL LIBRARY TASKS DROPDOWN (AGGREGATES ALL TASKS ACROSS ALL BOOKS) ----
const menuTasks = document.getElementById('menu-tasks');
const btnTasksMenu = document.getElementById('btn-tasks-menu');
const tasksMenuBadge = document.getElementById('tasks-menu-badge');
let tasksMenuFilter = 'all'; // 'all' | 'open' | 'done'

function toggleGlobalLibraryTask(task) {
  let targetPage = null;
  if (task.isLoosePaper) {
    targetPage = (state.cart?.pages || []).find(p => p.id === task.pageId);
  } else if (task.hallId === CART_HALL_ID) {
    const cb = (state.cart?.books || []).find(b => b.id === task.bookId);
    targetPage = cb?.pages.find(p => p.id === task.pageId);
  } else {
    const entry = findBookEntry(task.bookId);
    targetPage = entry?.book?.pages.find(p => p.id === task.pageId);
  }
  if (!targetPage) return;

  // If this page is currently open in the active editor, toggle the live DOM checkbox and sync
  if (openBookState.pageId === targetPage.id &&
      ((task.isLoosePaper && openBookState.hallId === LOOSE_PAPER_MODE_ID) ||
       (!task.isLoosePaper && openBookState.bookId === task.bookId))) {
    const liveEditor = document.getElementById('open-page-editor');
    if (liveEditor) {
      const liveRows = liveEditor.querySelectorAll('.page-todo-item');
      const liveRow = liveRows[task.taskIndex];
      if (liveRow) {
        const next = liveRow.dataset.checked !== 'true';
        liveRow.dataset.checked = next ? 'true' : 'false';
        liveRow.querySelector('.page-todo-box')?.setAttribute('aria-checked', next ? 'true' : 'false');
        targetPage.html = liveEditor.innerHTML;
        targetPage.body = htmlToPlainText(liveEditor.innerHTML);
        persistState();
        pushHistory();
        updateGlobalTasksMenuUI();
        return;
      }
    }
  }

  const tmp = document.createElement('div');
  tmp.innerHTML = targetPage.html || '';
  const rows = tmp.querySelectorAll('.page-todo-item');
  const row = rows[task.taskIndex];
  if (!row) return;
  const next = row.dataset.checked !== 'true';
  row.dataset.checked = next ? 'true' : 'false';
  row.querySelector('.page-todo-box')?.setAttribute('aria-checked', next ? 'true' : 'false');
  targetPage.html = tmp.innerHTML;
  targetPage.body = htmlToPlainText(tmp.innerHTML);
  commitChange();
}

function renderGlobalTasksMenu() {
  if (!menuTasks) return;
  const allTasks = getAllLibraryTasks();
  const openTasks = allTasks.filter(t => !t.checked);
  const doneTasks = allTasks.filter(t => t.checked);
  const shown = tasksMenuFilter === 'open'
    ? openTasks
    : (tasksMenuFilter === 'done' ? doneTasks : allTasks);

  menuTasks.innerHTML = `
    <div class="flex items-center justify-between gap-2 pb-2 mb-2 border-b" style="border-color:var(--ui-border);">
      <div>
        <div class="font-storybook font-bold text-sm" style="color:var(--ui-ink);">Library Tasks Ledger</div>
        <div class="text-[11px]" style="color:var(--ui-muted);">${openTasks.length} open &middot; ${doneTasks.length} completed across all books</div>
      </div>
      <div class="flex items-center gap-1 rounded-xl p-0.5" style="background:var(--ui-surface-alt); border:1px solid var(--ui-border);">
        ${[
          ['all', `All (${allTasks.length})`],
          ['open', `Open (${openTasks.length})`],
          ['done', `Done (${doneTasks.length})`]
        ].map(([id, lbl]) => `
          <button type="button" data-task-filter="${id}" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer border-0 transition-colors"
                  style="background:${tasksMenuFilter === id ? 'var(--ui-surface)' : 'transparent'}; color:${tasksMenuFilter === id ? 'var(--ui-ink)' : 'var(--ui-muted)'};">${lbl}</button>
        `).join('')}
      </div>
    </div>
    <div class="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
      ${shown.map((t, idx) => {
        const bsw = getSwatch(t.bookColor);
        return `
          <div class="rounded-2xl p-2.5 flex items-start gap-2.5 transition-colors hover:bg-black/5"
               style="background:var(--ui-surface-alt); border:1.4px solid var(--ui-border);">
            <button type="button" data-global-task-toggle="${idx}"
                    title="${t.checked ? 'Mark task as open' : 'Complete task'}"
                    class="w-4 h-4 mt-0.5 rounded-[5px] flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                    style="background:${t.checked ? '#4d8a54' : '#fffaf0'}; border:1.8px solid ${t.checked ? '#2d5a34' : '#52341e'}; color:#fffaf0;">
              ${t.checked ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
            </button>
            <button type="button" data-global-task-jump="${idx}"
                    class="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer group">
              <div class="text-xs font-medium leading-snug break-words ${t.checked ? 'line-through opacity-60' : ''}" style="color:var(--ui-ink);">
                ${esc(t.text)}
              </div>
              <div class="flex items-center gap-1.5 flex-wrap mt-1">
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                      style="background:${bsw.soft}; color:${bsw.deep}; border:1px solid ${bsw.fill};">
                  <span class="w-2 h-2 rounded-full shrink-0" style="background:${bsw.fill};"></span>
                  ${esc(truncate(t.bookTitle, 24))}
                </span>
                <span class="text-[10.5px] truncate" style="color:var(--ui-muted);">&rsaquo; ${esc(truncate(t.pageTitle, 22))}</span>
              </div>
            </button>
          </div>
        `;
      }).join('') || `
        <div class="py-6 px-3 text-center space-y-1">
          <div class="font-storybook font-bold text-xs" style="color:var(--ui-ink);">No ${tasksMenuFilter === 'all' ? '' : tasksMenuFilter + ' '}tasks found</div>
          <div class="text-[11px]" style="color:var(--ui-muted);">Click <strong>&#9745; Task</strong> inside any book page (or press Enter on a task line) to add tasks!</div>
        </div>
      `}
    </div>
  `;

  menuTasks.querySelectorAll('[data-task-filter]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      tasksMenuFilter = btn.dataset.taskFilter;
      renderGlobalTasksMenu();
    });
  });

  menuTasks.querySelectorAll('[data-global-task-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const task = shown[Number(btn.dataset.globalTaskToggle)];
      if (task) toggleGlobalLibraryTask(task);
    });
  });

  menuTasks.querySelectorAll('[data-global-task-jump]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const task = shown[Number(btn.dataset.globalTaskJump)];
      if (!task) return;
      closeAllMenus();
      if (task.isLoosePaper) {
        openLoosePaperCenter(task.pageId);
        showToast(`Opened loose paper "${task.pageTitle}"`);
        return;
      }
      if (task.hallId !== CART_HALL_ID && expandAncestorsOfHall(task.hallId, true)) renderMap();
      const bg = layoutCache.books[task.bookId];
      if (bg) flyTo(bg.bayGeom.x, bg.bayGeom.y, 0.92, 360);
      openBookCenter(task.hallId, task.bookId, task.pageId);
      showToast(`Opened "${task.bookTitle}" › "${task.pageTitle}"`);
    });
  });
}

function updateGlobalTasksMenuUI() {
  if (!tasksMenuBadge) return;
  const allTasks = getAllLibraryTasks();
  const openCount = allTasks.filter(t => !t.checked).length;
  tasksMenuBadge.textContent = allTasks.length === 0 ? '0' : `${openCount}/${allTasks.length}`;
  if (menuTasks && !menuTasks.classList.contains('hidden')) {
    renderGlobalTasksMenu();
  }
}

const menuTemplates = document.getElementById('menu-templates');
const menuIO = document.getElementById('menu-io');
function closeAllMenus() {
  menuTemplates.classList.add('hidden');
  menuIO.classList.add('hidden');
  menuTasks?.classList.add('hidden');
  document.getElementById('menu-market')?.classList.add('hidden');
  document.getElementById('menu-audio')?.classList.add('hidden');
  searchResults.classList.add('hidden');
}

btnTasksMenu?.addEventListener('click', (e) => {
  e.stopPropagation();
  const wasOpen = !menuTasks.classList.contains('hidden');
  closeAllMenus();
  if (!wasOpen) {
    renderGlobalTasksMenu();
    menuTasks.classList.remove('hidden');
  }
});
let showBackupsInMenu = false;
const expandedBackupLibIds = new Set();
const HIDDEN_LIB_TPLS_KEY = 'storytellers_hidden_lib_templates_v1';
const STARTER_LIB_TEMPLATES = [
  { key: 'creative', title: 'Creative Project Atlas', sub: 'Halls, Sub-Halls, Study Table & Pile' },
  { key: 'worldbuilding', title: 'Story & Worldbuilding', sub: 'Realms, Factions, Heroes & Ribbons' },
  { key: 'study', title: 'Knowledge Garden', sub: '4 Halls · Notes, Sources, Stamps' }
];
let hiddenLibTemplates = [];
try {
  const saved = JSON.parse(localStorage.getItem(HIDDEN_LIB_TPLS_KEY) || '[]');
  if (Array.isArray(saved)) hiddenLibTemplates = saved;
} catch (e) {}

function saveHiddenLibTemplates() {
  try { localStorage.setItem(HIDDEN_LIB_TPLS_KEY, JSON.stringify(hiddenLibTemplates)); } catch (e) {}
}

function formatBackupTime(iso, includeSeconds = false) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const opts = includeSeconds
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return d.toLocaleString(undefined, opts);
  } catch (e) { return ''; }
}

function formatBackupSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderLibrariesMenu() {
  if (!menuTemplates) return;
  const prevInput = menuTemplates.querySelector('#new-lib-name');
  const prevDraft = prevInput ? prevInput.value : '';
  const wasInputFocused = prevInput && document.activeElement === prevInput;

  const libs = savedLibraries.length > 0
    ? savedLibraries
    : [{ id: activeLibraryId, title: state.title || 'My Library', hallCount: (state.halls || []).length, bookCount: 0 }];
  const visibleTemplates = STARTER_LIB_TEMPLATES.filter(t => !hiddenLibTemplates.includes(t.key));
  const hiddenCount = STARTER_LIB_TEMPLATES.length - visibleTemplates.length;

  menuTemplates.innerHTML = `
    <div class="px-2 py-1 flex items-center justify-between gap-2">
      <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--ui-muted);">Your Libraries (${libs.length})</span>
    </div>
    <div class="space-y-1 mb-2">
      ${libs.map(lib => {
        const isActive = lib.id === activeLibraryId;
        return `
          <div class="flex items-center gap-1 rounded-xl p-1 transition-colors"
               style="background:${isActive ? 'var(--ui-accent-soft)' : 'transparent'}; border:1.4px solid ${isActive ? 'var(--ui-accent)' : 'transparent'};">
            <button type="button" data-switch-lib="${esc(lib.id)}"
                    class="flex-1 min-w-0 text-left px-2 py-1.5 rounded-lg text-xs cursor-pointer bg-transparent border-0 flex flex-col"
                    style="color: var(--ui-ink);">
              <span class="font-storybook font-bold truncate flex items-center gap-1.5">
                ${isActive ? `<span style="color: var(--ui-accent);">&#10003;</span>` : ''}
                <span class="truncate">${esc(lib.title || 'Untitled Library')}</span>
              </span>
              <span class="text-[10.5px] truncate" style="color: var(--ui-muted);">
                ${lib.hallCount ?? 0} hall${lib.hallCount === 1 ? '' : 's'} &middot; ${lib.bookCount ?? 0} item${lib.bookCount === 1 ? '' : 's'}
              </span>
            </button>
            <button type="button" data-del-lib="${esc(lib.id)}" title="Delete library '${esc(lib.title)}'"
                    class="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
          </div>
        `;
      }).join('')}
    </div>

    <div class="my-2 border-t" style="border-color: var(--ui-border);"></div>
    <div class="px-2 py-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--ui-muted);">Create New Library</div>
    <div class="px-1.5 pb-1.5 flex items-center gap-1.5">
      <input id="new-lib-name" type="text" value="${esc(prevDraft)}" placeholder="New library name…"
             class="storybook-input flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs" />
      <button id="btn-create-blank-lib" type="button"
              class="storybook-btn-primary rounded-xl px-2.5 py-1.5 text-xs font-bold cursor-pointer shrink-0">+ New</button>
    </div>

    ${visibleTemplates.length > 0 ? `
      <div class="px-2 pt-1 pb-0.5 flex items-center justify-between gap-2">
        <span class="text-[10.5px] font-semibold uppercase tracking-wider" style="color: var(--ui-muted);">Or New From Template</span>
        <button id="btn-hide-all-tpls" type="button" class="text-[10px] font-semibold underline cursor-pointer bg-transparent border-0 p-0" style="color: var(--ui-muted);">Remove All</button>
      </div>
      <div class="space-y-0.5">
        ${visibleTemplates.map(tpl => `
          <div class="flex items-center gap-1 rounded-xl hover:bg-black/5 pr-1">
            <button type="button" data-new-template="${tpl.key}" class="flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-xl text-xs flex flex-col cursor-pointer bg-transparent border-0" style="color: var(--ui-ink);">
              <span class="font-semibold truncate">+ ${esc(tpl.title)}</span>
              <span class="text-[10.5px] truncate" style="color: var(--ui-muted);">${esc(tpl.sub)}</span>
            </button>
            <button type="button" data-hide-template="${tpl.key}" title="Remove '${esc(tpl.title)}' template from menu"
                    class="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold cursor-pointer bg-transparent border-0 opacity-60 hover:opacity-100 hover:bg-red-500/10 text-red-600">&times;</button>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${hiddenCount > 0 ? `
      <div class="px-2 pt-1 flex justify-end">
        <button id="btn-restore-lib-tpls" type="button" class="text-[10.5px] font-semibold underline cursor-pointer bg-transparent border-0 p-0" style="color: var(--ui-muted);">Restore starter templates (${hiddenCount})</button>
      </div>
    ` : ''}

    <div class="my-2 border-t" style="border-color: var(--ui-border);"></div>
    <button id="btn-toggle-backups-menu" type="button"
            class="w-full px-2 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider cursor-pointer bg-transparent border-0 hover:bg-black/5"
            style="color: var(--ui-muted);">
      <span>Backups &amp; Deleted (${savedBackups.length})</span>
      <span>${showBackupsInMenu ? '&#9652;' : '&#9662;'}</span>
    </button>
    ${showBackupsInMenu ? `
      <div class="space-y-1.5 mt-1 max-h-80 overflow-y-auto nice-scroll pr-0.5">
        ${savedBackups.length === 0
          ? `<div class="px-2 py-2 text-[11px] italic" style="color: var(--ui-muted);">No server backups yet.</div>`
          : savedBackups.map(bk => {
              const snapshots = Array.isArray(bk.snapshots) && bk.snapshots.length > 0 ? bk.snapshots : [bk];
              const isExpanded = expandedBackupLibIds.has(bk.libId);
              const totalCount = bk.backupCount || snapshots.length;
              const pageLabel = typeof bk.pageCount === 'number' ? ` &middot; ${bk.pageCount} pg` : '';
              return `
                <div class="rounded-xl p-2 flex flex-col gap-1.5" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">
                  <button type="button" data-toggle-backup-lib="${esc(bk.libId)}"
                          title="${isExpanded ? 'Collapse backup snapshots' : 'Click to expand all backup snapshots'}"
                          aria-expanded="${isExpanded ? 'true' : 'false'}"
                          class="w-full text-left rounded-lg px-1.5 py-1 -mx-1 -mt-0.5 transition-colors hover:bg-black/5 cursor-pointer bg-transparent border-0 flex items-start justify-between gap-2">
                    <span class="min-w-0 flex-1">
                      <span class="font-storybook font-bold text-xs truncate block" style="color: var(--ui-ink);">${esc(bk.title || 'Untitled Backup')}</span>
                      <span class="text-[10px] truncate block" style="color: var(--ui-muted);">
                        ${esc(formatBackupTime(bk.mtime))} &middot; ${bk.hallCount ?? 0} halls &middot; ${bk.bookCount ?? 0} items${pageLabel}
                      </span>
                    </span>
                    <span class="shrink-0 flex items-center gap-1 pt-0.5 text-[10px] font-bold" style="color: var(--ui-muted);">
                      <span>${totalCount}</span>
                      <span>${isExpanded ? '&#9652;' : '&#9662;'}</span>
                    </span>
                  </button>
                  <div class="flex items-center gap-1.5">
                    <button type="button" data-restore-backup="${esc(bk.name)}"
                            class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer flex-1">Restore Latest</button>
                    <button type="button" data-perma-del-backup="${esc(bk.name)}"
                            title="Permanently delete all ${totalCount} backup${totalCount === 1 ? '' : 's'} for this library"
                            class="rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer bg-transparent border border-red-400/50 text-red-600 hover:bg-red-500/10">Perma Delete</button>
                  </div>
                  ${isExpanded ? `
                    <div class="pt-1.5 mt-0.5 border-t space-y-1 max-h-48 overflow-y-auto nice-scroll pr-0.5" style="border-color: var(--ui-border);">
                      ${snapshots.map((snap, idx) => {
                        const snapPages = typeof snap.pageCount === 'number' ? ` &middot; ${snap.pageCount} pg` : '';
                        const snapSize = formatBackupSize(snap.size);
                        const diffTitle = snap.title && snap.title !== bk.title ? ` &middot; ${esc(snap.title)}` : '';
                        return `
                          <div class="rounded-lg px-2 py-1.5 flex items-center gap-1.5" style="background: var(--ui-surface); border: 1px solid var(--ui-border);">
                            <div class="min-w-0 flex-1">
                              <div class="text-[10.5px] font-bold truncate" style="color: var(--ui-ink);">
                                ${esc(formatBackupTime(snap.mtime, true))}${idx === 0 ? ' <span style="color:var(--ui-accent);">(Latest)</span>' : ''}
                              </div>
                              <div class="text-[9.5px] truncate" style="color: var(--ui-muted);">
                                r${snap.rev ?? '?'} &middot; ${snap.hallCount ?? 0}h &middot; ${snap.bookCount ?? 0} items${snapPages}${snapSize ? ` &middot; ${esc(snapSize)}` : ''}${diffTitle}
                              </div>
                            </div>
                            <button type="button" data-restore-backup="${esc(snap.name)}"
                                    title="Restore snapshot from ${esc(formatBackupTime(snap.mtime, true))}"
                                    class="storybook-btn shrink-0 rounded-md px-2 py-1 text-[10px] font-bold cursor-pointer">Restore</button>
                            <button type="button" data-del-single-backup="${esc(snap.name)}"
                                    data-del-single-label="${esc(`${snap.title || bk.title || 'Backup'} (${formatBackupTime(snap.mtime, true)})`)}"
                                    title="Delete only this backup snapshot"
                                    class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')
        }
      </div>
    ` : ''}
  `;

  menuTemplates.querySelectorAll('[data-switch-lib]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.switchLib;
      closeAllMenus();
      if (id && id !== activeLibraryId) {
        await switchToLibrary(id);
      }
    });
  });

  menuTemplates.querySelectorAll('[data-del-lib]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSavedLibrary(btn.dataset.delLib);
    });
  });

  const nameInput = menuTemplates.querySelector('#new-lib-name');
  if (wasInputFocused && nameInput) {
    nameInput.focus();
    nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
  }
  const submitNewBlank = async () => {
    const title = (nameInput?.value || '').trim() || 'Untitled Library';
    closeAllMenus();
    await createNewLibrary('blank', title);
  };
  menuTemplates.querySelector('#btn-create-blank-lib')?.addEventListener('click', (e) => {
    e.stopPropagation();
    submitNewBlank();
  });
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitNewBlank();
    }
  });

  menuTemplates.querySelectorAll('[data-new-template]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.newTemplate;
      const customName = (nameInput?.value || '').trim() || null;
      closeAllMenus();
      await createNewLibrary(key, customName);
    });
  });

  menuTemplates.querySelectorAll('[data-hide-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.hideTemplate;
      if (!hiddenLibTemplates.includes(key)) {
        hiddenLibTemplates.push(key);
        saveHiddenLibTemplates();
        renderLibrariesMenu();
      }
    });
  });

  menuTemplates.querySelector('#btn-hide-all-tpls')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hiddenLibTemplates = STARTER_LIB_TEMPLATES.map(t => t.key);
    saveHiddenLibTemplates();
    renderLibrariesMenu();
  });

  menuTemplates.querySelector('#btn-restore-lib-tpls')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hiddenLibTemplates = [];
    saveHiddenLibTemplates();
    renderLibrariesMenu();
  });

  menuTemplates.querySelector('#btn-toggle-backups-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showBackupsInMenu = !showBackupsInMenu;
    renderLibrariesMenu();
    if (showBackupsInMenu) refreshBackupList();
  });

  menuTemplates.querySelectorAll('[data-toggle-backup-lib]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const libId = btn.dataset.toggleBackupLib;
      if (!libId) return;
      if (expandedBackupLibIds.has(libId)) expandedBackupLibIds.delete(libId);
      else expandedBackupLibIds.add(libId);
      renderLibrariesMenu();
    });
  });

  menuTemplates.querySelectorAll('[data-restore-backup]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.restoreBackup;
      closeAllMenus();
      await restoreLibraryFromBackup(name);
    });
  });

  menuTemplates.querySelectorAll('[data-perma-del-backup]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await permanentlyDeleteBackup(btn.dataset.permaDelBackup);
    });
  });

  menuTemplates.querySelectorAll('[data-del-single-backup]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await permanentlyDeleteSingleBackup(btn.dataset.delSingleBackup, btn.dataset.delSingleLabel || '');
    });
  });
}

document.getElementById('btn-templates').addEventListener('click', (e) => {
  e.stopPropagation();
  const wasOpen = !menuTemplates.classList.contains('hidden');
  closeAllMenus();
  if (!wasOpen) {
    renderLibrariesMenu();
    menuTemplates.classList.remove('hidden');
    refreshLibraryList();
    refreshBackupList();
  }
});
document.getElementById('btn-io').addEventListener('click', (e) => {
  e.stopPropagation();
  const wasOpen = !menuIO.classList.contains('hidden');
  closeAllMenus();
  if (!wasOpen) menuIO.classList.remove('hidden');
});
window.addEventListener('click', (e) => {
  if (!e.target.closest('#menu-templates') && !e.target.closest('#btn-templates') &&
      !e.target.closest('#menu-io') && !e.target.closest('#btn-io') &&
      !e.target.closest('#menu-tasks') && !e.target.closest('#btn-tasks-menu') &&
      !e.target.closest('#menu-market') && !e.target.closest('#btn-market-menu') &&
      !e.target.closest('#search-results') && !e.target.closest('#search-input') &&
      !e.target.closest('#btn-clear-search') && !e.target.closest('#search-hopper')) {
    closeAllMenus();
  }
});

document.getElementById('act-export-md').addEventListener('click', () => {
  const md = libraryToMarkdown();
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${slugify(state.title)}-outline.md`);
  closeAllMenus();
  showToast('Exported full library Markdown outline (.md)');
});

document.getElementById('act-export-json').addEventListener('click', () => {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), `${slugify(state.title)}.json`);
  closeAllMenus(); showToast('Saved library JSON (with custom colors, stamps, ribbons & cart)');
});

const fileInput = document.getElementById('file-import-json');
document.getElementById('act-import-json').addEventListener('click', () => { closeAllMenus(); fileInput.click(); });
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.halls)) throw new Error('Invalid');
      state = normalizeLibraryState(parsed);
      activeStampLensId = null;
      clearSearch(false); closeOpenBook(); clearSelection(); commitChange(); fitToView(true);
      showToast(`Loaded "${state.title}"`);
    } catch (err) { showToast('Could not read that JSON file'); }
  };
  reader.readAsText(file);
  fileInput.value = '';
});

document.getElementById('act-export-svg').addEventListener('click', () => {
  const pad = 70;
  const x = Math.floor(worldBounds.minX - pad);
  const y = Math.floor(worldBounds.minY - pad);
  const w = Math.ceil(worldBounds.maxX - worldBounds.minX + pad * 2);
  const h = Math.ceil(worldBounds.maxY - worldBounds.minY + pad * 2);
  const bg = isCandlelight ? '#1d1511' : '#f2ead9';
  const svgDoc = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">
  <defs>${document.getElementById('svg-defs').innerHTML}</defs>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}" />
  <g>${sceneEl.innerHTML}</g>
</svg>`;
  downloadBlob(new Blob([svgDoc], { type: 'image/svg+xml' }), `${slugify(state.title)}.svg`);
  closeAllMenus(); showToast('Exported illustrated SVG');
});

function slugify(str) {
  return (str || 'library-mind-map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'library-mind-map';
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('btn-home-hub')?.addEventListener('click', () => { closeOpenBook(); openCardIndex('rotunda', true); });
document.getElementById('btn-card-index').addEventListener('click', () => { closeOpenBook(); openCardIndex(cardIndexTab === 'rotunda' ? 'colors' : cardIndexTab, false); });
document.getElementById('btn-toggle-ribbons').addEventListener('click', () => {
  showRibbons = !showRibbons;
  document.getElementById('btn-toggle-ribbons').classList.toggle('active', showRibbons);
  renderMap();
  showToast(showRibbons ? 'Showing cross-reference ribbons' : 'Hid cross-reference ribbons');
});
document.getElementById('btn-close-inspector').addEventListener('click', clearSelection);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

document.getElementById('btn-atmosphere').addEventListener('click', () => {
  manualAtmosphere = true;
  applyAtmosphere(!isCandlelight);
  playCozySound('lamp');
  showToast(isCandlelight ? 'Candlelight Evening mode' : 'Sunlit Daylight mode');
});

const btnAmbient = document.getElementById('btn-ambient');
if (btnAmbient) {
  btnAmbient.classList.toggle('active', ambientLifeEnabled);
  btnAmbient.addEventListener('click', () => {
    ambientLifeEnabled = !ambientLifeEnabled;
    btnAmbient.classList.toggle('active', ambientLifeEnabled);
    if (!ambientLifeEnabled) {
      if (ambientStrollTimer) { clearTimeout(ambientStrollTimer); ambientStrollTimer = null; }
      activeLibrarians = activeLibrarians.filter(a => a.direction !== 'stroll');
      renderLibrariansOverlaySVG();
    } else {
      scheduleNextAmbientStroll();
    }
    renderMap();
    showToast(ambientLifeEnabled ? 'Ambient Library Life on (Mochi & lantern strolls)' : 'Ambient Library Life paused');
  });
}

const btnSound = document.getElementById('btn-sound');
const iconSound = document.getElementById('icon-sound');
const soundMusicDot = document.getElementById('sound-music-dot');
const menuAudio = document.getElementById('menu-audio');

function updateSoundButtonUI() {
  if (!btnSound) return;
  const anyAudioOn = soundEnabled || lofiPlaying || rainPlaying;
  btnSound.classList.toggle('active', anyAudioOn);
  if (soundMusicDot) {
    soundMusicDot.classList.toggle('hidden', !(lofiPlaying || rainPlaying));
  }
  if (iconSound) {
    iconSound.innerHTML = anyAudioOn
      ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'
      : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  }
}

function renderAudioMenu() {
  if (!menuAudio) return;
  const anyAudioOn = soundEnabled || lofiPlaying || rainPlaying;
  const moods = [
    { key: 'sunlit', label: 'Sunlit Study' },
    { key: 'candlelight', label: 'Candlelight' },
    { key: 'ambient', label: 'Ambient Keys' }
  ];
  const previews = [
    { kind: 'book-open', label: 'Open' },
    { kind: 'book-close', label: 'Close' },
    { kind: 'page', label: 'Page' },
    { kind: 'stamp', label: 'Stamp' },
    { kind: 'purr', label: 'Purr' }
  ];

  menuAudio.innerHTML = `
    <div class="flex items-center justify-between gap-2 pb-1.5 border-b" style="border-color: var(--ui-border);">
      <div class="flex items-center gap-1.5">
        <span class="font-storybook font-bold text-xs" style="color: var(--ui-ink);">Library Soundscape</span>
      </div>
      ${anyAudioOn ? `<button id="audio-mute-all" type="button" class="text-[10.5px] font-bold px-2 py-0.5 rounded-lg cursor-pointer bg-transparent border hover:bg-black/5" style="border-color: var(--ui-border); color: var(--ui-muted);">Mute All</button>` : `<span class="text-[10.5px] italic" style="color: var(--ui-muted);">All quiet</span>`}
    </div>

    <!-- Library Foley SFX -->
    <div class="rounded-xl p-2.5 space-y-2" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-bold leading-tight" style="color: var(--ui-ink);">Library Foley SFX</div>
          <div class="text-[10px]" style="color: var(--ui-muted);">Books, pages, scrolls, stamps &amp; drawers</div>
        </div>
        <button id="audio-toggle-foley" type="button" class="storybook-btn ${soundEnabled ? 'active' : ''} rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0">
          ${soundEnabled ? 'On' : 'Off'}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold w-7 shrink-0" style="color: var(--ui-muted);">Vol</span>
        <input id="audio-foley-vol" type="range" min="0" max="100" value="${Math.round(foleyVolume * 100)}" class="cozy-range flex-1" />
        <span id="audio-foley-vol-lbl" class="text-[10px] font-mono w-7 text-right tabular-nums" style="color: var(--ui-muted);">${Math.round(foleyVolume * 100)}%</span>
      </div>
      <div class="flex items-center gap-1 flex-wrap pt-0.5">
        <span class="text-[9.5px] font-semibold mr-0.5" style="color: var(--ui-muted);">Try:</span>
        ${previews.map(p => `<button type="button" data-preview-foley="${p.kind}" class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer bg-transparent border hover:bg-black/5" style="border-color: var(--ui-border); color: var(--ui-ink);">${p.label}</button>`).join('')}
      </div>
    </div>

    <!-- Procedural Lofi Study Music -->
    <div class="rounded-xl p-2.5 space-y-2" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-bold leading-tight" style="color: var(--ui-ink);">Lofi Study Music</div>
          <div class="text-[10px]" style="color: var(--ui-muted);">Warm Rhodes chords &amp; dusty beats</div>
        </div>
        <button id="audio-toggle-lofi" type="button" class="storybook-btn ${lofiPlaying ? 'active' : ''} rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0">
          ${lofiPlaying ? 'Pause' : 'Play'}
        </button>
      </div>
      <div class="grid grid-cols-3 gap-1">
        ${moods.map(m => `
          <button type="button" data-lofi-mood="${m.key}" class="storybook-btn ${lofiMood === m.key ? 'active' : ''} rounded-lg px-1.5 py-1 text-[10px] font-bold cursor-pointer truncate">
            ${m.label}
          </button>
        `).join('')}
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold w-7 shrink-0" style="color: var(--ui-muted);">Vol</span>
        <input id="audio-lofi-vol" type="range" min="0" max="100" value="${Math.round(lofiVolume * 100)}" class="cozy-range flex-1" />
        <span id="audio-lofi-vol-lbl" class="text-[10px] font-mono w-7 text-right tabular-nums" style="color: var(--ui-muted);">${Math.round(lofiVolume * 100)}%</span>
      </div>
      <label class="flex items-center justify-between gap-2 pt-0.5 cursor-pointer">
        <span class="text-[10.5px] font-semibold" style="color: var(--ui-muted);">Warm Vinyl Crackle</span>
        <input id="audio-lofi-vinyl" type="checkbox" ${lofiVinylEnabled ? 'checked' : ''} class="accent-amber-700 cursor-pointer" />
      </label>
    </div>

    <!-- Window Rain Ambience -->
    <div class="rounded-xl p-2.5 space-y-2" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-bold leading-tight" style="color: var(--ui-ink);">Window Rain</div>
          <div class="text-[10px]" style="color: var(--ui-muted);">Soft drizzle on library glass</div>
        </div>
        <button id="audio-toggle-rain" type="button" class="storybook-btn ${rainPlaying ? 'active' : ''} rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0">
          ${rainPlaying ? 'On' : 'Off'}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-semibold w-7 shrink-0" style="color: var(--ui-muted);">Vol</span>
        <input id="audio-rain-vol" type="range" min="0" max="100" value="${Math.round(rainVolume * 100)}" class="cozy-range flex-1" />
        <span id="audio-rain-vol-lbl" class="text-[10px] font-mono w-7 text-right tabular-nums" style="color: var(--ui-muted);">${Math.round(rainVolume * 100)}%</span>
      </div>
    </div>
  `;

  menuAudio.querySelector('#audio-mute-all')?.addEventListener('click', () => {
    muteAllLibraryAudio();
    updateSoundButtonUI();
    renderAudioMenu();
    showToast('All library audio muted');
  });

  menuAudio.querySelector('#audio-toggle-foley')?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    saveAudioPrefs();
    updateSoundButtonUI();
    renderAudioMenu();
    if (soundEnabled) playCozySound('book-open');
    showToast(soundEnabled ? 'Cozy library foley sounds on' : 'Library foley sounds muted');
  });

  const foleyVolEl = menuAudio.querySelector('#audio-foley-vol');
  const foleyVolLbl = menuAudio.querySelector('#audio-foley-vol-lbl');
  foleyVolEl?.addEventListener('input', () => {
    const pct = Number(foleyVolEl.value);
    setFoleyVolume(pct / 100);
    if (foleyVolLbl) foleyVolLbl.textContent = `${pct}%`;
  });

  menuAudio.querySelectorAll('[data-preview-foley]').forEach(btn => {
    btn.addEventListener('click', () => {
      playCozySound(btn.dataset.previewFoley, { preview: true });
    });
  });

  menuAudio.querySelector('#audio-toggle-lofi')?.addEventListener('click', () => {
    if (lofiPlaying) {
      stopLofiMusic();
      showToast('Lofi study music paused');
    } else {
      startLofiMusic();
      showToast(`Playing Lofi — ${LOFI_MOODS[lofiMood]?.name || 'Sunlit Study'}`);
    }
    updateSoundButtonUI();
    renderAudioMenu();
  });

  menuAudio.querySelectorAll('[data-lofi-mood]').forEach(btn => {
    btn.addEventListener('click', () => {
      setLofiMood(btn.dataset.lofiMood);
      if (!lofiPlaying) startLofiMusic();
      updateSoundButtonUI();
      renderAudioMenu();
      showToast(`Lofi mood: ${LOFI_MOODS[lofiMood]?.name}`);
    });
  });

  const lofiVolEl = menuAudio.querySelector('#audio-lofi-vol');
  const lofiVolLbl = menuAudio.querySelector('#audio-lofi-vol-lbl');
  lofiVolEl?.addEventListener('input', () => {
    const pct = Number(lofiVolEl.value);
    setLofiVolume(pct / 100);
    if (lofiVolLbl) lofiVolLbl.textContent = `${pct}%`;
  });

  menuAudio.querySelector('#audio-lofi-vinyl')?.addEventListener('change', (e) => {
    setLofiVinylEnabled(e.target.checked);
  });

  menuAudio.querySelector('#audio-toggle-rain')?.addEventListener('click', () => {
    if (rainPlaying) {
      stopLibraryRain();
      showToast('Window rain stopped');
    } else {
      startLibraryRain();
      showToast('Soft rain on the library windows');
    }
    updateSoundButtonUI();
    renderAudioMenu();
  });

  const rainVolEl = menuAudio.querySelector('#audio-rain-vol');
  const rainVolLbl = menuAudio.querySelector('#audio-rain-vol-lbl');
  rainVolEl?.addEventListener('input', () => {
    const pct = Number(rainVolEl.value);
    setRainVolume(pct / 100);
    if (rainVolLbl) rainVolLbl.textContent = `${pct}%`;
  });
}

if (menuAudio) {
  menuAudio.addEventListener('click', (e) => e.stopPropagation());
}

if (btnSound) {
  updateSoundButtonUI();
  btnSound.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menuAudio && !menuAudio.classList.contains('hidden');
    closeAllMenus();
    if (!wasOpen && menuAudio) {
      renderAudioMenu();
      menuAudio.classList.remove('hidden');
    }
  });
}

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  const ns = Math.min(2.2, cam.scale * 1.22);
  const r = ns / cam.scale;
  cam.x *= r; cam.y *= r; cam.scale = ns; applyCamera();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  const ns = Math.max(0.22, cam.scale / 1.22);
  const r = ns / cam.scale;
  cam.x *= r; cam.y *= r; cam.scale = ns; applyCamera();
});
document.getElementById('btn-fit').addEventListener('click', () => fitToView(true));

window.addEventListener('keydown', (e) => {
  const el = document.activeElement;
  const tag = el?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;

  if (!imgLightbox.classList.contains('hidden')) {
    if (e.key === 'Escape') closeLightbox();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (!typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); } return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    if (!typing) { e.preventDefault(); redo(); } return;
  }
  if (e.key === 'Escape') {
    closeAllMenus();
    for (const id of ['link-popover', 'stamp-tray-pop', 'stamp-xref-pop', 'ribbon-tie-pop', 'save-tpl-pop', 'load-tpl-pop', 'tpl-picker-pop']) {
      const p = document.getElementById(id);
      if (p && !p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
    }
    if (el === searchInput) { clearSearch(false); searchInput.blur(); return; }
    if (typing) { el.blur(); return; }
    if (openAddRadialHallId) { openAddRadialHallId = null; renderMap(); return; }
    if (openBookState.bookId) { closeOpenBook(); return; }
    if (searchMatches.active) { clearSearch(false); return; }
    if (activeStampLensId) { setStampLens(null); return; }
    if (selection.type) clearSelection();
    return;
  }
  if (typing) return;

  if (openBookState.bookId) {
    const container = findOpenBookContainer(openBookState.hallId, openBookState.bookId);
    const book = container?.book;
    if (book) {
      const ordered = getOrderedBookPages(book);
      const idx = ordered.findIndex(p => p.id === openBookState.pageId);
      if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); selectBookPage(ordered[idx - 1].id, true); }
      if (e.key === 'ArrowRight' && idx < ordered.length - 1) { e.preventDefault(); selectBookPage(ordered[idx + 1].id, true); }
    }
    return;
  }

  if (e.key.toLowerCase() === 'f') { e.preventDefault(); fitToView(true); }
  else if (e.key === 'Tab') {
    if (selection.type === 'hub') { e.preventDefault(); createHall(null); }
    else if (selection.type === 'hall') { e.preventDefault(); createBook(selection.hallId); }
  }
});

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hide-toast');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hide-toast'), 2400);
}

// ============================================================
// 11. BOOTSTRAP
// ============================================================
if (window.innerWidth <= 768) {
  minimapCollapsed = true;
  tabletopCollapsed = true;
}
pushHistory();
applyMinimapCollapsedState();
applyAtmosphere(detectHostDark());
renderAll();
fitToView(false);
scheduleNextAmbientStroll();
initServerSync();
