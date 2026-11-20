// ============================================================
// 7. IMAGE COMPRESSION & INLINE RICH-CONTENT HELPERS
// ============================================================
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX_W = 920, MAX_H = 720;
        let w = img.naturalWidth, h = img.naturalHeight;
        const ratio = Math.min(1, MAX_W / w, MAX_H / h);
        w = Math.max(1, Math.round(w * ratio));
        h = Math.max(1, Math.round(h * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const isSmallPng = file.type === 'image/png' && file.size < 140000;
        resolve(isSmallPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let savedRange = null;
function saveEditorRange(editor) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (editor.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
  }
}
function restoreOrEndRange(editor) {
  editor.focus();
  const sel = window.getSelection();
  if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
    sel.removeAllRanges(); sel.addRange(savedRange); return savedRange;
  }
  const r = document.createRange();
  r.selectNodeContents(editor); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  savedRange = r; return r;
}
function insertNodeAtCaret(editor, node) {
  const range = restoreOrEndRange(editor);
  range.deleteContents(); range.insertNode(node);
  const spacer = document.createTextNode(' ');
  node.after(spacer);
  const afterRange = document.createRange();
  afterRange.setStartAfter(spacer); afterRange.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(afterRange);
  savedRange = afterRange.cloneRange();
}
function makeInlineImageCard(dataUrl) {
  const wrap = document.createElement('span');
  wrap.className = 'page-img-card';
  wrap.setAttribute('contenteditable', 'false');
  wrap.innerHTML = `<img src="${dataUrl}" alt="Page image" /><button type="button" class="page-img-del" title="Remove image">&times;</button>`;
  return wrap;
}
function makeHyperlinkNode(label, href) {
  const a = document.createElement('a');
  a.className = 'lib-ext-link';
  a.href = normalizeUrl(href); a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.textContent = (label || href).trim(); a.title = `Open external link: ${a.href}`;
  return a;
}

function styleInternalLinkNode(a, bookId) {
  const entry = findBookEntry(bookId);
  const sw = entry ? getSwatch(entry.book.color || entry.hall.color) : getSwatch(state.palette[0]?.id);
  a.style.setProperty('--link-fill', sw.fill);
  a.style.setProperty('--link-soft', sw.soft);
  a.style.setProperty('--link-deep', sw.deep);
  if (entry) {
    const pageId = a.dataset.libPage || '';
    const pg = pageId ? entry.book.pages.find(p => p.id === pageId) : null;
    a.title = pg
      ? `Jump to "${pg.title}" in ${entry.book.title} (${entry.hall.title})`
      : `Jump to book "${entry.book.title}" (${entry.hall.title})`;
  } else {
    a.title = 'Linked library book (moved or deleted)';
  }
}

function makeInternalLinkNode(label, bookId, pageId = '') {
  const a = document.createElement('a');
  a.className = 'lib-internal-link';
  a.setAttribute('contenteditable', 'false');
  a.href = `#lib-${bookId}${pageId ? '-' + pageId : ''}`;
  a.dataset.libBook = bookId;
  if (pageId) a.dataset.libPage = pageId;
  a.textContent = (label || 'Linked Page').trim();
  styleInternalLinkNode(a, bookId);
  return a;
}

function refreshInternalLinkColors(editorEl) {
  if (!editorEl) return;
  editorEl.querySelectorAll('a.lib-internal-link').forEach(a => {
    a.setAttribute('contenteditable', 'false');
    styleInternalLinkNode(a, a.dataset.libBook);
  });
}

function makeTodoRowNode(text = '', checked = false) {
  const row = document.createElement('div');
  row.className = 'page-todo-item';
  row.dataset.checked = checked ? 'true' : 'false';
  const box = document.createElement('span');
  box.className = 'page-todo-box';
  box.setAttribute('contenteditable', 'false');
  box.setAttribute('role', 'checkbox');
  box.setAttribute('aria-checked', checked ? 'true' : 'false');
  box.title = 'Toggle task';
  const txt = document.createElement('span');
  txt.className = 'page-todo-text';
  if (text && text.trim()) {
    txt.textContent = text;
  } else {
    txt.innerHTML = '<br>';
  }
  row.appendChild(box);
  row.appendChild(txt);
  return row;
}

function focusTodoRowCaret(editorEl, row, atStart = false) {
  if (!row || !editorEl) return;
  editorEl.focus();
  const txt = row.querySelector('.page-todo-text') || row;
  const r = document.createRange();
  const sel = window.getSelection();
  const hasOnlyBr = txt.childNodes.length === 1 && txt.firstChild.nodeName === 'BR';
  if (hasOnlyBr || txt.childNodes.length === 0 || atStart) {
    if (txt.childNodes.length === 0) txt.innerHTML = '<br>';
    r.setStart(txt, 0);
    r.collapse(true);
  } else {
    r.selectNodeContents(txt);
    r.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(r);
  savedRange = r.cloneRange();
}

function insertTaskFromToolbar(editorEl, syncFn) {
  editorEl.focus();
  const sel = window.getSelection();
  let anchor = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).commonAncestorContainer : null;
  if (!anchor || !editorEl.contains(anchor)) {
    if (savedRange && editorEl.contains(savedRange.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      anchor = savedRange.commonAncestorContainer;
    }
  }
  const anchorEl = anchor ? (anchor.nodeType === 1 ? anchor : anchor.parentElement) : null;
  const currentTodo = anchorEl?.closest('.page-todo-item');

  // 1. If cursor is already inside a task, clicking "+ Task" creates a new task on a new line right below!
  if (currentTodo && editorEl.contains(currentTodo)) {
    const newRow = makeTodoRowNode('', false);
    currentTodo.after(newRow);
    focusTodoRowCaret(editorEl, newRow, true);
    syncFn(true);
    return;
  }

  // 2. If user highlighted text, wrap that text into a task on its own line
  const selText = (sel && !sel.isCollapsed && anchor && editorEl.contains(anchor)) ? sel.toString().trim() : '';
  if (selText) {
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const newRow = makeTodoRowNode(selText, false);
    r.insertNode(newRow);
    focusTodoRowCaret(editorEl, newRow, false);
    syncFn(true);
    return;
  }

  // 3. If editor is completely empty
  const editorIsEmpty = !editorEl.textContent.trim() && !editorEl.querySelector('.page-todo-item, .page-img-card');
  if (editorIsEmpty) {
    editorEl.innerHTML = '';
    const newRow = makeTodoRowNode('', false);
    editorEl.appendChild(newRow);
    focusTodoRowCaret(editorEl, newRow, true);
    syncFn(true);
    return;
  }

  // 4. Find the top-level line/block in editorEl where the caret sits
  let topNode = anchor;
  while (topNode && topNode.parentNode && topNode.parentNode !== editorEl) {
    topNode = topNode.parentNode;
  }
  const newRow = makeTodoRowNode('', false);
  if (topNode && topNode.parentNode === editorEl) {
    const isBlankBlock = topNode.nodeName === 'BR' ||
      ((topNode.nodeName === 'DIV' || topNode.nodeName === 'P') && !topNode.textContent.trim() && !topNode.querySelector('img, .page-todo-item'));
    if (isBlankBlock) {
      topNode.replaceWith(newRow);
    } else {
      topNode.after(newRow);
    }
  } else {
    editorEl.appendChild(newRow);
  }
  focusTodoRowCaret(editorEl, newRow, true);
  syncFn(true);
}

function clearEditorSearchHighlights() {
  if (window.CSS && CSS.highlights) {
    try { CSS.highlights.delete('lib-search-match'); } catch (e) {}
  }
}

function applyEditorSearchHighlights(editorEl) {
  clearEditorSearchHighlights();
  if (!editorEl || !searchMatches.active || !searchMatches.query) return;
  if (!(window.CSS && CSS.highlights && typeof Highlight !== 'undefined')) return;
  const q = searchMatches.query;
  const ranges = [];
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const val = node.nodeValue || '';
    const lower = val.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      const r = document.createRange();
      r.setStart(node, pos);
      r.setEnd(node, pos + q.length);
      ranges.push(r);
      pos += q.length;
      if (ranges.length >= 60) break;
    }
    if (ranges.length >= 60) break;
  }
  if (ranges.length > 0) {
    try { CSS.highlights.set('lib-search-match', new Highlight(...ranges)); } catch (e) {}
  }
}

const imgLightbox = document.getElementById('img-lightbox');
const imgLightboxSrc = document.getElementById('img-lightbox-src');
function openLightbox(src) { imgLightboxSrc.src = src; imgLightbox.classList.remove('hidden'); }
function closeLightbox() { imgLightbox.classList.add('hidden'); imgLightboxSrc.src = ''; }
imgLightbox.addEventListener('click', closeLightbox);

// ============================================================
// 8. CENTER-SCREEN OPEN STORYBOOK, SINGLE-PAGE UI & CORKBOARD
// ============================================================
const bookModal = document.getElementById('book-modal');
const bookSpreadWrap = document.getElementById('book-spread-wrap');
const bookRefPeekEl = document.getElementById('book-ref-peek');
const bookTopFlippersEl = document.getElementById('book-top-flippers');
const bookCoverShell = document.getElementById('book-cover-shell');
const bookBottomRibbonsEl = document.getElementById('book-bottom-ribbons');
const ribbonTiePopEl = document.getElementById('ribbon-tie-pop');
const bookLeftEl = document.getElementById('open-book-left');
const bookRightEl = document.getElementById('open-book-right');
const bookChapterTabsEl = document.getElementById('book-chapter-tabs');
const pageImagePicker = document.getElementById('page-image-picker');

let listDrag = null;
let openBookViewMode = 'spread'; // 'spread' | 'single' | 'corkboard'
let refPeekState = { open: false, bookId: null, pageId: null };

function clearDropMarkers(root = document) {
  root.querySelectorAll('.drop-before, .drop-after, .drop-into, .dragging-item').forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging-item');
  });
}

function openBookCenter(hallId, bookId, pageId = null, forceViewMode = null) {
  const container = findOpenBookContainer(hallId, bookId);
  if (!container) return;
  const { book, isLoosePaper } = container;

  selection = { type: null, hallId: null };
  closeInspector();

  const ordered = getOrderedBookPages(book);
  let chosenPage = pageId ? book.pages.find(p => p.id === pageId) : null;
  if (!chosenPage && (searchMatches.active || activeStampLensId)) {
    chosenPage = ordered.find(p => doesPageMatchActiveFilter(p)) || null;
  }
  if (!chosenPage) chosenPage = ordered[0] || null;
  const chosenChapterId = chosenPage ? chosenPage.chapterId : (book.chapters[0]?.id || null);

  const wasScrollOrLoose = openBookState.hallId === LOOSE_PAPER_MODE_ID ||
    Boolean(openBookState.bookId && isScrollItem(findOpenBookContainer(openBookState.hallId, openBookState.bookId)?.book));

  if (isLoosePaper || isScrollItem(book)) {
    openBookViewMode = 'single';
  } else if (forceViewMode) {
    openBookViewMode = forceViewMode;
  } else if (wasScrollOrLoose) {
    openBookViewMode = 'spread';
  }

  editingChapterId = null;
  openBookState = { hallId, bookId, chapterId: chosenChapterId, pageId: chosenPage?.id || null };
  playCozySound('page');
  renderMap();
  renderBreadcrumbs();
  renderOpenBook(false);
  bookModal.classList.remove('book-closed');
}

function openLoosePaperCenter(cartPageId = null) {
  const pages = state.cart?.pages || [];
  if (pages.length === 0) return;
  const targetId = cartPageId && pages.some(p => p.id === cartPageId) ? cartPageId : pages[pages.length - 1].id;
  openBookCenter(LOOSE_PAPER_MODE_ID, LOOSE_PAPER_MODE_ID, targetId, 'single');
}

function openReferencePeek(targetBookId = null, targetPageId = null) {
  const pinned = getPinnedBooks();
  const all = getAllBooksFlat();
  let chosenBookId = targetBookId;
  if (!chosenBookId) {
    const altPinned = pinned.find(e => e.book.id !== openBookState.bookId);
    const altAny = all.find(e => e.book.id !== openBookState.bookId);
    chosenBookId = (altPinned || pinned[0] || altAny || all[0])?.book.id || null;
  }
  if (!chosenBookId) {
    showToast('Add a book to your library or Study Table to peek alongside!');
    return;
  }
  const entry = findBookEntry(chosenBookId);
  if (!entry) return;
  const ordered = getOrderedBookPages(entry.book);
  const pg = (targetPageId && entry.book.pages.find(p => p.id === targetPageId)) || ordered[0] || null;
  refPeekState = { open: true, bookId: entry.book.id, pageId: pg?.id || null };
  renderOpenBook(false);
}

function closeReferencePeek() {
  refPeekState.open = false;
  renderOpenBook(false);
}

function closeOpenBook() {
  if (!openBookState.bookId) return;
  clearEditorSearchHighlights();
  editingChapterId = null;
  openBookState = { hallId: null, bookId: null, chapterId: null, pageId: null };
  bookModal.classList.add('book-closed');
  renderMap();
  renderBreadcrumbs();
}

function selectBookPage(pageId, animateTurn = true) {
  const container = findOpenBookContainer(openBookState.hallId, openBookState.bookId);
  const book = container?.book;
  const page = book?.pages.find(p => p.id === pageId);
  if (!page) return;
  openBookState.pageId = page.id;
  openBookState.chapterId = page.chapterId;
  if (animateTurn) playCozySound('page');
  renderBreadcrumbs();
  renderOpenBook(animateTurn);
}

function selectChapterTab(chapterId) {
  const container = findOpenBookContainer(openBookState.hallId, openBookState.bookId);
  const book = container?.book;
  if (!book) return;
  openBookState.chapterId = chapterId;
  const firstInChapter = book.pages.find(p => p.chapterId === chapterId);
  openBookState.pageId = firstInChapter ? firstInChapter.id : null;
  playCozySound('page');
  renderBreadcrumbs();
  renderOpenBook(true);
  setTimeout(() => {
    bookLeftEl.querySelector(`[data-toc-chapter="${chapterId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 30);
}

function reorderChapter(book, draggedChId, targetChId, placeAfter) {
  if (draggedChId === targetChId) return;
  const fromIdx = book.chapters.findIndex(c => c.id === draggedChId);
  if (fromIdx === -1) return;
  const [moved] = book.chapters.splice(fromIdx, 1);
  const toIdx = book.chapters.findIndex(c => c.id === targetChId);
  if (toIdx === -1) book.chapters.push(moved);
  else book.chapters.splice(placeAfter ? toIdx + 1 : toIdx, 0, moved);
  commitChange();
  showToast(`Moved chapter "${moved.title}"`);
}

function reorderOrMovePage(book, draggedPageId, targetChapterId, targetPageId = null, placeAfter = false) {
  const fromIdx = book.pages.findIndex(p => p.id === draggedPageId);
  if (fromIdx === -1 || draggedPageId === targetPageId) return;
  const [moved] = book.pages.splice(fromIdx, 1);
  moved.chapterId = targetChapterId;
  if (targetPageId) {
    const toIdx = book.pages.findIndex(p => p.id === targetPageId);
    if (toIdx !== -1) book.pages.splice(placeAfter ? toIdx + 1 : toIdx, 0, moved);
    else book.pages.push(moved);
  } else book.pages.push(moved);
  if (openBookState.pageId === moved.id) openBookState.chapterId = targetChapterId;
  commitChange();
  showToast(`Moved "${moved.title}"`);
}

function buildHallOptionsHTML(selectedHallId) {
  const opts = [];
  forEachHall((h, depth) => {
    const prefix = depth === 0 ? '' : `${'  '.repeat(depth)}↳ `;
    opts.push(`<option value="${h.id}" ${h.id === selectedHallId ? 'selected' : ''}>${esc(prefix + truncate(h.title, 22))}</option>`);
  });
  return opts.join('');
}

// Render Top Outer Rim Next & Previous Book Flipper Tabs for BOTH the Current Hall AND the Study Table!
function renderBookTopFlippers(container) {
  if (!bookTopFlippersEl) return;
  const { isCart, isLoosePaper, hall, book } = container;
  let html = '';

  // 1. Hall Book Flipper (or Sorting Pile Book/Paper Flipper)
  if (isLoosePaper) {
    const papers = state.cart?.pages || [];
    const pIdx = papers.findIndex(p => p.id === openBookState.pageId);
    if (papers.length > 1 && pIdx >= 0) {
      const prevP = papers[(pIdx - 1 + papers.length) % papers.length];
      const nextP = papers[(pIdx + 1) % papers.length];
      html += `
        <div class="top-book-flipper px-2.5 py-1 flex items-center gap-1.5 text-[11px]">
          <button type="button" data-flip-loose="${prevP.id}" title="Previous paper in Sorting Pile: ${esc(prevP.title)}"
                  class="font-bold px-1.5 py-0.5 rounded-lg cursor-pointer bg-amber-900/10 hover:bg-amber-900/20 border-0" style="color:#362215;">&lsaquo; Prev Paper</button>
          <span class="font-storybook font-bold px-1" style="color:#6d4c33;">Pile Paper ${pIdx + 1}/${papers.length}</span>
          <button type="button" data-flip-loose="${nextP.id}" title="Next paper in Sorting Pile: ${esc(nextP.title)}"
                  class="font-bold px-1.5 py-0.5 rounded-lg cursor-pointer bg-amber-900/10 hover:bg-amber-900/20 border-0" style="color:#362215;">Next Paper &rsaquo;</button>
        </div>
      `;
    }
  } else {
    const hallBooks = isCart ? (state.cart?.books || []) : (hall.books || []);
    const bIdx = hallBooks.findIndex(b => b.id === book.id);
    const hsw = getSwatch(hall.color || book.color);
    if (hallBooks.length > 1 && bIdx >= 0) {
      const prevB = hallBooks[(bIdx - 1 + hallBooks.length) % hallBooks.length];
      const nextB = hallBooks[(bIdx + 1) % hallBooks.length];
      html += `
        <div class="top-book-flipper px-2.5 py-1 flex items-center gap-1.5 text-[11px]" style="border-color:#3c2516;">
          <button type="button" data-flip-hall-book="${prevB.id}" title="Previous book in ${esc(hall.title)}: &quot;${esc(prevB.title)}&quot;"
                  class="font-bold px-1.5 py-0.5 rounded-lg cursor-pointer hover:brightness-95 border-0 flex items-center gap-1"
                  style="background:${hsw.soft}; color:${hsw.deep};">
            <span>&lsaquo;</span>
            <span class="max-w-[95px] truncate hidden sm:inline">${esc(truncate(prevB.title, 14))}</span>
          </button>
          <span class="font-storybook font-bold px-1 whitespace-nowrap flex items-center gap-1" style="color:#362215;">
            <span class="w-2 h-2 rounded-full" style="background:${hsw.fill};"></span>
            <span>${esc(truncate(hall.title, 13))} (${bIdx + 1}/${hallBooks.length})</span>
          </span>
          <button type="button" data-flip-hall-book="${nextB.id}" title="Next book in ${esc(hall.title)}: &quot;${esc(nextB.title)}&quot;"
                  class="font-bold px-1.5 py-0.5 rounded-lg cursor-pointer hover:brightness-95 border-0 flex items-center gap-1"
                  style="background:${hsw.soft}; color:${hsw.deep};">
            <span class="max-w-[95px] truncate hidden sm:inline">${esc(truncate(nextB.title, 14))}</span>
            <span>&rsaquo;</span>
          </button>
        </div>
      `;
    }
  }

  // 2. Study Table Book Flipper (cycles through books stacked on the Lower-Right Study Table!)
  const pinned = getPinnedBooks();
  if (pinned.length > 0) {
    const tIdx = pinned.findIndex(e => e.book.id === book.id);
    const prevEntry = tIdx >= 0
      ? pinned[(tIdx - 1 + pinned.length) % pinned.length]
      : pinned[pinned.length - 1];
    const nextEntry = tIdx >= 0
      ? pinned[(tIdx + 1) % pinned.length]
      : pinned[0];

    html += `
      <div class="top-book-flipper px-2.5 py-1 flex items-center gap-1.5 text-[11px]" style="background:#fff6dc; border-color:#3c2516;">
        <button type="button" data-flip-table-hall="${prevEntry.hall.id}" data-flip-table-book="${prevEntry.book.id}"
                title="Previous on Study Table: &quot;${esc(prevEntry.book.title)}&quot;"
                class="font-bold px-1.5 py-0.5 rounded-lg cursor-pointer bg-amber-500/20 hover:bg-amber-500/35 border-0 flex items-center gap-1" style="color:#5a3710;">
          <span>&lsaquo;</span>
          <span class="max-w-[85px] truncate hidden md:inline">${esc(truncate(prevEntry.book.title, 12))}</span>
        </button>
        <span class="font-storybook font-bold px-1 whitespace-nowrap" style="color:#5a3710;">
          &#9733; Table ${tIdx >= 0 ? `#${tIdx + 1}/${pinned.length}` : `(${pinned.length})`}
        </span>
        <button type="button" data-flip-table-hall="${nextEntry.hall.id}" data-flip-table-book="${nextEntry.book.id}"
                title="Next on Study Table: &quot;${esc(nextEntry.book.title)}&quot;"
                class="font-bold px-1.5 py-0.5 rounded-lg cursor-pointer bg-amber-500/20 hover:bg-amber-500/35 border-0 flex items-center gap-1" style="color:#5a3710;">
          <span class="max-w-[85px] truncate hidden md:inline">${esc(truncate(nextEntry.book.title, 12))}</span>
          <span>&rsaquo;</span>
        </button>
      </div>
    `;
  }

  bookTopFlippersEl.innerHTML = html;

  bookTopFlippersEl.querySelectorAll('[data-flip-loose]').forEach(btn => {
    btn.addEventListener('click', () => openLoosePaperCenter(btn.dataset.flipLoose));
  });
  const flipMode = isScrollItem(book) ? null : openBookViewMode;
  bookTopFlippersEl.querySelectorAll('[data-flip-hall-book]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetBookId = btn.dataset.flipHallBook;
      const bg = layoutCache.books[targetBookId];
      if (bg && !bg.collapsedProxy) flyTo(bg.x, bg.y, null, 340);
      openBookCenter(hall.id, targetBookId, null, flipMode);
    });
  });
  bookTopFlippersEl.querySelectorAll('[data-flip-table-book]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetBookId = btn.dataset.flipTableBook;
      const targetHallId = btn.dataset.flipTableHall;
      const bg = layoutCache.books[targetBookId];
      if (bg && !bg.collapsedProxy) flyTo(bg.x, bg.y, null, 340);
      openBookCenter(targetHallId, targetBookId, null, flipMode);
    });
  });
}

// Render Side-by-Side Reference Peek Drawer (#book-ref-peek)
function renderReferencePeekDrawer() {
  if (!bookRefPeekEl) return;
  if (!refPeekState.open) {
    bookRefPeekEl.classList.add('hidden');
    bookSpreadWrap.classList.remove('has-ref-peek');
    return;
  }
  const pinned = getPinnedBooks();
  const allBooks = getAllBooksFlat();
  const pool = pinned.length > 0 ? pinned : allBooks;
  let entry = refPeekState.bookId ? findBookEntry(refPeekState.bookId) : null;
  if (!entry && pool.length > 0) {
    entry = pool[0];
    refPeekState.bookId = entry.book.id;
  }
  if (!entry) {
    refPeekState.open = false;
    bookRefPeekEl.classList.add('hidden');
    bookSpreadWrap.classList.remove('has-ref-peek');
    return;
  }

  bookRefPeekEl.classList.remove('hidden');
  bookSpreadWrap.classList.add('has-ref-peek');

  const refBook = entry.book;
  const rsw = getSwatch(refBook.color || entry.hall.color);
  const ordered = getOrderedBookPages(refBook);
  let refPage = ordered.find(p => p.id === refPeekState.pageId) || ordered[0] || null;
  refPeekState.pageId = refPage?.id || null;
  const pIdx = refPage ? ordered.findIndex(p => p.id === refPage.id) : -1;

  bookRefPeekEl.style.borderColor = '#3c2516';
  bookRefPeekEl.style.boxShadow = `inset 0 0 0 2px ${rsw.fill}, 0 14px 32px rgba(20,10,4,0.38)`;

  bookRefPeekEl.innerHTML = `
    <div class="flex items-center justify-between gap-1.5 pb-2 mb-2 border-b" style="border-color:rgba(122,92,68,0.22);">
      <span class="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style="background:${rsw.soft}; color:${rsw.deep};">
        <span class="w-2 h-2 rounded-full" style="background:${rsw.fill};"></span>
        <span>Reference Peek</span>
      </span>
      <button id="btn-close-ref-peek" type="button" title="Close Reference Peek" class="px-1.5 py-0.5 rounded-lg text-xs font-bold cursor-pointer bg-transparent border-0 hover:bg-black/10" style="color:#5c3f29;">&times;</button>
    </div>

    <select id="ref-peek-book-sel" class="w-full rounded-xl px-2.5 py-1.5 text-xs font-storybook font-bold mb-1.5 outline-none cursor-pointer" style="background:#fffaf0; border:1.5px solid ${rsw.fill}; color:#2d1a0f;">
      ${pinned.length > 0 ? `<optgroup label="★ Study Table Stack">
        ${pinned.map(e => `<option value="${e.book.id}" ${e.book.id === refBook.id ? 'selected' : ''}>&#9733; ${esc(truncate(e.book.title, 26))}</option>`).join('')}
      </optgroup>` : ''}
      <optgroup label="All Library Books">
        ${allBooks.map(e => `<option value="${e.book.id}" ${e.book.id === refBook.id ? 'selected' : ''}>${esc(truncate(e.hall.title, 12))} &rsaquo; ${esc(truncate(e.book.title, 22))}</option>`).join('')}
      </optgroup>
    </select>

    ${ordered.length > 0 ? `
      <div class="flex items-center gap-1 mb-2">
        <button id="ref-peek-prev" type="button" class="px-2 py-1 rounded-lg text-xs font-bold cursor-pointer bg-amber-900/10 hover:bg-amber-900/20 border-0" ${pIdx > 0 ? '' : 'disabled'}>&lsaquo;</button>
        <select id="ref-peek-page-sel" class="flex-1 min-w-0 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer" style="background:#fff; border:1px solid rgba(122,92,68,0.3); color:#321f13;">
          ${ordered.map((p, i) => `<option value="${p.id}" ${p.id === refPage?.id ? 'selected' : ''}>p.${i + 1} · ${esc(truncate(p.title, 24))}</option>`).join('')}
        </select>
        <button id="ref-peek-next" type="button" class="px-2 py-1 rounded-lg text-xs font-bold cursor-pointer bg-amber-900/10 hover:bg-amber-900/20 border-0" ${pIdx < ordered.length - 1 ? '' : 'disabled'}>&rsaquo;</button>
      </div>
      <div class="flex-1 overflow-y-auto nice-scroll rounded-xl p-3 text-xs leading-relaxed select-text" style="background:#fffdf8; border:1.5px solid rgba(122,92,68,0.2);">
        <div class="font-storybook font-bold text-sm mb-1.5 pb-1 border-b" style="color:#2d1a0f; border-color:rgba(122,92,68,0.16);">${esc(refPage.title)}</div>
        <div id="ref-peek-content" class="space-y-1">${refPage.html || plainTextToHtml(refPage.body || '') || '<em class="opacity-60">Empty page</em>'}</div>
      </div>
      <div class="pt-2 mt-2 border-t flex items-center justify-between gap-1.5" style="border-color:rgba(122,92,68,0.2);">
        <button id="btn-ref-peek-cite" type="button" title="Insert a book-colored internal scroll link to this reference page into your active editor"
                class="flex-1 rounded-xl py-1.5 px-2.5 text-[11px] font-bold cursor-pointer border-0"
                style="background:${rsw.fill}; color:#fffaf2;">&#167; Cite Scroll in Page</button>
        <button id="btn-ref-peek-swap" type="button" title="Switch main open book to this volume"
                class="rounded-xl py-1.5 px-2.5 text-[11px] font-semibold cursor-pointer"
                style="background:rgba(130,96,62,0.14); color:#362215; border:1px solid rgba(130,96,68,0.25);">Open &rarr;</button>
      </div>
    ` : `<div class="flex-1 flex items-center justify-center text-xs italic opacity-70">No pages in this book yet.</div>`}
  `;

  refreshInternalLinkColors(bookRefPeekEl.querySelector('#ref-peek-content'));
  document.getElementById('btn-close-ref-peek')?.addEventListener('click', closeReferencePeek);
  document.getElementById('ref-peek-book-sel')?.addEventListener('change', (e) => {
    openReferencePeek(e.target.value, null);
  });
  document.getElementById('ref-peek-page-sel')?.addEventListener('change', (e) => {
    refPeekState.pageId = e.target.value;
    renderReferencePeekDrawer();
  });
  document.getElementById('ref-peek-prev')?.addEventListener('click', () => {
    if (pIdx > 0) { refPeekState.pageId = ordered[pIdx - 1].id; renderReferencePeekDrawer(); }
  });
  document.getElementById('ref-peek-next')?.addEventListener('click', () => {
    if (pIdx < ordered.length - 1) { refPeekState.pageId = ordered[pIdx + 1].id; renderReferencePeekDrawer(); }
  });
  document.getElementById('btn-ref-peek-cite')?.addEventListener('click', () => {
    const editorEl = document.getElementById('open-page-editor');
    if (!editorEl || !refPage) return;
    const linkNode = makeInternalLinkNode(`${refBook.title}: ${refPage.title}`, refBook.id, refPage.id);
    insertNodeAtCaret(editorEl, linkNode);
    editorEl.dispatchEvent(new Event('input'));
    showToast(`Cited "${refPage.title}" in page`);
  });
  document.getElementById('btn-ref-peek-swap')?.addEventListener('click', () => {
    openBookCenter(entry.hall.id, refBook.id, refPage?.id || null, openBookViewMode);
  });
}

// ---- INTERACTIVE D&D 5e (2014) / 2024 CHARACTER SHEET RENDERER ----
function renderDndSheetRightPage(book, hall, activePage, orderedPages, activeIdx, sw, activeChapter, animateTurn) {
  if (!book.dndChar) book.dndChar = createDefaultDndCharData(book.title || 'Adventurer', '2024');
  const ch = book.dndChar;
  const is2024 = ch.edition !== '5e';
  const prof = dndProfBonus(ch.level);
  const prevPage = orderedPages[activeIdx - 1];
  const nextPage = orderedPages[activeIdx + 1];
  const chColor = getSwatch(activeChapter?.color || book.color || hall.color);

  const getAbMod = (ab) => dndMod(ch.abilities?.[ab] ?? 10);
  const getSaveMod = (ab) => getAbMod(ab) + (ch.saveProfs?.[ab] ? prof : 0);
  const getSkillMod = (sk) => {
    const rank = Number(ch.skillProfs?.[sk.key]) || 0;
    return getAbMod(sk.ab) + (rank === 2 ? prof * 2 : (rank === 1 ? prof : 0));
  };
  const percSkill = DND_SKILLS.find(s => s.key === 'perception');
  const passivePerc = 10 + getSkillMod(percSkill);
  const initMod = getAbMod('dex') + (Number(ch.initBonus) || 0);
  const spellMod = getAbMod(ch.spellAbility || 'int');
  const spellDC = 8 + prof + spellMod;
  const spellAtk = prof + spellMod;

  const sheetPageTabs = book.pages.filter(p => p.sheetType);
  const rollBannerHtml = dndLastRoll ? `
    <div id="dnd-roll-banner" class="dnd-roll-banner ${dndLastRoll.isCrit ? 'is-crit' : (dndLastRoll.isFumble ? 'is-fumble' : '')} px-3 py-1.5 mb-2 flex items-center justify-between gap-2 text-xs">
      <div class="flex items-center gap-2 min-w-0 flex-wrap">
        <span class="font-bold text-amber-300">&#127922; ${esc(dndLastRoll.label)}</span>
        <span class="font-mono text-[11px] opacity-85">${esc(dndLastRoll.detail)}</span>
        ${dndLastRoll.isCrit ? `<span class="px-1.5 py-0.2 rounded-full text-[9.5px] font-extrabold bg-amber-300 text-amber-950">NAT 20!</span>` : ''}
        ${dndLastRoll.isFumble ? `<span class="px-1.5 py-0.2 rounded-full text-[9.5px] font-extrabold bg-red-500 text-white">NAT 1</span>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="font-storybook font-extrabold text-base text-amber-200">${dndLastRoll.total}</span>
        <button id="dnd-clear-roll" type="button" class="text-xs opacity-75 hover:opacity-100 bg-transparent border-0 text-amber-100 cursor-pointer">&times;</button>
      </div>
    </div>
  ` : '';

  const topBarHtml = `
    <div class="rounded-xl px-2.5 py-1.5 mb-2 flex items-center justify-between gap-1.5 flex-wrap" style="background:rgba(130,96,62,0.1); border:1.4px solid rgba(125,87,54,0.35);">
      <div class="flex items-center gap-1 flex-wrap">
        <!-- Edition Toggle: 5e (2014) vs 2024 -->
        <div class="inline-flex rounded-lg p-0.5" style="background:rgba(60,37,22,0.12); border:1px solid rgba(60,37,22,0.22);">
          <button type="button" data-dnd-edition="5e" class="px-2 py-0.5 rounded-md text-[10px] font-extrabold cursor-pointer border-0"
                  style="background:${!is2024 ? '#3c2516' : 'transparent'}; color:${!is2024 ? '#fffaf0' : '#5a3b22'};">5e (2014)</button>
          <button type="button" data-dnd-edition="2024" class="px-2 py-0.5 rounded-md text-[10px] font-extrabold cursor-pointer border-0"
                  style="background:${is2024 ? '#3c2516' : 'transparent'}; color:${is2024 ? '#fffaf0' : '#5a3b22'};">2024</button>
        </div>
        <!-- Roll Mode Toggle: Normal / Adv / Dis -->
        <div class="inline-flex rounded-lg p-0.5" style="background:rgba(60,37,22,0.1); border:1px solid rgba(60,37,22,0.2);" title="Dice roll mode">
          ${[['normal', '1d20'], ['adv', 'Adv'], ['dis', 'Dis']].map(([m, lbl]) => `
            <button type="button" data-dnd-rollmode="${m}" class="px-1.5 py-0.5 rounded-md text-[10px] font-bold cursor-pointer border-0"
                    style="background:${dndRollMode === m ? chColor.fill : 'transparent'}; color:${dndRollMode === m ? '#fffaf2' : '#5a3b22'};">${lbl}</button>
          `).join('')}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-wrap">
        <button id="dnd-short-rest" type="button" title="Short Rest: spend 1 Hit Die + CON mod to heal" class="px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer" style="background:#fffaf0; color:#4a301e; border:1px solid #8a6544;">&#9749; Short Rest</button>
        <button id="dnd-long-rest" type="button" title="Long Rest: restore full HP, half Hit Dice, Death Saves &amp; all Spell Slots" class="px-2 py-0.5 rounded-lg text-[10px] font-bold cursor-pointer" style="background:#f5c663; color:#352012; border:1px solid #8a6544;">&#9790; Long Rest</button>
        <button id="btn-toggle-ref-peek" type="button" class="text-[10px] font-bold px-2 py-0.5 rounded-lg cursor-pointer" style="background:${refPeekState.open ? '#f5c663' : 'rgba(130,96,62,0.1)'}; color:#362215; border:1px solid rgba(130,96,62,0.28);">&#128065; Peek</button>
        <button id="btn-toggle-single-page" type="button" class="text-[10px] font-bold px-2 py-0.5 rounded-lg cursor-pointer" style="background:${openBookViewMode === 'single' ? chColor.fill : 'rgba(130,96,62,0.1)'}; color:${openBookViewMode === 'single' ? '#fffaf2' : '#362215'}; border:1px solid rgba(130,96,62,0.28);">${openBookViewMode === 'single' ? '&#128214; Spread' : '&#9634; Full Sheet'}</button>
      </div>
    </div>
    ${sheetPageTabs.length > 1 ? `
      <div class="flex items-center gap-1 mb-2 flex-wrap">
        ${sheetPageTabs.map(sp => {
          const act = sp.id === activePage.id;
          return `<button type="button" data-dnd-jump-page="${sp.id}" class="px-2.5 py-0.5 rounded-lg text-[10.5px] font-storybook font-bold cursor-pointer"
                          style="background:${act ? chColor.fill : 'rgba(130,96,62,0.09)'}; color:${act ? '#fffaf2' : '#4a301e'}; border:1.2px solid ${act ? chColor.deep : 'rgba(130,96,62,0.28)'};">${esc(sp.title)}</button>`;
        }).join('')}
      </div>
    ` : ''}
  `;

  let sheetBodyHtml = '';

  if (activePage.sheetType === 'dnd-core') {
    sheetBodyHtml = `
      <!-- CHARACTER HEADER BANNER -->
      <div class="dnd-box p-2.5 mb-2.5 space-y-2">
        <div class="grid grid-cols-12 gap-2 items-end">
          <div class="col-span-6 sm:col-span-5">
            <div class="dnd-label">Character Name</div>
            <input data-dnd-field="name" type="text" value="${esc(ch.name)}" placeholder="Character Name…" class="dnd-input font-storybook font-bold text-base py-0.5" />
          </div>
          <div class="col-span-4 sm:col-span-3">
            <div class="dnd-label">Class</div>
            <input data-dnd-field="className" type="text" value="${esc(ch.className)}" placeholder="e.g. Wizard" class="dnd-input text-xs font-semibold py-0.5" />
          </div>
          <div class="col-span-2 sm:col-span-1">
            <div class="dnd-label">Lvl</div>
            <input data-dnd-num="level" type="number" min="1" max="20" value="${ch.level}" class="dnd-input text-xs font-bold text-center py-0.5" />
          </div>
          <div class="col-span-6 sm:col-span-3">
            <div class="dnd-label">${is2024 ? 'Species' : 'Race'}</div>
            <input data-dnd-field="species" type="text" value="${esc(ch.species)}" placeholder="${is2024 ? 'e.g. Elf, Halfling' : 'e.g. High Elf'}" class="dnd-input text-xs py-0.5" />
          </div>
        </div>
        <div class="grid grid-cols-12 gap-2 items-end">
          ${is2024 ? `
            <div class="col-span-4">
              <div class="dnd-label">Subclass</div>
              <input data-dnd-field="subclass" type="text" value="${esc(ch.subclass)}" placeholder="e.g. Evoker" class="dnd-input text-xs py-0.5" />
            </div>
            <div class="col-span-4">
              <div class="dnd-label">Background</div>
              <input data-dnd-field="background" type="text" value="${esc(ch.background)}" placeholder="e.g. Sage" class="dnd-input text-xs py-0.5" />
            </div>
            <div class="col-span-4">
              <div class="dnd-label">Origin Feat</div>
              <input data-dnd-field="originFeat" type="text" value="${esc(ch.originFeat)}" placeholder="e.g. Alert, Magic Initiate" class="dnd-input text-xs py-0.5" />
            </div>
          ` : `
            <div class="col-span-4">
              <div class="dnd-label">Background</div>
              <input data-dnd-field="background" type="text" value="${esc(ch.background)}" placeholder="e.g. Sage" class="dnd-input text-xs py-0.5" />
            </div>
            <div class="col-span-4">
              <div class="dnd-label">Alignment</div>
              <input data-dnd-field="alignment" type="text" value="${esc(ch.alignment)}" placeholder="e.g. Neutral Good" class="dnd-input text-xs py-0.5" />
            </div>
            <div class="col-span-4">
              <div class="dnd-label">Experience Points</div>
              <input data-dnd-num="xp" type="number" min="0" value="${ch.xp}" class="dnd-input text-xs py-0.5" />
            </div>
          `}
        </div>
      </div>

      <!-- 2-COLUMN CORE SHEET -->
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <!-- LEFT COLUMN: ABILITIES + SAVES + SKILLS -->
        <div class="sm:col-span-5 space-y-2">
          <!-- 6 Ability Scores -->
          <div class="grid grid-cols-3 gap-1.5">
            ${DND_ABILITIES.map(ab => {
              const sc = ch.abilities[ab.key] ?? 10;
              const mod = getAbMod(ab.key);
              return `
                <div class="dnd-ability-card">
                  <span class="dnd-label">${ab.label}</span>
                  <button type="button" data-dnd-roll-label="${ab.name} Check" data-dnd-roll-mod="${mod}"
                          title="Roll ${ab.name} Check (1d20 ${fmtSigned(mod)})"
                          class="dnd-roll-btn font-storybook font-extrabold text-base px-2 py-0.2 rounded-lg bg-transparent border-0" style="color:#2d1a0f;">
                    ${fmtSigned(mod)}
                  </button>
                  <input data-dnd-ability="${ab.key}" type="number" min="1" max="30" value="${sc}"
                         class="w-11 text-center text-[11px] font-bold rounded-md py-0.2 outline-none"
                         style="background:#fffaf0; border:1.2px solid #8a6544; color:#362215;" />
                </div>
              `;
            }).join('')}
          </div>

          <!-- Inspiration, Prof Bonus & Passive Perception -->
          <div class="grid grid-cols-3 gap-1.5">
            <button id="dnd-toggle-insp" type="button" class="dnd-box p-1.5 text-center cursor-pointer transition-colors"
                    style="background:${ch.inspiration ? '#fbe59c' : 'rgba(255,252,244,0.78)'};">
              <div class="dnd-label leading-tight">${is2024 ? 'Heroic Insp.' : 'Inspiration'}</div>
              <div class="text-sm font-bold" style="color:${ch.inspiration ? '#8a4f00' : '#9c8066'};">${ch.inspiration ? '&#9733;' : '&#9734;'}</div>
            </button>
            <div class="dnd-box p-1.5 text-center">
              <div class="dnd-label leading-tight">Prof. Bonus</div>
              <div class="font-storybook font-extrabold text-sm" style="color:#2d1a0f;">${fmtSigned(prof)}</div>
            </div>
            <div class="dnd-box p-1.5 text-center">
              <div class="dnd-label leading-tight">Pass. Perc.</div>
              <div class="font-storybook font-extrabold text-sm" style="color:#2d1a0f;">${passivePerc}</div>
            </div>
          </div>

          <!-- Saving Throws -->
          <div class="dnd-box p-2">
            <div class="dnd-label mb-1">Saving Throws</div>
            <div class="grid grid-cols-2 gap-x-2 gap-y-1">
              ${DND_ABILITIES.map(ab => {
                const isP = Boolean(ch.saveProfs[ab.key]);
                const mod = getSaveMod(ab.key);
                return `
                  <div class="flex items-center gap-1.5 text-[11px]">
                    <button type="button" data-dnd-save-prof="${ab.key}" title="Toggle ${ab.name} Save Proficiency"
                            class="dnd-prof-pip ${isP ? 'is-prof' : ''}"></button>
                    <button type="button" data-dnd-roll-label="${ab.name} Save" data-dnd-roll-mod="${mod}"
                            class="dnd-roll-btn font-mono font-bold text-[11px] px-1 rounded bg-transparent border-0" style="color:#2d1a0f;">${fmtSigned(mod)}</button>
                    <span class="truncate" style="color:#4a301e;">${ab.label}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Skills (18) -->
          <div class="dnd-box p-2">
            <div class="flex items-center justify-between mb-1">
              <span class="dnd-label">Skills</span>
              <span class="text-[8.5px]" style="color:#8a6a4e;">Click dot: None / Prof / Exp</span>
            </div>
            <div class="space-y-0.5">
              ${DND_SKILLS.map(sk => {
                const rank = Number(ch.skillProfs?.[sk.key]) || 0;
                const mod = getSkillMod(sk);
                return `
                  <div class="flex items-center gap-1.5 text-[10.8px] leading-tight">
                    <button type="button" data-dnd-skill-prof="${sk.key}"
                            title="${rank === 2 ? 'Expertise (click to clear)' : (rank === 1 ? 'Proficient (click for Expertise)' : 'Not proficient (click for Proficiency)')}"
                            class="dnd-prof-pip ${rank === 2 ? 'is-exp' : (rank === 1 ? 'is-prof' : '')}"></button>
                    <button type="button" data-dnd-roll-label="${sk.label}" data-dnd-roll-mod="${mod}"
                            class="dnd-roll-btn font-mono font-bold text-[10.8px] w-7 text-right px-0.5 rounded bg-transparent border-0 shrink-0" style="color:#2d1a0f;">${fmtSigned(mod)}</button>
                    <span class="truncate flex-1" style="color:#362215;">${sk.label}</span>
                    <span class="text-[9px] uppercase opacity-60 shrink-0">${sk.ab}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN: COMBAT, HP, ATTACKS, FEATURES -->
        <div class="sm:col-span-7 space-y-2">
          <!-- AC, Initiative, Speed -->
          <div class="grid grid-cols-3 gap-1.5">
            <div class="dnd-box p-2 text-center">
              <div class="dnd-label">Armor Class</div>
              <input data-dnd-num="ac" type="number" min="0" max="40" value="${ch.ac}" class="dnd-input text-center font-storybook font-extrabold text-lg" />
            </div>
            <div class="dnd-box p-2 text-center">
              <div class="dnd-label">Initiative</div>
              <button type="button" data-dnd-roll-label="Initiative" data-dnd-roll-mod="${initMod}"
                      title="Roll Initiative (1d20 ${fmtSigned(initMod)})"
                      class="dnd-roll-btn font-storybook font-extrabold text-lg px-2 rounded-lg bg-transparent border-0" style="color:#2d1a0f;">
                ${fmtSigned(initMod)}
              </button>
            </div>
            <div class="dnd-box p-2 text-center">
              <div class="dnd-label">Speed</div>
              <input data-dnd-field="speed" type="text" value="${esc(ch.speed)}" class="dnd-input text-center font-storybook font-bold text-sm mt-1" />
            </div>
          </div>

          <!-- Hit Points, Hit Dice, Death Saves & 2024 Exhaustion -->
          <div class="dnd-box p-2.5 space-y-2">
            <div class="grid grid-cols-3 gap-2 items-end">
              <div>
                <div class="dnd-label">Current HP</div>
                <input data-dnd-num="hpCur" type="number" value="${ch.hpCur}" class="dnd-input font-storybook font-extrabold text-lg text-center" style="color:${ch.hpCur <= 0 ? '#a82b1f' : '#2f5e36'};" />
              </div>
              <div>
                <div class="dnd-label">Max HP</div>
                <input data-dnd-num="hpMax" type="number" min="1" value="${ch.hpMax}" class="dnd-input font-storybook font-bold text-base text-center" />
              </div>
              <div>
                <div class="dnd-label">Temp HP</div>
                <input data-dnd-num="hpTemp" type="number" min="0" value="${ch.hpTemp}" class="dnd-input font-storybook font-bold text-base text-center" style="color:#3e698a;" />
              </div>
            </div>
            <div class="flex items-center justify-center gap-1.5">
              ${[-5, -1, 1, 5].map(delta => `
                <button type="button" data-dnd-hp-delta="${delta}" class="px-2 py-0.5 rounded-lg text-[10px] font-extrabold cursor-pointer"
                        style="background:${delta < 0 ? 'rgba(185,66,46,0.12)' : 'rgba(67,128,74,0.14)'}; color:${delta < 0 ? '#8f2e1e' : '#2d5c32'}; border:1px solid ${delta < 0 ? 'rgba(185,66,46,0.35)' : 'rgba(67,128,74,0.35)'};">
                  ${delta > 0 ? `+${delta}` : delta} HP
                </button>
              `).join('')}
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1.5 border-t" style="border-color:rgba(125,87,54,0.2);">
              <div>
                <div class="dnd-label mb-0.5">Hit Dice</div>
                <div class="flex items-center gap-1 text-xs">
                  <input data-dnd-num="hitDiceSpent" type="number" min="0" value="${ch.hitDiceSpent}" title="Spent" class="w-9 text-center rounded border px-1 py-0.2 text-[11px]" style="border-color:#c5ab86; background:#fff;" />
                  <span>/</span>
                  <input data-dnd-num="hitDiceTotal" type="number" min="1" value="${ch.hitDiceTotal}" title="Total" class="w-9 text-center rounded border px-1 py-0.2 text-[11px]" style="border-color:#c5ab86; background:#fff;" />
                  <select data-dnd-field="hitDieType" class="rounded border px-1 py-0.2 text-[10.5px]" style="border-color:#c5ab86; background:#fff;">
                    ${['d6', 'd8', 'd10', 'd12'].map(d => `<option value="${d}" ${ch.hitDieType === d ? 'selected' : ''}>${d}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div>
                <div class="dnd-label mb-0.5">Death Saves</div>
                <div class="space-y-1 text-[10px]">
                  <div class="flex items-center gap-1">
                    <span class="w-10 font-bold" style="color:#2f5e36;">Pass</span>
                    ${[1, 2, 3].map(n => `<button type="button" data-dnd-ds="deathSuccess:${n}" class="dnd-prof-pip ${ch.deathSuccess >= n ? 'is-prof' : ''}" style="${ch.deathSuccess >= n ? 'background:#3e7a46; border-color:#244c2a;' : ''}"></button>`).join('')}
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="w-10 font-bold" style="color:#9e3324;">Fail</span>
                    ${[1, 2, 3].map(n => `<button type="button" data-dnd-ds="deathFail:${n}" class="dnd-prof-pip ${ch.deathFail >= n ? 'is-prof' : ''}" style="${ch.deathFail >= n ? 'background:#a83324; border-color:#5e1a12;' : ''}"></button>`).join('')}
                  </div>
                </div>
              </div>
            </div>
            ${is2024 ? `
              <div class="flex items-center justify-between pt-1.5 border-t text-[10.5px]" style="border-color:rgba(125,87,54,0.2);">
                <span class="dnd-label">2024 Exhaustion (${ch.exhaustion ? `-${ch.exhaustion * 2} d20` : 'None'})</span>
                <div class="flex items-center gap-1">
                  ${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" data-dnd-exh="${n}" class="dnd-slot-pip ${ch.exhaustion >= n ? 'is-used' : ''}" title="Exhaustion level ${n}"></button>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Attacks & Spellcasting -->
          <div class="dnd-box p-2 space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="dnd-label">Attacks &amp; Spellcasting</span>
              <button id="dnd-add-atk" type="button" class="px-1.5 py-0.2 rounded text-[10px] font-bold cursor-pointer" style="background:${chColor.soft}; color:${chColor.deep}; border:1px solid ${chColor.fill};">+ Attack</button>
            </div>
            <div class="space-y-1">
              ${(ch.attacks || []).map((atk, idx) => `
                <div class="flex items-center gap-1 text-[11px]">
                  <input data-dnd-atk="name:${idx}" type="text" value="${esc(atk.name)}" placeholder="Weapon / Cantrip" class="dnd-input flex-1 min-w-[72px] font-semibold text-[11px]" />
                  <input data-dnd-atk="bonus:${idx}" type="text" value="${esc(atk.bonus)}" placeholder="+5" title="Attack bonus" class="dnd-input w-10 text-center font-mono font-bold text-[11px]" />
                  <button type="button" data-dnd-roll-atk="${idx}" title="Roll attack (1d20 ${esc(atk.bonus)})" class="dnd-roll-btn px-1 py-0.2 rounded text-[10px] font-bold border" style="background:#fffaf0; border-color:#8a6544; color:#3c2516;">&#127922;</button>
                  <input data-dnd-atk="damage:${idx}" type="text" value="${esc(atk.damage)}" placeholder="1d8+3 slash" class="dnd-input w-24 text-[10.5px]" />
                  <button type="button" data-dnd-roll-dmg="${idx}" title="Roll damage dice" class="dnd-roll-btn px-1 py-0.2 rounded text-[10px] font-bold border" style="background:#fffaf0; border-color:#8a6544; color:#8f2e1e;">Dmg</button>
                  ${is2024 ? `<input data-dnd-atk="mastery:${idx}" type="text" value="${esc(atk.mastery || '')}" placeholder="Mastery" class="dnd-input w-14 text-[10px]" />` : ''}
                  <button type="button" data-dnd-del-atk="${idx}" class="px-1 text-xs font-bold bg-transparent border-0 text-red-700/75 hover:text-red-700 cursor-pointer">&times;</button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Features & Traits (+ 5e Personality Block) -->
          <div class="dnd-box p-2 space-y-1.5">
            <div class="dnd-label">${is2024 ? 'Class Features, Species Traits &amp; Feats' : 'Features &amp; Traits'}</div>
            <textarea data-dnd-field="features" rows="${is2024 ? 6 : 4}" placeholder="Key class features, feats, and racial/species traits…"
                      class="w-full rounded-lg p-1.5 text-xs outline-none resize-y" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.25); color:#2c190d;">${esc(ch.features)}</textarea>
          </div>

          ${!is2024 ? `
            <div class="dnd-box p-2 grid grid-cols-2 gap-1.5">
              <div>
                <div class="dnd-label">Personality Traits</div>
                <textarea data-dnd-field="traits" rows="2" class="w-full rounded p-1 text-[11px] outline-none" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.22);">${esc(ch.traits)}</textarea>
              </div>
              <div>
                <div class="dnd-label">Ideals</div>
                <textarea data-dnd-field="ideals" rows="2" class="w-full rounded p-1 text-[11px] outline-none" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.22);">${esc(ch.ideals)}</textarea>
              </div>
              <div>
                <div class="dnd-label">Bonds</div>
                <textarea data-dnd-field="bonds" rows="2" class="w-full rounded p-1 text-[11px] outline-none" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.22);">${esc(ch.bonds)}</textarea>
              </div>
              <div>
                <div class="dnd-label">Flaws</div>
                <textarea data-dnd-field="flaws" rows="2" class="w-full rounded p-1 text-[11px] outline-none" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.22);">${esc(ch.flaws)}</textarea>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  } else if (activePage.sheetType === 'dnd-bio') {
    sheetBodyHtml = `
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <!-- Portrait & Appearance -->
        <div class="sm:col-span-5 space-y-2">
          <div class="dnd-box p-2.5 text-center space-y-1.5">
            <div class="dnd-label">Character Portrait</div>
            ${ch.portrait
              ? `<div class="relative"><img src="${ch.portrait}" alt="Portrait" class="w-full max-h-48 object-cover rounded-xl" style="border:1.8px solid #5c3a21;" /><button id="dnd-clear-portrait" type="button" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full text-xs font-bold cursor-pointer" style="background:#fffaf0; color:#8f2e1e; border:1.5px solid #3c2516;">&times;</button></div>`
              : `<button id="dnd-pick-portrait" type="button" class="w-full h-36 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer text-xs font-semibold" style="background:rgba(130,96,62,0.08); border:1.8px dashed #8a6544; color:#6d4c33;"><span>+ Upload Portrait</span><span class="text-[10px] opacity-75">PNG or JPG</span></button>`
            }
            ${ch.portrait ? `<button id="dnd-pick-portrait" type="button" class="text-[10.5px] font-bold underline bg-transparent border-0 cursor-pointer" style="color:#7a5638;">Change Portrait</button>` : ''}
          </div>

          <div class="dnd-box p-2.5 grid grid-cols-2 gap-2">
            ${[['age', 'Age'], ['size', 'Size'], ['height', 'Height'], ['weight', 'Weight'], ['eyes', 'Eyes'], ['skin', 'Skin'], ['hair', 'Hair']].map(([k, lbl]) => `
              <div>
                <div class="dnd-label">${lbl}</div>
                <input data-dnd-field="${k}" type="text" value="${esc(ch[k] || '')}" class="dnd-input text-xs py-0.5" />
              </div>
            `).join('')}
          </div>

          <div class="dnd-box p-2.5 space-y-1.5">
            <div class="dnd-label">Proficiencies &amp; Languages</div>
            <textarea data-dnd-field="proficiencies" rows="4" placeholder="Armor, weapons, tools, and languages…"
                      class="w-full rounded-lg p-1.5 text-xs outline-none resize-y" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.25);">${esc(ch.proficiencies)}</textarea>
          </div>
        </div>

        <!-- Currency, Attunement, Equipment & Backstory -->
        <div class="sm:col-span-7 space-y-2">
          <div class="dnd-box p-2.5">
            <div class="dnd-label mb-1.5">Coin Purse</div>
            <div class="grid grid-cols-5 gap-1.5 text-center">
              ${[['cp', 'CP', '#b8734b'], ['sp', 'SP', '#9aa3ab'], ['ep', 'EP', '#8ca4b0'], ['gp', 'GP', '#d49d35'], ['pp', 'PP', '#b6c4d1']].map(([k, lbl, col]) => `
                <div class="rounded-lg p-1" style="background:rgba(255,250,240,0.9); border:1.5px solid ${col};">
                  <div class="text-[9px] font-extrabold" style="color:#5a3b22;">${lbl}</div>
                  <input data-dnd-coin="${k}" type="number" min="0" value="${ch.coins[k] ?? 0}" class="w-full text-center font-mono font-bold text-xs bg-transparent border-0 outline-none" style="color:#2d1a0f;" />
                </div>
              `).join('')}
            </div>
          </div>

          <div class="dnd-box p-2.5 space-y-1.5">
            <div class="dnd-label">Magic Item Attunement (3 Slots)</div>
            ${(ch.attunement || []).map((at, idx) => `
              <div class="flex items-center gap-1.5">
                <input data-dnd-att-chk="${idx}" type="checkbox" ${at.active ? 'checked' : ''} class="accent-amber-700 cursor-pointer" />
                <input data-dnd-att-name="${idx}" type="text" value="${esc(at.name)}" placeholder="Attuned magic item #${idx + 1}…" class="dnd-input text-xs py-0.5" />
              </div>
            `).join('')}
          </div>

          <div class="dnd-box p-2.5 space-y-1">
            <div class="dnd-label">Equipment &amp; Inventory</div>
            <textarea data-dnd-field="equipment" rows="5" placeholder="Pack, rations, torches, rope, magic items, treasure…"
                      class="w-full rounded-lg p-1.5 text-xs outline-none resize-y" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.25);">${esc(ch.equipment)}</textarea>
          </div>

          <div class="dnd-box p-2.5 space-y-1">
            <div class="dnd-label">Character Backstory</div>
            <textarea data-dnd-field="backstory" rows="4" placeholder="Where did your adventurer come from?"
                      class="w-full rounded-lg p-1.5 text-xs outline-none resize-y" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.25);">${esc(ch.backstory)}</textarea>
          </div>

          <div class="dnd-box p-2.5 space-y-1">
            <div class="dnd-label">Allies &amp; Organizations</div>
            <textarea data-dnd-field="allies" rows="3" placeholder="Guilds, patrons, party bonds…"
                      class="w-full rounded-lg p-1.5 text-xs outline-none resize-y" style="background:rgba(255,253,247,0.75); border:1px solid rgba(125,87,54,0.25);">${esc(ch.allies)}</textarea>
          </div>
        </div>
      </div>
    `;
  } else if (activePage.sheetType === 'dnd-spells') {
    sheetBodyHtml = `
      <!-- SPELLCASTING HEADER -->
      <div class="dnd-box p-2.5 mb-2.5 grid grid-cols-12 gap-2 items-end">
        <div class="col-span-5 sm:col-span-4">
          <div class="dnd-label">Spellcasting Class</div>
          <input data-dnd-field="spellClass" type="text" value="${esc(ch.spellClass || ch.className)}" placeholder="e.g. Wizard, Cleric" class="dnd-input font-storybook font-bold text-sm py-0.5" />
        </div>
        <div class="col-span-3 sm:col-span-3">
          <div class="dnd-label">Ability</div>
          <select data-dnd-field="spellAbility" class="dnd-input text-xs font-bold py-0.5 cursor-pointer">
            ${[['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']].map(([k, lbl]) => `<option value="${k}" ${ch.spellAbility === k ? 'selected' : ''}>${lbl} (${fmtSigned(getAbMod(k))})</option>`).join('')}
          </select>
        </div>
        <div class="col-span-2 sm:col-span-2 text-center">
          <div class="dnd-label">Save DC</div>
          <div class="font-storybook font-extrabold text-base" style="color:#2d1a0f;">${spellDC}</div>
        </div>
        <div class="col-span-2 sm:col-span-3 text-center">
          <div class="dnd-label">Spell Atk</div>
          <button type="button" data-dnd-roll-label="Spell Attack" data-dnd-roll-mod="${spellAtk}"
                  title="Roll Spell Attack (1d20 ${fmtSigned(spellAtk)})"
                  class="dnd-roll-btn font-storybook font-extrabold text-base px-2 rounded-lg bg-transparent border-0" style="color:#2d1a0f;">
            ${fmtSigned(spellAtk)}
          </button>
        </div>
      </div>

      <!-- CANTRIPS & SPELL LEVELS 1-9 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${Array.from({ length: 10 }, (_, lv) => {
          const bucket = ch.spells[lv] || { slotsTotal: 0, slotsUsed: 0, list: [] };
          const isCantrip = lv === 0;
          return `
            <div class="dnd-box p-2 space-y-1.5">
              <div class="flex items-center justify-between gap-1 flex-wrap">
                <span class="dnd-label">${isCantrip ? 'Cantrips (0)' : `Level ${lv} Spells`}</span>
                <div class="flex items-center gap-1">
                  ${!isCantrip ? `
                    <span class="text-[9.5px] font-bold" style="color:#7a5638;">Slots:</span>
                    <input data-dnd-slots-total="${lv}" type="number" min="0" max="9" value="${bucket.slotsTotal}" class="w-8 text-center rounded border text-[10.5px] font-bold" style="border-color:#c5ab86; background:#fff;" />
                  ` : ''}
                  <button type="button" data-dnd-add-spell="${lv}" class="px-1.5 py-0.2 rounded text-[9.5px] font-bold cursor-pointer" style="background:${chColor.soft}; color:${chColor.deep}; border:1px solid ${chColor.fill};">+ Spell</button>
                </div>
              </div>
              ${!isCantrip && bucket.slotsTotal > 0 ? `
                <div class="flex items-center gap-1 flex-wrap">
                  ${Array.from({ length: bucket.slotsTotal }, (_, i) => `
                    <button type="button" data-dnd-slot-pip="${lv}:${i + 1}" title="Click to mark slot ${i + 1} used/available"
                            class="dnd-slot-pip ${i < bucket.slotsUsed ? 'is-used' : ''}"></button>
                  `).join('')}
                  <span class="text-[9.5px] ml-1" style="color:#7a5638;">${Math.max(0, bucket.slotsTotal - bucket.slotsUsed)}/${bucket.slotsTotal} left</span>
                </div>
              ` : ''}
              <div class="space-y-1">
                ${(bucket.list || []).map((sp, sIdx) => `
                  <div class="flex items-center gap-1 text-[11px]">
                    ${!isCantrip ? `<input data-dnd-sp-prep="${lv}:${sIdx}" type="checkbox" ${sp.prepared ? 'checked' : ''} title="Prepared" class="accent-amber-700 cursor-pointer" />` : ''}
                    <input data-dnd-sp-name="${lv}:${sIdx}" type="text" value="${esc(sp.name)}" placeholder="Spell name…" class="dnd-input flex-1 min-w-0 text-[11px] font-semibold" />
                    <input data-dnd-sp-note="${lv}:${sIdx}" type="text" value="${esc(sp.note)}" placeholder="Note (C, R…)" class="dnd-input w-16 text-[10px]" />
                    <button type="button" data-dnd-del-spell="${lv}:${sIdx}" class="px-1 text-xs font-bold bg-transparent border-0 text-red-700/75 hover:text-red-700 cursor-pointer">&times;</button>
                  </div>
                `).join('') || `<div class="text-[10px] italic" style="color:#9a7b5d;">No ${isCantrip ? 'cantrips' : `level ${lv} spells`} yet</div>`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  bookRightEl.innerHTML = `
    <div id="right-page-dropzone" class="flex flex-col flex-1 min-h-0 relative ${animateTurn ? 'page-turn-anim' : ''}">
      ${topBarHtml}
      ${rollBannerHtml}
      <div id="dnd-sheet-scroll" class="flex-1 overflow-y-auto nice-scroll pr-1 pb-1">
        ${sheetBodyHtml}
      </div>
      <div class="pt-2 mt-1.5 border-t flex items-center justify-between gap-2" style="border-color:rgba(122,92,68,0.2);">
        <button id="open-prev-page" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-35"
                style="background:rgba(130,96,62,0.12); color:#362215; border:1.5px solid rgba(130,96,62,0.28);" ${prevPage ? '' : 'disabled'}>&larr; Prev Page</button>
        <span class="text-[11px] font-storybook italic" style="color:#8a6a4e;">&sim; ${esc(activePage.title)} (${activeIdx + 1}/${orderedPages.length}) &sim;</span>
        <button id="open-next-page" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-35"
                style="background:rgba(130,96,62,0.12); color:#362215; border:1.5px solid rgba(130,96,62,0.28);" ${nextPage ? '' : 'disabled'}>Next Page &rarr;</button>
      </div>
    </div>
  `;

  // ---- WIRE D&D CHARACTER SHEET CONTROLS ----
  const rerenderSheet = () => { persistState(); renderOpenBook(false); };

  bookRightEl.querySelectorAll('[data-dnd-edition]').forEach(btn => {
    btn.addEventListener('click', () => {
      ch.edition = btn.dataset.dndEdition;
      commitChange();
      showToast(ch.edition === '2024' ? 'Switched sheet to D&D 2024 rules' : 'Switched sheet to D&D 5e (2014) rules');
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-rollmode]').forEach(btn => {
    btn.addEventListener('click', () => {
      dndRollMode = btn.dataset.dndRollmode;
      renderOpenBook(false);
    });
  });
  document.getElementById('dnd-clear-roll')?.addEventListener('click', () => {
    dndLastRoll = null;
    renderOpenBook(false);
  });
  document.getElementById('dnd-short-rest')?.addEventListener('click', () => {
    const avail = Math.max(0, (Number(ch.hitDiceTotal) || 1) - (Number(ch.hitDiceSpent) || 0));
    if (avail <= 0) {
      showToast('Short Rest taken (no Hit Dice remaining to spend)');
      return;
    }
    const sides = parseInt((ch.hitDieType || 'd8').replace(/\D/g, ''), 10) || 8;
    const rolled = Math.floor(Math.random() * sides) + 1;
    const conM = getAbMod('con');
    const heal = Math.max(1, rolled + conM);
    ch.hitDiceSpent = (Number(ch.hitDiceSpent) || 0) + 1;
    ch.hpCur = Math.min(Number(ch.hpMax) || 10, (Number(ch.hpCur) || 0) + heal);
    dndLastRoll = { label: `Short Rest (${ch.hitDieType})`, total: heal, detail: `1${ch.hitDieType} (${rolled}) ${conM >= 0 ? '+' : '-'} ${Math.abs(conM)} CON → Healed ${heal} HP`, isCrit: false, isFumble: false };
    playCozySound('chime');
    commitChange();
    showToast(`Short Rest: spent 1${ch.hitDieType} and healed ${heal} HP!`);
  });
  document.getElementById('dnd-long-rest')?.addEventListener('click', () => {
    ch.hpCur = Number(ch.hpMax) || 10;
    ch.hpTemp = 0;
    ch.deathSuccess = 0;
    ch.deathFail = 0;
    const recoverDice = Math.max(1, Math.floor((Number(ch.hitDiceTotal) || 1) / 2));
    ch.hitDiceSpent = Math.max(0, (Number(ch.hitDiceSpent) || 0) - recoverDice);
    for (let lv = 1; lv <= 9; lv++) {
      if (ch.spells?.[lv]) ch.spells[lv].slotsUsed = 0;
    }
    playCozySound('chime');
    commitChange();
    showToast('Long Rest complete: HP & all Spell Slots restored!');
  });
  bookRightEl.querySelectorAll('[data-dnd-jump-page]').forEach(btn => {
    btn.addEventListener('click', () => selectBookPage(btn.dataset.dndJumpPage, true));
  });
  document.getElementById('btn-toggle-ref-peek')?.addEventListener('click', () => {
    if (refPeekState.open) closeReferencePeek(); else openReferencePeek();
  });
  document.getElementById('btn-toggle-single-page')?.addEventListener('click', () => {
    openBookViewMode = openBookViewMode === 'single' ? 'spread' : 'single';
    renderOpenBook(false);
  });
  document.getElementById('open-prev-page')?.addEventListener('click', () => { if (prevPage) selectBookPage(prevPage.id, true); });
  document.getElementById('open-next-page')?.addEventListener('click', () => { if (nextPage) selectBookPage(nextPage.id, true); });

  // Text & select fields
  bookRightEl.querySelectorAll('[data-dnd-field]').forEach(el => {
    const key = el.dataset.dndField;
    const ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      ch[key] = el.value;
      if (key === 'name' && el.value.trim()) {
        book.title = el.value.trim();
        renderMap(); renderBreadcrumbs();
      }
      if (key === 'spellAbility') commitChange();
      else persistState();
    });
    if (ev === 'input') el.addEventListener('change', () => pushHistory());
  });
  bookRightEl.querySelectorAll('[data-dnd-num]').forEach(el => {
    const key = el.dataset.dndNum;
    el.addEventListener('change', () => {
      ch[key] = Number(el.value) || 0;
      if (key === 'level') {
        ch.level = Math.max(1, Math.min(20, ch.level));
        ch.hitDiceTotal = ch.level;
      }
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-ability]').forEach(el => {
    const ab = el.dataset.dndAbility;
    el.addEventListener('change', () => {
      ch.abilities[ab] = Math.max(1, Math.min(30, Number(el.value) || 10));
      commitChange();
    });
  });
  document.getElementById('dnd-toggle-insp')?.addEventListener('click', () => {
    ch.inspiration = !ch.inspiration;
    playCozySound('chime');
    commitChange();
  });
  bookRightEl.querySelectorAll('[data-dnd-save-prof]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ab = btn.dataset.dndSaveProf;
      ch.saveProfs[ab] = !ch.saveProfs[ab];
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-skill-prof]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sk = btn.dataset.dndSkillProf;
      const cur = Number(ch.skillProfs[sk]) || 0;
      ch.skillProfs[sk] = (cur + 1) % 3;
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-hp-delta]').forEach(btn => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.dndHpDelta) || 0;
      ch.hpCur = Math.max(0, Math.min(Number(ch.hpMax) || 10, (Number(ch.hpCur) || 0) + delta));
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-ds]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [field, nStr] = btn.dataset.dndDs.split(':');
      const n = Number(nStr);
      ch[field] = ch[field] === n ? n - 1 : n;
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-exh]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.dndExh);
      ch.exhaustion = ch.exhaustion === n ? n - 1 : n;
      commitChange();
    });
  });
  // Click-to-roll d20 buttons
  bookRightEl.querySelectorAll('[data-dnd-roll-mod]').forEach(btn => {
    btn.addEventListener('click', () => {
      const penalty = is2024 ? -(Number(ch.exhaustion) || 0) * 2 : 0;
      rollDndD20(btn.dataset.dndRollLabel, (Number(btn.dataset.dndRollMod) || 0) + penalty);
      renderOpenBook(false);
    });
  });
  // Attacks table
  document.getElementById('dnd-add-atk')?.addEventListener('click', () => {
    ch.attacks.push({ id: uid('atk'), name: '', bonus: fmtSigned(prof + getAbMod('str')), damage: '1d8+0', mastery: '' });
    commitChange();
  });
  bookRightEl.querySelectorAll('[data-dnd-atk]').forEach(inp => {
    const [field, idxStr] = inp.dataset.dndAtk.split(':');
    const idx = Number(idxStr);
    inp.addEventListener('input', () => { if (ch.attacks[idx]) { ch.attacks[idx][field] = inp.value; persistState(); } });
    inp.addEventListener('change', () => pushHistory());
  });
  bookRightEl.querySelectorAll('[data-dnd-roll-atk]').forEach(btn => {
    btn.addEventListener('click', () => {
      const atk = ch.attacks[Number(btn.dataset.dndRollAtk)];
      if (!atk) return;
      const mod = parseInt(String(atk.bonus || '0').replace(/\s+/g, ''), 10) || 0;
      const penalty = is2024 ? -(Number(ch.exhaustion) || 0) * 2 : 0;
      rollDndD20(`${atk.name || 'Attack'} (To Hit)`, mod + penalty);
      renderOpenBook(false);
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-roll-dmg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const atk = ch.attacks[Number(btn.dataset.dndRollDmg)];
      if (!atk) return;
      const res = rollDndDiceExpr(`${atk.name || 'Attack'} Damage`, atk.damage);
      if (!res) { showToast('Enter dice like 1d8+3 in the Damage field to roll!'); return; }
      renderOpenBook(false);
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-del-atk]').forEach(btn => {
    btn.addEventListener('click', () => {
      ch.attacks.splice(Number(btn.dataset.dndDelAtk), 1);
      commitChange();
    });
  });
  // Portrait upload & clear
  document.getElementById('dnd-pick-portrait')?.addEventListener('click', () => {
    pageImagePicker.onchange = async (ev) => {
      const f = ev.target.files?.[0];
      if (f) {
        try {
          ch.portrait = await compressImageFile(f);
          commitChange();
          showToast('Updated character portrait!');
        } catch (err) { showToast('Could not read that image'); }
      }
      pageImagePicker.value = '';
    };
    pageImagePicker.click();
  });
  document.getElementById('dnd-clear-portrait')?.addEventListener('click', () => {
    ch.portrait = '';
    commitChange();
  });
  // Coins & Attunement
  bookRightEl.querySelectorAll('[data-dnd-coin]').forEach(inp => {
    inp.addEventListener('change', () => {
      ch.coins[inp.dataset.dndCoin] = Math.max(0, Number(inp.value) || 0);
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-att-chk]').forEach(inp => {
    const idx = Number(inp.dataset.dndAttChk);
    inp.addEventListener('change', () => { if (ch.attunement[idx]) { ch.attunement[idx].active = inp.checked; commitChange(); } });
  });
  bookRightEl.querySelectorAll('[data-dnd-att-name]').forEach(inp => {
    const idx = Number(inp.dataset.dndAttName);
    inp.addEventListener('input', () => { if (ch.attunement[idx]) { ch.attunement[idx].name = inp.value; persistState(); } });
    inp.addEventListener('change', () => pushHistory());
  });
  // Spells & Spell Slots
  bookRightEl.querySelectorAll('[data-dnd-slots-total]').forEach(inp => {
    const lv = Number(inp.dataset.dndSlotsTotal);
    inp.addEventListener('change', () => {
      const t = Math.max(0, Math.min(9, Number(inp.value) || 0));
      ch.spells[lv].slotsTotal = t;
      ch.spells[lv].slotsUsed = Math.min(ch.spells[lv].slotsUsed, t);
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-slot-pip]').forEach(btn => {
    const [lvStr, nStr] = btn.dataset.dndSlotPip.split(':');
    const lv = Number(lvStr), n = Number(nStr);
    btn.addEventListener('click', () => {
      ch.spells[lv].slotsUsed = ch.spells[lv].slotsUsed >= n ? n - 1 : n;
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-add-spell]').forEach(btn => {
    const lv = Number(btn.dataset.dndAddSpell);
    btn.addEventListener('click', () => {
      ch.spells[lv].list.push({ id: uid('sp'), prepared: lv === 0, name: '', note: '' });
      commitChange();
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-sp-prep]').forEach(inp => {
    const [lvStr, iStr] = inp.dataset.dndSpPrep.split(':');
    inp.addEventListener('change', () => {
      const sp = ch.spells[Number(lvStr)]?.list?.[Number(iStr)];
      if (sp) { sp.prepared = inp.checked; commitChange(); }
    });
  });
  bookRightEl.querySelectorAll('[data-dnd-sp-name]').forEach(inp => {
    const [lvStr, iStr] = inp.dataset.dndSpName.split(':');
    inp.addEventListener('input', () => {
      const sp = ch.spells[Number(lvStr)]?.list?.[Number(iStr)];
      if (sp) { sp.name = inp.value; persistState(); }
    });
    inp.addEventListener('change', () => pushHistory());
  });
  bookRightEl.querySelectorAll('[data-dnd-sp-note]').forEach(inp => {
    const [lvStr, iStr] = inp.dataset.dndSpNote.split(':');
    inp.addEventListener('input', () => {
      const sp = ch.spells[Number(lvStr)]?.list?.[Number(iStr)];
      if (sp) { sp.note = inp.value; persistState(); }
    });
    inp.addEventListener('change', () => pushHistory());
  });
  bookRightEl.querySelectorAll('[data-dnd-del-spell]').forEach(btn => {
    const [lvStr, iStr] = btn.dataset.dndDelSpell.split(':');
    btn.addEventListener('click', () => {
      ch.spells[Number(lvStr)]?.list?.splice(Number(iStr), 1);
      commitChange();
    });
  });
}

function renderOpenBook(animateTurn = false) {
  if (!openBookState.bookId) return;
  const container = findOpenBookContainer(openBookState.hallId, openBookState.bookId);
  if (!container) { closeOpenBook(); return; }
  const { isCart, isLoosePaper, hall, book } = container;
  const isScroll = !isLoosePaper && isScrollItem(book);

  if (isLoosePaper || isScroll) openBookViewMode = 'single';

  const pal = getPalette();
  const sw = getSwatch(book.color || hall.color);
  bookCoverShell.style.background = isScroll ? '#b47b40' : (isLoosePaper ? '#c98e4b' : sw.fill);
  ribbonTiePopEl.classList.add('hidden');

  bookSpreadWrap.classList.toggle('is-single-page-mode', openBookViewMode === 'single');
  bookSpreadWrap.classList.toggle('is-scroll-mode', isScroll);
  bookSpreadWrap.classList.toggle('is-corkboard-mode', openBookViewMode === 'corkboard');
  document.getElementById('btn-close-book-label').textContent = isScroll
    ? 'Roll Up Scroll'
    : (isLoosePaper ? 'Close Paper' : (openBookViewMode === 'single' ? 'Close Page' : 'Close Book'));

  renderBookTopFlippers(container);
  renderReferencePeekDrawer();

  const orderedPages = getOrderedBookPages(book);
  const activeIdx = orderedPages.findIndex(p => p.id === openBookState.pageId);
  const activePage = activeIdx >= 0 ? orderedPages[activeIdx] : null;
  const activeChapterId = activePage ? activePage.chapterId : (openBookState.chapterId || book.chapters[0]?.id);
  const activeChapter = book.chapters.find(c => c.id === activeChapterId) || book.chapters[0];
  openBookState.chapterId = activeChapter?.id || null;

  const pageNumMap = {};
  orderedPages.forEach((p, idx) => { pageNumMap[p.id] = idx + 1; });

  // Book's Cross-Reference Ribbons (shelved books only)
  const bookRibbons = (isCart || isLoosePaper) ? [] : state.ribbons.filter(r => r.fromBookId === book.id || r.toBookId === book.id);
  const otherBooks = (isCart || isLoosePaper) ? [] : getAllBooksFlat().filter(e => e.book.id !== book.id);

  // ---- CORKBOARD / INDEX-CARD GRID VIEW (Suggestion 7) ----
  if (openBookViewMode === 'corkboard' && !isLoosePaper) {
    bookLeftEl.innerHTML = '';
    bookRightEl.innerHTML = `
      <div class="corkboard-surface -m-4 sm:-m-5 p-4 sm:p-5 flex-1 flex flex-col overflow-hidden">
        <div class="flex items-center justify-between gap-2 pb-3 mb-3 border-b flex-wrap" style="border-color:rgba(60,37,22,0.28);">
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider" style="background:${sw.fill}; color:#fffaf2; border:1.5px solid #3c2516;">Corkboard</span>
            <span class="font-storybook font-bold text-base truncate" style="color:#2d1a0f;">${esc(book.title)}</span>
            <span class="text-xs" style="color:#5c3d24;">(${orderedPages.length} page${orderedPages.length === 1 ? '' : 's'} · drag cards across chapters or onto Sorting Pile / Study Table)</span>
          </div>
          <div class="flex items-center gap-1.5">
            <button id="cork-add-chapter" type="button" class="rounded-xl px-2.5 py-1 text-xs font-bold cursor-pointer" style="background:#fffaf0; color:#362215; border:1.8px solid #3c2516;">+ Chapter</button>
            <button id="cork-go-single" type="button" class="rounded-xl px-2.5 py-1 text-xs font-bold cursor-pointer" style="background:#fffaf0; color:#362215; border:1.8px solid #3c2516;">&#9634; Single Page</button>
            <button id="cork-go-spread" type="button" class="rounded-xl px-3 py-1 text-xs font-bold cursor-pointer" style="background:${sw.fill}; color:#fffaf2; border:1.8px solid #3c2516;">&#128214; 2-Page Spread</button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto nice-scroll space-y-4 pr-1">
          ${book.chapters.map((ch, chIdx) => {
            const csw = getSwatch(ch.color || pal[chIdx % pal.length].id);
            const chPages = book.pages.filter(p => p.chapterId === ch.id);
            return `
              <div data-cork-chapter="${ch.id}" class="rounded-2xl p-3 transition-all" style="background:rgba(255,250,240,0.46); border:2px dashed rgba(60,37,22,0.32);">
                <div class="flex items-center justify-between gap-2 mb-2.5">
                  <span class="inline-flex items-center gap-1.5 font-storybook font-bold text-xs px-2.5 py-0.5 rounded-full" style="background:${csw.fill}; color:#fffaf2; border:1.5px solid #3c2516;">
                    <span>${esc(ch.title)}</span>
                    <span class="opacity-80">(${chPages.length})</span>
                  </span>
                  <button type="button" data-cork-add-page="${ch.id}" class="rounded-lg px-2 py-0.5 text-[11px] font-bold cursor-pointer" style="background:#fffaf0; color:${csw.deep}; border:1.5px solid #3c2516;">+ New Card</button>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  ${chPages.map(p => {
                    const todos = countPageTodos(p.html);
                    const pStamps = (p.stamps || []).map(getStamp).filter(Boolean);
                    const preview = truncate((p.body || '').replace(/\s+/g, ' ').trim(), 95);
                    const imgMatch = (p.html || '').match(/<img[^>]+src="([^"]+)"/i);
                    return `
                      <div data-cork-card="${p.id}" data-cork-card-ch="${ch.id}" draggable="true" class="corkboard-card p-2.5 flex flex-col justify-between gap-1.5">
                        <div>
                          <div class="flex items-center justify-between gap-1 mb-1">
                            <span class="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded" style="background:${csw.soft}; color:${csw.deep};">p.${pageNumMap[p.id]}</span>
                            <div class="flex items-center gap-1">
                              ${todos.total > 0 ? `<span class="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full" style="background:${todos.done === todos.total ? '#d7ecd9' : 'rgba(130,96,62,0.14)'}; color:${todos.done === todos.total ? '#2f5e36' : '#6c4d35'};">&#10003; ${todos.done}/${todos.total}</span>` : ''}
                            </div>
                          </div>
                          <div class="font-storybook font-bold text-xs mb-1" style="color:#2d1a0f;">${esc(p.title || 'Untitled Page')}</div>
                          ${imgMatch ? `<img src="${imgMatch[1]}" alt="" class="w-full h-20 object-cover rounded-lg mb-1.5" style="border:1px solid rgba(122,92,68,0.28);" />` : ''}
                          <p class="text-[11px] leading-snug line-clamp-3" style="color:#6d4f38;">${esc(preview || 'Empty page — click to write')}</p>
                        </div>
                        ${pStamps.length > 0 ? `
                          <div class="flex items-center gap-1 flex-wrap pt-1 border-t" style="border-color:rgba(122,92,68,0.15);">
                            ${pStamps.map(st => `<span class="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded" style="background:${st.color}18; color:${st.color}; border:1px solid ${st.color};">${esc(st.label)}</span>`).join('')}
                          </div>
                        ` : ''}
                      </div>
                    `;
                  }).join('') || `<div class="text-xs italic py-3 px-2" style="color:#6d4c33;">Drop cards here or click "+ New Card"</div>`}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    document.getElementById('cork-add-chapter')?.addEventListener('click', () => createChapter(hall.id, book.id));
    document.getElementById('cork-go-single')?.addEventListener('click', () => { openBookViewMode = 'single'; renderOpenBook(false); });
    document.getElementById('cork-go-spread')?.addEventListener('click', () => { openBookViewMode = 'spread'; renderOpenBook(false); });
    bookRightEl.querySelectorAll('[data-cork-add-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        openBookViewMode = 'spread';
        createPage(hall.id, book.id, btn.dataset.corkAddPage);
      });
    });
    bookRightEl.querySelectorAll('[data-cork-card]').forEach(card => {
      const pid = card.dataset.corkCard;
      const cid = card.dataset.corkCardCh;
      card.addEventListener('click', () => {
        openBookState.pageId = pid;
        openBookState.chapterId = cid;
        openBookViewMode = 'spread';
        renderOpenBook(true);
      });
      card.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        listDrag = { type: 'page', id: pid, bookId: book.id, hallId: hall.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', pid);
        card.classList.add('dragging-item');
      });
      card.addEventListener('dragend', () => { listDrag = null; clearDropMarkers(document); clearCornerDropHighlights(); });
      card.addEventListener('dragover', (e) => {
        if (!listDrag || listDrag.type !== 'page' || listDrag.id === pid) return;
        e.preventDefault(); e.stopPropagation();
        clearDropMarkers(bookRightEl);
        card.classList.add('drop-before');
      });
      card.addEventListener('drop', (e) => {
        if (!listDrag || listDrag.type !== 'page' || listDrag.id === pid) return;
        e.preventDefault(); e.stopPropagation();
        const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
        reorderOrMovePage(book, draggedId, cid, pid, false);
      });
    });
    bookRightEl.querySelectorAll('[data-cork-chapter]').forEach(sec => {
      const cid = sec.dataset.corkChapter;
      sec.addEventListener('dragover', (e) => {
        if (!listDrag || listDrag.type !== 'page' || e.target.closest('[data-cork-card]')) return;
        e.preventDefault();
        clearDropMarkers(bookRightEl);
        sec.classList.add('drop-into');
      });
      sec.addEventListener('drop', (e) => {
        if (!listDrag || listDrag.type !== 'page' || e.target.closest('[data-cork-card]')) return;
        e.preventDefault();
        const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
        reorderOrMovePage(book, draggedId, cid, null, true);
      });
    });
    return;
  }

  // ---- LEFT PAGE: Book Metadata + Study Table Pin + Table of Contents ----
  bookLeftEl.innerHTML = `
    <div class="flex items-center justify-between gap-1.5 mb-1.5 flex-wrap">
      <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full truncate max-w-[140px]" style="background:${sw.soft}; color:${sw.deep};">
        <span class="w-2 h-2 rounded-full shrink-0" style="background:${sw.fill};"></span>
        ${esc(truncate(hall.title, 15))}
      </span>
      <div class="flex items-center gap-1 flex-wrap">
        ${!isCart && !isLoosePaper ? `
          <button id="open-pin-book" type="button" title="${book.pinned ? 'Remove from Study Table' : 'Stack on Study Table (up to 11 books)'}"
                  class="text-[10.5px] font-bold rounded-lg px-2 py-0.5 cursor-pointer transition-transform hover:scale-105"
                  style="background:${book.pinned ? '#f5c663' : 'rgba(122,92,68,0.1)'}; color:${book.pinned ? '#352012' : '#5e3f28'}; border:1px solid ${book.pinned ? '#b88224' : 'rgba(122,92,68,0.28)'};">
            ${book.pinned ? '&#9733; On Table' : '&#9734; + Table'}
          </button>
        ` : ''}
        <select id="open-move-hall" title="${isCart ? 'Sort this unfiled book into a Hall' : 'Reshelve book into another Hall or Sub-Hall'}" class="text-[10.5px] rounded-lg px-1.5 py-0.5 outline-none cursor-pointer max-w-[122px]" style="background:rgba(122,92,68,0.1); border:1px solid rgba(122,92,68,0.28); color:#4a301e;">
          ${isCart ? `<option value="" selected>Sort to Hall…</option>` : ''}
          ${buildHallOptionsHTML(isCart ? '' : hall.id)}
        </select>
      </div>
    </div>

    <input id="open-book-title" type="text" value="${esc(book.title)}" placeholder="Book Title…"
           class="w-full bg-transparent border-0 border-b-2 pb-1 mb-1 font-storybook font-bold text-lg outline-none"
           style="color:#2d1a0f; border-color:rgba(122,92,68,0.22);" />

    <input id="open-book-summary" type="text" value="${esc(book.summary || '')}" placeholder="Short summary on the inside cover…"
           class="w-full bg-transparent border-0 pb-1.5 mb-2 text-xs italic outline-none"
           style="color:#6d4f38;" />

    <!-- Dynamic Library Palette Swatches -->
    <div class="flex items-center gap-1.5 flex-wrap mb-2.5">
      <span class="text-[11px] font-semibold mr-0.5" style="color:#806149;">Spine:</span>
      ${pal.map(c => `
        <button data-book-swatch="${c.id}" title="${esc(c.name)}" class="w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-115"
          style="background:${c.fill}; border:${(book.color || hall.color) === c.id ? '2.5px solid #2d1a0f' : '1.5px solid rgba(60,37,22,0.35)'};"></button>
      `).join('')}
      <button id="open-palette-index" title="Edit colors in Central Card Index" class="ml-auto text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md cursor-pointer bg-transparent border border-amber-900/25 hover:bg-amber-900/10" style="color:#78573d;">Edit Colors</button>
    </div>

    <!-- TABLE OF CONTENTS HEADER + CORKBOARD & TEMPLATE PICKER BUTTONS -->
    <div class="relative flex items-center justify-between gap-1.5 pb-1.5 mb-2 border-b flex-wrap" style="border-color:rgba(122,92,68,0.22);">
      <span class="font-storybook font-bold text-xs uppercase tracking-wider" style="color:#6d4c33;">Contents</span>
      <div class="flex items-center gap-1 flex-wrap">
        <button id="btn-open-corkboard" type="button" title="Spread pages as a 2D Corkboard of index cards"
                class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer bg-amber-900/10 hover:bg-amber-900/20 border border-amber-900/20"
                style="color:#4a301e;">&#8862; Corkboard</button>
        <button id="btn-open-tpl-picker" type="button" title="Create a new page from a saved Page Template"
                class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer bg-amber-900/10 hover:bg-amber-900/20 border border-amber-900/20"
                style="color:#4a301e;">+ Template</button>
        <button id="open-add-chapter" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer transition-transform hover:-translate-y-0.5 shrink-0"
                style="background:${sw.soft}; color:${sw.deep}; border:1.5px solid ${sw.fill};">+ Chapter</button>
      </div>
      <!-- Page Template Picker Popover -->
      <div id="tpl-picker-pop" class="hidden absolute right-0 top-full mt-1.5 z-30 rounded-2xl p-2.5 w-64 shadow-xl space-y-2" style="background:#fffaf0; border:2px solid #8a6544; color:#321f13;">
        <div class="flex items-center justify-between">
          <span class="text-[10.5px] font-bold uppercase tracking-wider" style="color:#7a5c44;">New Page from Template</span>
          <button id="tpl-picker-manage" type="button" class="text-[10px] font-semibold underline bg-transparent border-0 p-0 cursor-pointer" style="color:#9f4628;">Card Index</button>
        </div>
        <div class="max-h-48 overflow-y-auto nice-scroll space-y-1.5">
          ${(state.pageTemplates || []).map(tpl => `
            <button type="button" data-use-page-tpl="${tpl.id}" class="w-full text-left px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-colors hover:brightness-95"
                    style="background:rgba(130,96,62,0.08); border:1.4px solid rgba(130,96,62,0.24); color:#2d1a0f;">
              <div class="font-storybook font-bold truncate">${esc(tpl.name)}</div>
              <div class="text-[10px] truncate" style="color:#785940;">
                ${(tpl.properties || []).length} prop${(tpl.properties || []).length === 1 ? '' : 's'}${tpl.sourceBookTitle ? ` &middot; From ${esc(truncate(tpl.sourceBookTitle, 18))}` : ''}
              </div>
            </button>
          `).join('') || `<div class="text-[11px] italic px-1 py-1.5" style="color:#8a6a4e;">No saved templates yet — open any page's Properties and click "Save as Template"!</div>`}
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto nice-scroll space-y-2.5 pr-1">
      ${book.chapters.map((ch, chIdx) => {
        const csw = getSwatch(ch.color || pal[chIdx % pal.length].id);
        const chPages = book.pages.filter(p => p.chapterId === ch.id);
        const isActCh = ch.id === activeChapter?.id;
        const isRenaming = editingChapterId === ch.id;
        const chMatch = doesChapterMatchActiveFilter(ch, book);

        return `
          <div data-toc-chapter="${ch.id}" draggable="${isRenaming ? 'false' : 'true'}" class="toc-chapter-card ${chMatch ? 'toc-match-glow' : ''} rounded-2xl p-2 transition-shadow" style="background:${isActCh ? 'rgba(130, 96, 62, 0.08)' : 'rgba(130, 96, 62, 0.035)'}; border:1.5px solid ${isActCh ? csw.fill : 'rgba(130, 96, 62, 0.16)'};">
            <div class="flex items-center justify-between gap-1.5 mb-1.5 px-0.5">
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                <span class="drag-grip shrink-0" title="Drag to reorder chapter" style="color:#7d5e45;">${GRIP_SVG}</span>
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${csw.fill}; border:1px solid #3c2516;"></span>
                ${isRenaming
                  ? `<input data-rename-chapter="${ch.id}" type="text" value="${esc(ch.title)}" class="flex-1 min-w-0 bg-white/90 rounded px-1.5 py-0.5 text-xs font-storybook font-bold outline-none" style="border:1.5px solid ${csw.fill}; color:#2d1a0f;" />`
                  : `<button data-pick-chapter="${ch.id}" title="Jump to chapter (double-click to rename)" class="text-left font-storybook font-bold text-xs truncate bg-transparent border-0 p-0 cursor-pointer hover:underline" style="color:#2d1a0f;">${chMatch ? '<span style="color:#b86b00;">&#10022; </span>' : ''}${esc(ch.title)}</button>`
                }
              </div>
              <div class="flex items-center gap-1 shrink-0">
                ${!isRenaming ? `
                  <button data-start-rename-ch="${ch.id}" title="Rename chapter" class="p-0.5 rounded hover:bg-black/10 cursor-pointer bg-transparent border-0" style="color:#7d5e45;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                ` : ''}
                <button data-add-page-ch="${ch.id}" title="Add page to ${esc(ch.title)}" class="rounded-md px-1.5 py-0.5 text-[10px] font-bold cursor-pointer"
                        style="background:${csw.fill}; color:#fffaf2; border:1px solid ${csw.deep};">+ Page</button>
                ${book.chapters.length > 1 ? `
                  <button data-del-ch="${ch.id}" title="Delete chapter" class="px-1 py-0.5 rounded text-[11px] font-bold cursor-pointer bg-transparent border-0 text-red-700/70 hover:text-red-700 hover:bg-red-500/10">&times;</button>
                ` : ''}
              </div>
            </div>

            <div class="space-y-1 pl-2">
              ${chPages.map(p => {
                const isAct = p.id === openBookState.pageId;
                const pMatch = doesPageMatchActiveFilter(p);
                const preview = truncate((p.body || '').replace(/\s+/g, ' ').trim(), 40);
                const hasImg = (p.html || '').includes('<img');
                const hasLink = (p.html || '').includes('<a ');
                const todos = countPageTodos(p.html);
                const pStamps = (p.stamps || []).map(getStamp).filter(Boolean);
                return `
                  <button data-pick-page="${p.id}" data-page-chapter="${ch.id}" draggable="true" class="toc-page-row ${pMatch ? 'toc-match-glow' : ''} w-full text-left px-2 py-1.5 rounded-xl cursor-pointer transition-all flex items-start gap-1.5"
                          style="background:${isAct ? csw.soft : 'rgba(255, 253, 247, 0.72)'}; border:1.5px solid ${isAct ? csw.fill : 'rgba(130, 96, 62, 0.14)'};">
                    <span class="drag-grip mt-0.5 shrink-0" title="Drag to reorder, move to another chapter, or drag out to Sorting Pile / Study Table!" style="color:#8f7054;">${GRIP_SVG}</span>
                    <span class="font-storybook font-bold text-[11px] mt-0.5 shrink-0" style="color:${isAct ? csw.deep : '#8f7054'};">p.${pageNumMap[p.id]}</span>
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1 flex-wrap">
                        <span class="toc-page-title font-storybook font-bold text-xs truncate" style="color:#2d1a0f;">${pMatch ? '<span style="color:#b86b00;">&#10022; </span>' : ''}${esc(p.title || 'Untitled Page')}</span>
                        ${pStamps.slice(0, 3).map(st => `<span title="${esc(st.label)}" class="w-2 h-2 rounded-full shrink-0" style="background:${st.color};"></span>`).join('')}
                        ${todos.total > 0 ? `<span class="toc-todo-badge text-[9.5px] font-bold px-1.5 py-0 rounded-full" style="background:${todos.done === todos.total ? '#d7ecd9' : 'rgba(130,96,62,0.14)'}; color:${todos.done === todos.total ? '#2f5e36' : '#6c4d35'};">&#10003; ${todos.done}/${todos.total}</span>` : ''}
                        ${hasImg ? `<span title="Contains image" class="text-[10px]" style="color:#8f6949;">&#128444;</span>` : ''}
                        ${hasLink ? `<span title="Contains link" class="text-[10px]" style="color:#8f6949;">&#128279;</span>` : ''}
                      </span>
                      ${preview ? `<span class="toc-page-preview block text-[10.5px] truncate mt-0.5" style="color:#785940;">${esc(preview)}</span>` : ''}
                    </span>
                  </button>
                `;
              }).join('') || `<p class="text-[11px] italic px-2 py-1" style="color:#8f7258;">Empty chapter — click "+ Page" or drop a page here.</p>`}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="pt-2.5 mt-2.5 border-t flex items-center justify-between gap-2 flex-wrap" style="border-color:rgba(122,92,68,0.2);">
      <button id="open-jump-hall" class="text-xs font-semibold hover:underline bg-transparent border-0 p-0 cursor-pointer" style="color:#78573d;">&larr; ${isCart ? 'Sorting Pile' : 'Edit ' + esc(truncate(hall.title, 14))}</button>
      <div class="flex items-center gap-1.5">
        <button id="open-export-book-md" title="Export this book as a clean Markdown (.md) document" class="text-[11px] font-semibold px-2 py-1 rounded-xl cursor-pointer bg-transparent border border-amber-900/25 hover:bg-amber-900/10" style="color:#6c4d35;">Export .md</button>
        <button id="open-del-book" class="text-[11px] font-semibold px-2.5 py-1 rounded-xl cursor-pointer bg-transparent border border-red-400/50 text-red-700 hover:bg-red-500/10">Delete Book</button>
      </div>
    </div>
  `;

  // ---- RIGHT PAGE (OR D&D CHARACTER SHEET / SINGLE-PAGE UI) ----
  const isDndSheetPage = Boolean(activePage && activePage.sheetType && !isLoosePaper);
  if (isDndSheetPage) {
    renderDndSheetRightPage(book, hall, activePage, orderedPages, activeIdx, sw, activeChapter, animateTurn);
  } else if (activePage) {
    const prevPage = orderedPages[activeIdx - 1];
    const nextPage = orderedPages[activeIdx + 1];
    const chColor = getSwatch(activeChapter?.color || book.color || hall.color);
    const pageStamps = (activePage.stamps || []).map(getStamp).filter(Boolean);
    const allStamps = getStamps();
    const activePageMatches = doesPageMatchActiveFilter(activePage);
    const filterMatchPill = activePageMatches
      ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style="background:#ffe27a; color:#4d2c0b; border:1px solid #d4961a;">&#10022; ${searchMatches.active ? 'Search Match' : 'Stamp Match'}</span>`
      : '';

    const backlinks = findBacklinksForPage(isLoosePaper ? null : book.id, activePage.id);
    const allBooksForFiling = getAllBooksFlat();

    // Special top context banner when in Single-Page Center-Screen Mode or Unrolled Scroll Mode
    let singlePageBannerHtml = '';
    if (isLoosePaper) {
      singlePageBannerHtml = `
        <div class="rounded-xl p-2 mb-2 flex items-center justify-between gap-1.5 flex-wrap" style="background:rgba(201,104,67,0.12); border:1.5px solid rgba(201,104,67,0.35);">
          <span class="text-[11px] font-storybook font-bold flex items-center gap-1.5" style="color:#7c3a1d;">
            <span class="w-2.5 h-2.5 rounded-full" style="background:#c96843;"></span>
            <span>Sorting Pile &middot; Loose Paper (${activeIdx + 1}/${orderedPages.length})</span>
          </span>
          <div class="flex items-center gap-1 flex-wrap">
            ${allBooksForFiling.length > 0 ? `
              <select id="single-loose-file-sel" class="rounded-lg px-2 py-0.5 text-[10.5px] outline-none" style="background:#fffaf0; border:1px solid #b58d63; color:#362215;">
                ${allBooksForFiling.map(e => `<option value="${e.book.id}">${esc(truncate(e.hall.title, 11))} &rsaquo; ${esc(truncate(e.book.title, 16))}</option>`).join('')}
              </select>
              <button id="btn-single-loose-file" type="button" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:#c96843; color:#fffaf2; border:1px solid #3c2516;">Sort into Book</button>
            ` : ''}
            <button id="btn-single-loose-promote" type="button" title="Bind this loose paper into a new book" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:#fffaf0; color:#4a301e; border:1px solid #8a6544;">&rarr; Book</button>
            <button id="btn-single-loose-new" type="button" title="Toss another loose paper onto the pile" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:#f5c663; color:#352012; border:1px solid #3c2516;">+ Paper</button>
          </div>
        </div>
      `;
    } else if (isScroll) {
      singlePageBannerHtml = `
        <div class="rounded-xl px-2.5 py-2 mb-2 flex items-center justify-between gap-2 flex-wrap" style="background:rgba(180,123,64,0.13); border:1.5px solid rgba(154,102,48,0.42);">
          <div class="flex items-center gap-2 flex-wrap min-w-0">
            <span class="inline-flex items-center gap-1 text-[10.5px] font-storybook font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style="background:${sw.soft}; color:${sw.deep}; border:1px solid ${sw.fill};">
              <span>&#128220; Scroll</span>
              <span class="opacity-70">&middot;</span>
              <span class="truncate max-w-[110px]">${esc(truncate(hall.title, 14))}</span>
            </span>
            <div class="flex items-center gap-1" title="Scroll ribbon color">
              ${pal.map(c => `
                <button data-scroll-swatch="${c.id}" type="button" title="${esc(c.name)} ribbon" class="w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-115"
                  style="background:${c.fill}; border:${(book.color || hall.color) === c.id ? '2px solid #2d1a0f' : '1px solid rgba(60,37,22,0.35)'};"></button>
              `).join('')}
            </div>
          </div>
          <div class="flex items-center gap-1 flex-wrap">
            ${!isCart ? `
              <button id="scroll-pin-btn" type="button" title="${book.pinned ? 'Remove from Study Table' : 'Stack on Study Table'}"
                      class="text-[10.5px] font-bold rounded-lg px-2 py-0.5 cursor-pointer"
                      style="background:${book.pinned ? '#f5c663' : '#fffaf0'}; color:#352012; border:1px solid ${book.pinned ? '#b88224' : 'rgba(122,92,68,0.32)'};">
                ${book.pinned ? '&#9733; On Table' : '&#9734; + Table'}
              </button>
            ` : ''}
            <select id="scroll-move-hall" title="Move scroll to another Hall" class="text-[10.5px] rounded-lg px-1.5 py-0.5 outline-none cursor-pointer max-w-[120px]" style="background:#fffaf0; border:1px solid rgba(122,92,68,0.32); color:#4a301e;">
              ${isCart ? `<option value="" selected>Sort to Hall…</option>` : ''}
              ${buildHallOptionsHTML(isCart ? '' : hall.id)}
            </select>
            <button id="btn-scroll-to-book" type="button" title="Bind this single-page scroll into a full multi-page Book"
                    class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer"
                    style="background:#fffaf0; color:#4a301e; border:1px solid rgba(122,92,68,0.38);">&rarr; Bind as Book</button>
            <button id="btn-scroll-export-md" type="button" title="Export this scroll as Markdown (.md)"
                    class="rounded-lg px-2 py-0.5 text-[10.5px] font-semibold cursor-pointer bg-transparent border border-amber-900/25 hover:bg-amber-900/10" style="color:#6c4d35;">.md</button>
          </div>
        </div>
      `;
    } else if (openBookViewMode === 'single') {
      singlePageBannerHtml = `
        <div class="rounded-xl px-2.5 py-1.5 mb-2 flex items-center justify-between gap-2 flex-wrap" style="background:${sw.soft}; border:1.5px solid ${sw.fill};">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${sw.fill}; border:1px solid #3c2516;"></span>
            <span class="font-storybook font-bold text-xs truncate" style="color:${sw.deep};">${esc(book.title)}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <select id="single-page-picker" class="rounded-lg px-2 py-0.5 text-[11px] font-semibold outline-none cursor-pointer" style="background:#fffaf0; border:1px solid ${sw.fill}; color:#362215;">
              ${orderedPages.map((p, idx) => `<option value="${p.id}" ${p.id === activePage.id ? 'selected' : ''}>p.${idx + 1} · ${esc(truncate(p.title, 22))}</option>`).join('')}
            </select>
            <button id="btn-single-to-cork" type="button" title="Corkboard Grid View" class="rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:#fffaf0; color:#4a301e; border:1px solid rgba(122,92,68,0.35);">&#8862; Grid</button>
            <button id="btn-single-to-spread" type="button" title="Expand to Two-Page Open Book Spread" class="rounded-lg px-2.5 py-0.5 text-[10.5px] font-bold cursor-pointer" style="background:${sw.fill}; color:#fffaf2; border:1px solid ${sw.deep};">&#128214; 2-Page Spread</button>
          </div>
        </div>
      `;
    }

    bookRightEl.innerHTML = `
      <div id="right-page-dropzone" class="flex flex-col flex-1 min-h-0 relative rounded-xl transition-colors ${animateTurn ? 'page-turn-anim' : ''}">
        <svg class="pointer-events-none absolute -top-4 -right-4" width="38" height="38" viewBox="0 0 38 38">
          <path d="M 0 0 L 38 38 L 0 38 Z" fill="#ead9b9" opacity="0.65" />
          <path d="M 0 0 L 0 38 L 38 38" fill="none" stroke="rgba(110,74,42,0.25)" stroke-width="1.5" />
        </svg>

        ${singlePageBannerHtml}

        <div class="flex items-center justify-between gap-1.5 mb-1.5 pr-6 flex-wrap">
          <span class="font-storybook font-bold text-xs truncate flex items-center gap-1.5" style="color:${chColor.deep};">
            <span>${isScroll ? 'Unrolled Parchment Scroll' : `${esc(isLoosePaper ? 'Loose Parchment Sheet' : (activeChapter?.title || 'Chapter'))} &middot; <span style="color:#8a6a4e;">Page ${activeIdx + 1} of ${orderedPages.length}</span>`}</span>
            ${filterMatchPill}
          </span>
          <div class="flex items-center gap-1 shrink-0">
            <button id="btn-toggle-ref-peek" type="button" title="Compare / Peek at a Study Table book side-by-side"
                    class="text-[10.5px] font-bold px-2 py-0.5 rounded-lg cursor-pointer"
                    style="background:${refPeekState.open ? '#f5c663' : 'rgba(130,96,62,0.1)'}; color:#362215; border:1px solid rgba(130,96,62,0.28);">
              &#128065; ${refPeekState.open ? 'Hide Peek' : 'Peek'}
            </button>
            ${!isLoosePaper && !isScroll ? `
              <button id="btn-toggle-single-page" type="button" title="${openBookViewMode === 'single' ? 'Switch to Two-Page Book Spread' : 'Focus on this Single Page in the center of the screen'}"
                      class="text-[10.5px] font-bold px-2 py-0.5 rounded-lg cursor-pointer"
                      style="background:${openBookViewMode === 'single' ? chColor.fill : 'rgba(130,96,62,0.1)'}; color:${openBookViewMode === 'single' ? '#fffaf2' : '#362215'}; border:1px solid rgba(130,96,62,0.28);">
                ${openBookViewMode === 'single' ? '&#128214; Spread' : '&#9634; Single Page'}
              </button>
            ` : ''}
            <button id="open-del-page" title="${isScroll ? 'Delete this scroll from the shelf' : (isLoosePaper ? 'Discard this loose paper' : 'Delete this page')}" class="text-[10.5px] font-semibold px-2 py-0.5 rounded-lg cursor-pointer bg-transparent border border-red-400/40 text-red-700 hover:bg-red-500/10 shrink-0">${isScroll ? 'Delete Scroll' : (isLoosePaper ? 'Discard' : 'Tear Out')}</button>
          </div>
        </div>

        <!-- Editable Page / Scroll Title -->
        <input id="open-page-title" type="text" value="${esc(isScroll ? book.title : activePage.title)}" placeholder="${isScroll ? 'Scroll Title…' : 'Page Title…'}"
               class="w-full bg-transparent border-0 border-b-2 pb-1 mb-2 font-storybook font-bold text-xl outline-none"
               style="color:#2d1a0f; border-color:rgba(122,92,68,0.22);" />

        <!-- CROSS-REFERENCE STAMPS BAR -->
        <div class="relative flex items-center flex-wrap gap-1.5 mb-2.5">
          ${pageStamps.map(st => {
            const refCount = findPagesWithStamp(st.id, activePage.id).length;
            return `
              <span class="library-stamp" style="color:${st.color}; background:${st.color}16;">
                <button data-xref-stamp="${st.id}" title="View ${refCount} cross-referenced page${refCount === 1 ? '' : 's'} with '${esc(st.label)}'" class="bg-transparent border-0 p-0 cursor-pointer font-inherit uppercase tracking-wider flex items-center gap-1" style="color:inherit;">
                  <span>${esc(st.label)}</span>
                  ${refCount > 0 ? `<span class="text-[9px] px-1 rounded-full" style="background:${st.color}; color:#fffaf2;">${refCount}</span>` : ''}
                </button>
                <button data-remove-page-stamp="${st.id}" title="Remove stamp" class="bg-transparent border-0 p-0 pl-0.5 cursor-pointer leading-none opacity-75 hover:opacity-100" style="color:inherit;">&times;</button>
              </span>
            `;
          }).join('')}

          <button id="btn-open-stamp-tray" type="button" class="px-2 py-0.5 rounded-lg text-[10.5px] font-bold cursor-pointer transition-transform hover:scale-105"
                  style="background:rgba(130,96,62,0.1); color:#5c3f29; border:1.5px dashed rgba(130,96,62,0.38);">+ Stamp</button>

          <!-- Rubber Stamp Picker Tray Popover -->
          <div id="stamp-tray-pop" class="hidden absolute left-0 top-full mt-1.5 z-30 rounded-2xl p-3 w-72 shadow-xl space-y-2.5" style="background:#fffaf0; border:2px solid #8a6544; color:#321f13;">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color:#7a5c44;">Cross-Reference Stamps</span>
              <button id="stamp-tray-manage" type="button" class="text-[10.5px] font-semibold underline bg-transparent border-0 p-0 cursor-pointer" style="color:#9f4628;">Card Index</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${allStamps.map(st => {
                const has = (activePage.stamps || []).includes(st.id);
                return `
                  <button data-toggle-stamp="${st.id}" type="button" class="library-stamp cursor-pointer"
                          style="color:${has ? '#fffaf2' : st.color}; background:${has ? st.color : st.color + '14'}; border-color:${st.color};">
                    ${has ? '&#10003; ' : ''}${esc(st.label)}
                  </button>
                `;
              }).join('') || `<span class="text-xs italic" style="color:#8a6a4e;">No stamps yet—mint one below!</span>`}
            </div>
            <div class="pt-2 border-t flex items-center gap-1.5" style="border-color:rgba(130,96,62,0.2);">
              <input id="quick-stamp-color" type="color" value="${chColor.deep}" class="swatch-picker w-6 h-6 shrink-0" title="Stamp ink color" />
              <input id="quick-stamp-name" type="text" placeholder="Mint new stamp…" class="flex-1 min-w-0 rounded-lg px-2 py-1 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
              <button id="quick-stamp-add" type="button" class="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer" style="background:${chColor.fill}; color:#fffaf2; border:1px solid ${chColor.deep};">Add</button>
            </div>
          </div>

          <!-- Cross-Referenced Pages Popover -->
          <div id="stamp-xref-pop" class="hidden absolute left-0 top-full mt-1.5 z-30 rounded-2xl p-3 w-80 shadow-xl space-y-2" style="background:#fffaf0; border:2px solid #8a6544; color:#321f13;"></div>
        </div>

        <!-- OBSIDIAN-STYLE PAGE PROPERTIES DRAWER & SAVE AS TEMPLATE -->
        ${(() => {
          if (!Array.isArray(activePage.properties)) activePage.properties = [];
          const pProps = activePage.properties;
          const isOpen = pProps.length > 0;
          return `
            <div id="page-props-panel" class="relative rounded-xl px-2.5 py-1.5 mb-2" style="background:rgba(130,96,62,0.065); border:1.3px solid rgba(130,96,62,0.2);">
              <div class="flex items-center justify-between gap-1.5 flex-wrap">
                <button id="btn-toggle-page-props" type="button" class="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider bg-transparent border-0 p-0 cursor-pointer" style="color:#6d4c33;">
                  <span id="page-props-chevron">${isOpen ? '&#9662;' : '&#9656;'}</span>
                  <span>Properties (${pProps.length})</span>
                </button>
                <div class="flex items-center gap-1 flex-wrap">
                  <button id="btn-add-page-prop" type="button" title="Add an Obsidian-style property (e.g. Name, Date of Birth, Role)"
                          class="rounded-md px-1.5 py-0.5 text-[10px] font-bold cursor-pointer"
                          style="background:rgba(255,250,240,0.9); color:#4a301e; border:1px solid rgba(130,96,62,0.32);">+ Property</button>
                  <button id="btn-open-load-tpl" type="button" title="Load a saved Page Template's properties, stamps, and layout onto this page or scroll"
                          class="rounded-md px-1.5 py-0.5 text-[10px] font-bold cursor-pointer"
                          style="background:rgba(255,250,240,0.9); color:#4a301e; border:1px solid rgba(130,96,62,0.38);">Load Template</button>
                  <button id="btn-open-save-tpl" type="button" title="Save this page's properties, stamps, and layout as a reusable Template in the Card Index"
                          class="rounded-md px-1.5 py-0.5 text-[10px] font-bold cursor-pointer"
                          style="background:${chColor.soft}; color:${chColor.deep}; border:1px solid ${chColor.fill};">Save as Template</button>
                </div>
              </div>

              <!-- Load Template onto Current Page / Scroll / Loose Paper Popover -->
              <div id="load-tpl-pop" class="hidden absolute right-0 top-full mt-1 z-30 rounded-2xl p-2.5 w-72 shadow-xl space-y-2" style="background:#fffaf0; border:2px solid #8a6544; color:#321f13;">
                <div class="flex items-center justify-between">
                  <span class="text-[10.5px] font-bold uppercase tracking-wider" style="color:#7a5c44;">Load Template Here</span>
                  <button id="load-tpl-manage" type="button" class="text-[10px] font-semibold underline bg-transparent border-0 p-0 cursor-pointer" style="color:#9f4628;">Card Index</button>
                </div>
                <div class="max-h-52 overflow-y-auto nice-scroll space-y-1.5">
                  ${(state.pageTemplates || []).map(tpl => `
                    <button type="button" data-apply-page-tpl="${tpl.id}" class="w-full text-left px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-colors hover:brightness-95"
                            style="background:rgba(130,96,62,0.08); border:1.4px solid rgba(130,96,62,0.24); color:#2d1a0f;">
                      <div class="font-storybook font-bold truncate">${esc(tpl.name)}</div>
                      <div class="text-[10px] truncate" style="color:#785940;">
                        ${(tpl.properties || []).length} prop${(tpl.properties || []).length === 1 ? '' : 's'}${tpl.sourceBookTitle ? ` &middot; From ${esc(truncate(tpl.sourceBookTitle, 20))}` : ''}
                      </div>
                    </button>
                  `).join('') || `<div class="text-[11px] italic px-1 py-1.5" style="color:#8a6a4e;">No saved templates yet — click "Save as Template" on any page first!</div>`}
                </div>
              </div>

              <!-- Save Page as Template Popover -->
              <div id="save-tpl-pop" class="hidden absolute right-0 top-full mt-1 z-30 rounded-2xl p-3 w-72 shadow-xl space-y-2" style="background:#fffaf0; border:2px solid #8a6544; color:#321f13;">
                <div class="flex items-center justify-between">
                  <span class="text-[10.5px] font-bold uppercase tracking-wider" style="color:#7a5c44;">Save to Card Index Templates</span>
                  <button id="save-tpl-cancel-x" type="button" class="text-xs font-bold px-1 bg-transparent border-0 cursor-pointer" style="color:#6d4c33;">&times;</button>
                </div>
                <input id="save-tpl-name" type="text" value="${esc((activePage.title || 'Page') + ' Template')}" placeholder="Template name (e.g. Character Sheet)…"
                       class="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
                <div class="text-[10.5px]" style="color:#785940;">
                  Saves ${pProps.length} propert${pProps.length === 1 ? 'y' : 'ies'}, ${(activePage.stamps || []).length} stamp${(activePage.stamps || []).length === 1 ? '' : 's'}, &amp; page structure &middot; Origin: <strong>${esc(truncate(book.title, 20))}</strong>
                </div>
                <div class="flex justify-end gap-1.5">
                  <button id="save-tpl-cancel" type="button" class="px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer" style="background:#efe4ce; color:#4a301e; border:1px solid #c5ab86;">Cancel</button>
                  <button id="save-tpl-confirm" type="button" class="px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer" style="background:${chColor.fill}; color:#fffaf2; border:1px solid ${chColor.deep};">Save Template</button>
                </div>
              </div>

              <div id="page-props-list" class="${isOpen ? '' : 'hidden'} mt-1.5 pt-1.5 border-t space-y-1 max-h-36 overflow-y-auto nice-scroll" style="border-color:rgba(130,96,62,0.16);">
                ${pProps.map((pr, idx) => {
                  const pType = pr.type || 'text';
                  let valInputHtml = '';
                  if (pType === 'checkbox') {
                    valInputHtml = `<label class="flex items-center gap-1.5 flex-1 min-w-0 px-1.5 py-0.5 text-[11px] cursor-pointer" style="color:#362215;">
                      <input data-prop-val="${idx}" type="checkbox" ${pr.value ? 'checked' : ''} class="accent-amber-700 cursor-pointer" />
                      <span>${pr.value ? 'Yes' : 'No'}</span>
                    </label>`;
                  } else if (pType === 'date') {
                    valInputHtml = `<input data-prop-val="${idx}" type="date" value="${esc(pr.value || '')}" class="flex-1 min-w-0 rounded-md px-1.5 py-0.5 text-[11px] outline-none" style="background:rgba(255,253,247,0.92); border:1px solid rgba(130,96,62,0.25); color:#2d1a0f;" />`;
                  } else if (pType === 'number') {
                    valInputHtml = `<input data-prop-val="${idx}" type="number" value="${esc(pr.value ?? '')}" placeholder="0" class="flex-1 min-w-0 rounded-md px-1.5 py-0.5 text-[11px] outline-none" style="background:rgba(255,253,247,0.92); border:1px solid rgba(130,96,62,0.25); color:#2d1a0f;" />`;
                  } else {
                    valInputHtml = `<input data-prop-val="${idx}" type="text" value="${esc(pr.value ?? '')}" placeholder="Value…" class="flex-1 min-w-0 rounded-md px-1.5 py-0.5 text-[11px] outline-none" style="background:rgba(255,253,247,0.92); border:1px solid rgba(130,96,62,0.25); color:#2d1a0f;" />`;
                  }
                  return `
                    <div class="flex items-center gap-1">
                      <input data-prop-key="${idx}" type="text" value="${esc(pr.key || '')}" placeholder="Field (e.g. Name)"
                             class="w-[34%] min-w-[78px] rounded-md px-1.5 py-0.5 text-[11px] font-semibold outline-none"
                             style="background:rgba(255,250,240,0.85); border:1px solid rgba(130,96,62,0.25); color:#4a301e;" />
                      <select data-prop-type="${idx}" title="Property type" class="rounded-md px-1 py-0.5 text-[10px] outline-none cursor-pointer"
                              style="background:rgba(255,250,240,0.85); border:1px solid rgba(130,96,62,0.25); color:#6d4c33;">
                        <option value="text" ${pType === 'text' ? 'selected' : ''}>Text</option>
                        <option value="date" ${pType === 'date' ? 'selected' : ''}>Date</option>
                        <option value="number" ${pType === 'number' ? 'selected' : ''}>Num</option>
                        <option value="checkbox" ${pType === 'checkbox' ? 'selected' : ''}>Check</option>
                      </select>
                      ${valInputHtml}
                      <button data-prop-del="${idx}" type="button" title="Remove property" class="px-1 py-0.5 rounded text-xs font-bold cursor-pointer bg-transparent border-0 text-red-700/70 hover:text-red-700">&times;</button>
                    </div>
                  `;
                }).join('') || `<div class="text-[10.5px] italic py-0.5" style="color:#8a6a4e;">No properties yet — click "+ Property" to add fields like Name, Date of Birth, or Role.</div>`}
              </div>
            </div>
          `;
        })()}

        <!-- Compact Rich-Insert Toolbar -->
        <div class="relative flex items-center flex-wrap gap-1 pb-2 mb-1.5 border-b" style="border-color:rgba(122,92,68,0.16);">
          <button id="fmt-bold" type="button" title="Bold (Ctrl+B)" class="px-2 py-0.5 rounded-lg text-xs font-bold cursor-pointer hover:bg-black/10" style="background:rgba(130,96,62,0.09); color:#3c2516; border:1px solid rgba(130,96,62,0.2);">B</button>
          <button id="fmt-italic" type="button" title="Italic (Ctrl+I)" class="px-2 py-0.5 rounded-lg text-xs italic font-storybook cursor-pointer hover:bg-black/10" style="background:rgba(130,96,62,0.09); color:#3c2516; border:1px solid rgba(130,96,62,0.2);">I</button>
          <button id="fmt-list" type="button" title="Bullet list" class="px-2 py-0.5 rounded-lg text-xs font-semibold cursor-pointer hover:bg-black/10" style="background:rgba(130,96,62,0.09); color:#3c2516; border:1px solid rgba(130,96,62,0.2);">&bull; List</button>
          <button id="fmt-todo" type="button" title="Insert task checkbox (Enter = new task on next line, Shift+Enter = break out)" class="px-2 py-0.5 rounded-lg text-xs font-semibold cursor-pointer hover:bg-black/10" style="background:rgba(130,96,62,0.09); color:#3c2516; border:1px solid rgba(130,96,62,0.2);">&#9745; Task</button>
          <div class="w-px h-4 mx-0.5" style="background:rgba(130,96,62,0.25);"></div>
          <button id="btn-insert-img" type="button" title="Insert image (or paste screenshot / drag & drop!)" class="px-2 py-0.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:brightness-95" style="background:${chColor.soft}; color:${chColor.deep}; border:1px solid ${chColor.fill};">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            <span>Image</span>
          </button>
          <button id="btn-insert-link" type="button" title="Insert internal scroll link (or type [[ in the page!) or external web link" class="px-2 py-0.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer hover:brightness-95" style="background:${chColor.soft}; color:${chColor.deep}; border:1px solid ${chColor.fill};">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span>Link</span>
          </button>

          <!-- Upgraded 2-Tab Link Popover (Internal Library Scroll vs External Web ↗) -->
          <div id="link-popover" class="hidden absolute left-0 top-full mt-1.5 z-30 rounded-2xl p-3 w-80 max-w-[calc(100vw-48px)] shadow-xl space-y-2.5" style="background:#fffaf0; border:2px solid #8a6544; color:#321f13;">
            <div class="grid grid-cols-2 gap-1 p-0.5 rounded-xl" style="background:rgba(130,96,62,0.12);">
              <button id="link-tab-int" type="button" class="rounded-lg py-1 text-[11px] font-bold cursor-pointer border-0" style="background:#fffaf0; color:#321f13;">&#167; Internal Scroll</button>
              <button id="link-tab-ext" type="button" class="rounded-lg py-1 text-[11px] font-bold cursor-pointer bg-transparent border-0" style="color:#6d4f38;">External Web &#8599;</button>
            </div>

            <div id="link-pane-int" class="space-y-2">
              <input id="link-int-filter" type="text" placeholder="Filter library books &amp; pages…" class="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
              <div id="link-int-list" class="max-h-36 overflow-y-auto nice-scroll space-y-1 pr-0.5"></div>
              <input id="link-int-label" type="text" placeholder="Custom scroll label (optional)" class="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
            </div>

            <div id="link-pane-ext" class="hidden space-y-2">
              <input id="link-pop-label" type="text" placeholder="Link label (optional)" class="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
              <input id="link-pop-url" type="url" placeholder="https://example.com" class="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
            </div>

            <div class="flex justify-end gap-1.5 pt-0.5">
              <button id="link-pop-cancel" type="button" class="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer" style="background:#efe4ce; color:#4a301e; border:1px solid #c5ab86;">Cancel</button>
              <button id="link-pop-ok" type="button" class="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer" style="background:${chColor.fill}; color:#fffaf2; border:1px solid ${chColor.deep};">Insert Link</button>
            </div>
          </div>
        </div>

        <!-- Type [[ Quick Internal Scroll-Link Autocomplete Popover -->
        <div id="quick-wikilink-pop" class="hidden absolute left-2 top-28 z-40 rounded-2xl p-2 w-72 shadow-2xl space-y-1" style="background:#fffaf0; border:2px solid #5a3b22; color:#321f13;"></div>

        <div id="open-page-editor" contenteditable="true" spellcheck="true"
             data-placeholder="Write notes here… Click ☑ Task (Enter = new task, Shift+Enter = break out), type [[ to link a page, or paste screenshots!"
             class="rich-page-editor flex-1 overflow-y-auto nice-scroll pr-1.5 py-1"></div>

        <!-- Automatic "Mentioned In" Backlinks Footer (Suggestion 4) -->
        <div id="page-backlinks-bar" class="${backlinks.length ? '' : 'hidden'} pt-1.5 mt-1 border-t flex items-center gap-1.5 flex-wrap" style="border-color:rgba(122,92,68,0.18);">
          <span class="text-[10px] font-bold uppercase tracking-wider shrink-0" style="color:#7d5e45;">Mentioned In (${backlinks.length}):</span>
          ${backlinks.map((bl, bIdx) => {
            const bsw = getSwatch(bl.book.color || bl.hall.color);
            return `
              <button type="button" data-backlink-idx="${bIdx}" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-storybook font-bold cursor-pointer transition-transform hover:-translate-y-0.5"
                      style="background:${bsw.soft}; color:${bsw.deep}; border:1px solid ${bsw.fill}; border-left:3.5px solid ${bsw.fill};">
                <span>&#167;</span>
                <span class="truncate max-w-[165px]">${esc(bl.book.title)} &rsaquo; ${esc(bl.page.title)}</span>
              </button>
            `;
          }).join('')}
        </div>

        <div id="drop-overlay" class="hidden pointer-events-none absolute inset-1 rounded-xl flex items-center justify-center z-20" style="background: rgba(255, 250, 240, 0.88); border: 2.5px dashed #c96843;">
          <div class="text-center px-4 py-3 rounded-2xl" style="background:#fffdf7; border:2px solid #c96843; color:#9b482e;">
            <div class="font-storybook font-bold text-sm">Drop image onto this page</div>
            <div class="text-[11px]" style="color:#7a5c44;">It will be pinned inline with your notes</div>
          </div>
        </div>

        ${isScroll ? '' : `
          <div class="pt-2 mt-1.5 border-t flex items-center justify-between gap-2" style="border-color:rgba(122,92,68,0.2);">
            <button id="open-prev-page" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-35 transition-transform hover:-translate-x-0.5"
                    style="background:rgba(130,96,62,0.12); color:#362215; border:1.5px solid rgba(130,96,62,0.28);" ${prevPage ? '' : 'disabled'}>&larr; Prev ${isLoosePaper ? 'Paper' : 'Page'}</button>
            <span class="text-[11px] font-storybook italic" style="color:#8a6a4e;">&sim; ${activeIdx + 1} of ${orderedPages.length} &sim;</span>
            <button id="open-next-page" class="rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-35 transition-transform hover:translate-x-0.5"
                    style="background:rgba(130,96,62,0.12); color:#362215; border:1.5px solid rgba(130,96,62,0.28);" ${nextPage ? '' : 'disabled'}>Next ${isLoosePaper ? 'Paper' : 'Page'} &rarr;</button>
          </div>
        `}
      </div>
    `;
    const ed = document.getElementById('open-page-editor');
    ed.innerHTML = activePage.html || plainTextToHtml(activePage.body || '');
    refreshInternalLinkColors(ed);
    applyEditorSearchHighlights(ed);

    // Wire Backlinks chips
    bookRightEl.querySelectorAll('[data-backlink-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bl = backlinks[Number(btn.dataset.backlinkIdx)];
        if (!bl) return;
        if (bl.isLoosePaper) openLoosePaperCenter(bl.page.id);
        else openBookCenter(bl.hall.id, bl.book.id, bl.page.id);
      });
    });

    // Wire Single-Page Header Controls
    document.getElementById('btn-toggle-single-page')?.addEventListener('click', () => {
      openBookViewMode = openBookViewMode === 'single' ? 'spread' : 'single';
      renderOpenBook(false);
    });
    document.getElementById('btn-single-to-spread')?.addEventListener('click', () => {
      openBookViewMode = 'spread';
      renderOpenBook(false);
    });
    document.getElementById('btn-single-to-cork')?.addEventListener('click', () => {
      openBookViewMode = 'corkboard';
      renderOpenBook(false);
    });
    document.getElementById('single-page-picker')?.addEventListener('change', (e) => {
      selectBookPage(e.target.value, true);
    });
    document.getElementById('btn-toggle-ref-peek')?.addEventListener('click', () => {
      if (refPeekState.open) closeReferencePeek();
      else openReferencePeek();
    });

    // Wire Unrolled Scroll Header Controls
    bookRightEl.querySelectorAll('[data-scroll-swatch]').forEach(btn => {
      btn.addEventListener('click', () => {
        book.color = btn.dataset.scrollSwatch;
        if (book.chapters[0]) book.chapters[0].color = book.color;
        commitChange();
      });
    });
    document.getElementById('scroll-pin-btn')?.addEventListener('click', () => {
      togglePinBook(book.id);
    });
    document.getElementById('scroll-move-hall')?.addEventListener('change', (e) => {
      const destId = e.target.value;
      if (!destId) return;
      if (isCart) shelveCartBook(book.id, destId, true);
      else moveBookToHall(hall.id, book.id, destId);
    });
    document.getElementById('btn-scroll-to-book')?.addEventListener('click', () => {
      convertScrollToBook(hall.id, book.id);
    });
    document.getElementById('btn-scroll-export-md')?.addEventListener('click', () => {
      const md = bookToMarkdown(book, hall.title, 1);
      downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${slugify(book.title)}.md`);
      showToast(`Exported scroll "${book.title}" as Markdown (.md)`);
    });

    // Wire Loose Paper Single-Page Sorting Controls
    document.getElementById('btn-single-loose-file')?.addEventListener('click', () => {
      const destBookId = document.getElementById('single-loose-file-sel')?.value;
      if (!destBookId) return;
      const pid = activePage.id;
      closeOpenBook();
      fileCartPageIntoBook(pid, destBookId, null, false);
    });
    document.getElementById('btn-single-loose-promote')?.addEventListener('click', () => {
      const newBook = promoteCartPageToBook(activePage.id);
      if (newBook) openBookCenter(CART_HALL_ID, newBook.id, newBook.pages[0]?.id, 'spread');
    });
    document.getElementById('btn-single-loose-new')?.addEventListener('click', () => {
      createCartPage(true);
    });
  } else {
    const chColor = getSwatch(activeChapter?.color || book.color || hall.color);
    bookRightEl.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
        <div class="w-14 h-14 rounded-full flex items-center justify-center" style="background:${chColor.soft}; border:2px solid ${chColor.fill}; color:${chColor.deep};">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </div>
        <p class="font-storybook font-bold text-base" style="color:#2d1a0f;">No pages in "${esc(activeChapter?.title || 'this chapter')}" yet</p>
        <p class="text-xs max-w-[240px]" style="color:#785940;">Start writing notes, pasting screenshots, or stamping pages in this chapter.</p>
        <button id="open-first-page-btn" class="rounded-xl px-4 py-2 text-xs font-bold cursor-pointer" style="background:${chColor.fill}; color:#fffaf2; border:2px solid ${chColor.deep};">+ Write First Page</button>
      </div>
    `;
  }

  // ---- RIGHT OUTER EDGE: NAMED CHAPTER TABS (hidden for loose papers) ----
  if (isLoosePaper) {
    bookChapterTabsEl.innerHTML = '';
  } else {
    bookChapterTabsEl.innerHTML = book.chapters.map((ch, idx) => {
      const csw = getSwatch(ch.color || pal[idx % pal.length].id);
      const isAct = ch.id === activeChapter?.id;
      const chCount = book.pages.filter(p => p.chapterId === ch.id).length;
      return `
        <button data-tab-chapter="${ch.id}" draggable="true" title="${esc(ch.title)} (${chCount} ${chCount === 1 ? 'page' : 'pages'}) — drag to reorder"
                class="chapter-tab-btn ${isAct ? 'active-tab' : ''} rounded-r-2xl pl-3 pr-2.5 py-2 text-left cursor-pointer flex flex-col gap-0.5"
                style="background:${isAct ? csw.fill : '#f7ead1'}; color:${isAct ? '#fffaf2' : '#3c2516'}; border:2px solid #3c2516; border-left:0;">
          <span class="font-storybook font-bold text-[11.5px] leading-tight truncate block w-full">${esc(truncate(ch.title, 14))}</span>
          <span class="text-[9.5px] opacity-80">${chCount} ${chCount === 1 ? 'pg' : 'pp'}</span>
        </button>
      `;
    }).join('') + `
      <button id="tab-add-chapter" title="Add a new chapter tab"
              class="chapter-tab-btn rounded-r-2xl pl-3 pr-2.5 py-2 text-xs font-bold cursor-pointer text-left"
              style="background:#fffaf0; color:${sw.deep}; border:2px dashed ${sw.fill}; border-left:0;">+ Chapter</button>
    `;
  }

  // ---- BOTTOM EDGE: DANGLING CROSS-REFERENCE SILK BOOKMARK RIBBONS! ----
  const danglingRibbonsHtml = bookRibbons.map(rib => {
    const otherId = rib.fromBookId === book.id ? rib.toBookId : rib.fromBookId;
    const otherEntry = findBookEntry(otherId);
    if (!otherEntry) return '';
    const rsw = getSwatch(rib.colorId);
    const hasNote = Boolean(rib.label && rib.label.trim());
    return `
      <div class="dangling-ribbon-item inline-flex items-stretch">
        <button data-jump-ribbon-book="${otherId}"
                title="Jump to '${esc(otherEntry.book.title)}' in ${esc(otherEntry.hall.title)}${hasNote ? ' — ' + esc(rib.label) : ''}"
                class="relative min-w-[98px] max-w-[172px] px-3.5 pt-2.5 pb-4 text-center cursor-pointer bg-transparent border-0 flex flex-col items-center justify-center">
          <svg class="pointer-events-none absolute inset-0 w-full h-full drop-shadow-md" viewBox="0 0 120 52" preserveAspectRatio="none">
            <path d="M 3 0 L 117 0 L 117 48 L 60 36 L 3 48 Z" fill="${rsw.fill}" stroke="#3c2516" stroke-width="2.6" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
            <path d="M 10 2 L 10 41 M 110 2 L 110 41" stroke="${rsw.rugEdge}" stroke-width="1.3" stroke-dasharray="4 3" opacity="0.72" vector-effect="non-scaling-stroke" />
          </svg>
          <span class="relative z-10 font-storybook font-bold text-[11px] leading-tight truncate max-w-full" style="color:#fffaf2; text-shadow: 0 1px 2px ${rsw.deep};">${esc(truncate(otherEntry.book.title, 18))}</span>
          ${hasNote ? `<span class="relative z-10 text-[9.5px] leading-tight truncate max-w-full opacity-90" style="color:${rsw.rugEdge};">${esc(truncate(rib.label, 16))}</span>` : ''}
        </button>
        <button data-untie-ribbon="${rib.id}" title="Untie this ribbon"
                class="dangling-ribbon-untie absolute -top-1 -right-1.5 z-20 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center cursor-pointer"
                style="background:#fffaf0; color:#8f2e1e; border:1.8px solid #3c2516;">&times;</button>
      </div>
    `;
  }).join('');

  const addRibbonTailHtml = otherBooks.length > 0 ? `
    <div class="dangling-ribbon-item inline-flex items-stretch">
      <button id="btn-tie-ribbon-open" title="Tie a new cross-reference silk ribbon to another book"
              class="relative min-w-[84px] px-3 pt-2.5 pb-4 text-center cursor-pointer bg-transparent border-0 flex items-center justify-center">
        <svg class="pointer-events-none absolute inset-0 w-full h-full drop-shadow-sm" viewBox="0 0 100 48" preserveAspectRatio="none">
          <path d="M 3 0 L 97 0 L 97 44 L 50 33 L 3 44 Z" fill="#fffaf0" stroke="${sw.fill}" stroke-width="2.2" stroke-dasharray="5 3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </svg>
        <span class="relative z-10 text-[11px] font-bold" style="color:${sw.deep};">+ Ribbon</span>
      </button>
    </div>
  ` : '';

  bookBottomRibbonsEl.innerHTML = danglingRibbonsHtml + addRibbonTailHtml;

  if (otherBooks.length > 0) {
    ribbonTiePopEl.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-wider" style="color:#7a5c44;">Tie Cross-Reference Ribbon</span>
        <button id="ribbon-tie-cancel-x" type="button" class="text-xs font-bold px-1.5 py-0.5 rounded hover:bg-black/10 bg-transparent border-0 cursor-pointer" style="color:#6d4c33;">&times;</button>
      </div>
      <select id="ribbon-target-book" class="w-full rounded-xl px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;">
        ${otherBooks.map(e => `<option value="${e.book.id}">${esc(truncate(e.hall.title, 16))} &rsaquo; ${esc(truncate(e.book.title, 26))}</option>`).join('')}
      </select>
      <div class="flex items-center gap-1.5">
        <input id="ribbon-label-inp" type="text" placeholder="Ribbon label (e.g. Foreshadowing)…" class="flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;" />
        <select id="ribbon-color-sel" class="rounded-xl px-2 py-1.5 text-xs outline-none" style="background:#fff; border:1.5px solid #c5ab86; color:#321f13;">
          ${pal.map(c => `<option value="${c.id}" ${c.id === book.color ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="flex justify-end gap-1.5 pt-0.5">
        <button id="ribbon-tie-cancel" type="button" class="px-2.5 py-1 rounded-xl text-xs font-semibold cursor-pointer" style="background:#efe4ce; color:#4a301e; border:1px solid #c5ab86;">Cancel</button>
        <button id="ribbon-tie-save" type="button" class="px-3 py-1 rounded-xl text-xs font-bold cursor-pointer" style="background:${sw.fill}; color:#fffaf2; border:1px solid ${sw.deep};">Tie Ribbon</button>
      </div>
    `;
  } else {
    ribbonTiePopEl.innerHTML = '';
  }

  // ---- WIRE LEFT PAGE, BOTTOM RIBBONS & DRAGGABLE TOC ----
  document.getElementById('btn-open-corkboard')?.addEventListener('click', () => {
    openBookViewMode = 'corkboard';
    renderOpenBook(false);
  });
  const tplPickerPop = document.getElementById('tpl-picker-pop');
  document.getElementById('btn-open-tpl-picker')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tplPickerPop?.classList.toggle('hidden');
  });
  document.getElementById('tpl-picker-manage')?.addEventListener('click', () => {
    tplPickerPop?.classList.add('hidden');
    closeOpenBook();
    openCardIndex('templates', false);
  });
  bookLeftEl.querySelectorAll('[data-use-page-tpl]').forEach(btn => {
    btn.addEventListener('click', () => {
      tplPickerPop?.classList.add('hidden');
      createPageFromTemplate(hall.id, book.id, activeChapter?.id, btn.dataset.usePageTpl);
    });
  });
  document.getElementById('open-book-title')?.addEventListener('input', (e) => {
    book.title = e.target.value; persistState(); renderMap(); renderBreadcrumbs();
  });
  document.getElementById('open-book-title')?.addEventListener('change', () => pushHistory());
  document.getElementById('open-book-summary')?.addEventListener('input', (e) => {
    book.summary = e.target.value; persistState();
  });
  document.getElementById('open-book-summary')?.addEventListener('change', () => pushHistory());
  bookLeftEl.querySelectorAll('[data-book-swatch]').forEach(btn => {
    btn.addEventListener('click', () => { book.color = btn.dataset.bookSwatch; commitChange(); });
  });
  document.getElementById('open-palette-index')?.addEventListener('click', () => {
    closeOpenBook(); openCardIndex('colors');
  });
  document.getElementById('open-pin-book')?.addEventListener('click', () => {
    togglePinBook(book.id);
  });
  document.getElementById('open-move-hall')?.addEventListener('change', (e) => {
    const destId = e.target.value;
    if (!destId) return;
    if (isCart) shelveCartBook(book.id, destId, true);
    else moveBookToHall(hall.id, book.id, destId);
  });

  // Bottom Dangling Cross-Reference Ribbons wiring
  document.getElementById('btn-tie-ribbon-open')?.addEventListener('click', (e) => {
    e.stopPropagation();
    ribbonTiePopEl.classList.toggle('hidden');
    if (!ribbonTiePopEl.classList.contains('hidden')) {
      setTimeout(() => document.getElementById('ribbon-label-inp')?.focus(), 30);
    }
  });
  const closeTiePop = () => ribbonTiePopEl.classList.add('hidden');
  document.getElementById('ribbon-tie-cancel')?.addEventListener('click', closeTiePop);
  document.getElementById('ribbon-tie-cancel-x')?.addEventListener('click', closeTiePop);
  const saveRibbon = () => {
    const toId = document.getElementById('ribbon-target-book')?.value;
    const label = document.getElementById('ribbon-label-inp')?.value.trim() || '';
    const colorId = document.getElementById('ribbon-color-sel')?.value || book.color;
    if (!toId) return;
    tieBookRibbon(book.id, toId, label, colorId);
    closeTiePop();
  };
  document.getElementById('ribbon-tie-save')?.addEventListener('click', saveRibbon);
  document.getElementById('ribbon-label-inp')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRibbon(); } });

  bookBottomRibbonsEl.querySelectorAll('[data-jump-ribbon-book]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = findBookEntry(btn.dataset.jumpRibbonBook);
      if (target) openBookCenter(target.hall.id, target.book.id, null, openBookViewMode);
    });
  });
  bookBottomRibbonsEl.querySelectorAll('[data-untie-ribbon]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      untieBookRibbon(btn.dataset.untieRibbon);
    });
  });

  const addChHandler = () => createChapter(hall.id, book.id);
  document.getElementById('open-add-chapter')?.addEventListener('click', addChHandler);
  document.getElementById('tab-add-chapter')?.addEventListener('click', addChHandler);

  // Chapter Drag-to-Reorder & Page Drop onto Chapter Cards
  bookLeftEl.querySelectorAll('.toc-chapter-card').forEach(card => {
    const chId = card.dataset.tocChapter;
    card.addEventListener('dragstart', (e) => {
      if (e.target.closest('.toc-page-row') || e.target.tagName === 'INPUT') return;
      listDrag = { type: 'chapter', id: chId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chId);
      card.classList.add('dragging-item');
    });
    card.addEventListener('dragend', () => { listDrag = null; clearDropMarkers(document); clearCornerDropHighlights(); });
    card.addEventListener('dragover', (e) => {
      if (!listDrag) return;
      if (listDrag.type === 'chapter' && listDrag.id !== chId) {
        e.preventDefault(); clearDropMarkers(bookLeftEl);
        const rect = card.getBoundingClientRect();
        card.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
      } else if (listDrag.type === 'page' && !e.target.closest('.toc-page-row')) {
        e.preventDefault(); clearDropMarkers(bookLeftEl); card.classList.add('drop-into');
      }
    });
    card.addEventListener('drop', (e) => {
      if (!listDrag) return;
      if (listDrag.type === 'chapter' && listDrag.id !== chId) {
        e.preventDefault();
        const after = e.clientY > card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
        const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
        reorderChapter(book, draggedId, chId, after);
      } else if (listDrag.type === 'page' && !e.target.closest('.toc-page-row')) {
        e.preventDefault();
        const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
        reorderOrMovePage(book, draggedId, chId, null, true);
      }
    });
  });

  bookLeftEl.querySelectorAll('.toc-page-row').forEach(row => {
    const pageId = row.dataset.pickPage, chId = row.dataset.pageChapter;
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      listDrag = { type: 'page', id: pageId, bookId: book.id, hallId: hall.id };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pageId);
      row.classList.add('dragging-item');
    });
    row.addEventListener('dragend', () => { listDrag = null; clearDropMarkers(document); clearCornerDropHighlights(); });
    row.addEventListener('dragover', (e) => {
      if (!listDrag || listDrag.type !== 'page' || listDrag.id === pageId) return;
      e.preventDefault(); e.stopPropagation(); clearDropMarkers(bookLeftEl);
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
    });
    row.addEventListener('drop', (e) => {
      if (!listDrag || listDrag.type !== 'page' || listDrag.id === pageId) return;
      e.preventDefault(); e.stopPropagation();
      const after = e.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
      reorderOrMovePage(book, draggedId, chId, pageId, after);
    });
  });

  bookChapterTabsEl.querySelectorAll('[data-tab-chapter]').forEach(tab => {
    const chId = tab.dataset.tabChapter;
    tab.addEventListener('click', () => selectChapterTab(chId));
    tab.addEventListener('dragstart', (e) => {
      listDrag = { type: 'chapter', id: chId };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', chId);
      tab.classList.add('dragging-item');
    });
    tab.addEventListener('dragend', () => { listDrag = null; clearDropMarkers(document); clearCornerDropHighlights(); });
    tab.addEventListener('dragover', (e) => {
      if (!listDrag) return;
      if (listDrag.type === 'chapter' && listDrag.id !== chId) {
        e.preventDefault(); clearDropMarkers(bookChapterTabsEl);
        const rect = tab.getBoundingClientRect();
        tab.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
      } else if (listDrag.type === 'page') {
        e.preventDefault(); clearDropMarkers(bookChapterTabsEl); tab.classList.add('drop-into');
      }
    });
    tab.addEventListener('drop', (e) => {
      if (!listDrag) return;
      if (listDrag.type === 'chapter' && listDrag.id !== chId) {
        e.preventDefault();
        const after = e.clientY > tab.getBoundingClientRect().top + tab.getBoundingClientRect().height / 2;
        const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
        reorderChapter(book, draggedId, chId, after);
      } else if (listDrag.type === 'page') {
        e.preventDefault();
        const draggedId = listDrag.id; listDrag = null; clearDropMarkers(document);
        reorderOrMovePage(book, draggedId, chId, null, true);
      }
    });
  });

  bookLeftEl.querySelectorAll('[data-pick-chapter]').forEach(btn => {
    btn.addEventListener('click', () => selectChapterTab(btn.dataset.pickChapter));
    btn.addEventListener('dblclick', (e) => { e.stopPropagation(); editingChapterId = btn.dataset.pickChapter; renderOpenBook(false); focusChapterRenameInput(); });
  });
  bookLeftEl.querySelectorAll('[data-start-rename-ch]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); editingChapterId = btn.dataset.startRenameCh; renderOpenBook(false); focusChapterRenameInput(); });
  });
  bookLeftEl.querySelectorAll('[data-rename-chapter]').forEach(inp => {
    const ch = book.chapters.find(c => c.id === inp.dataset.renameChapter);
    const finish = () => { if (ch) ch.title = inp.value.trim() || ch.title; editingChapterId = null; commitChange(); };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') { e.stopPropagation(); editingChapterId = null; renderOpenBook(false); }
    });
    inp.addEventListener('blur', finish);
  });
  bookLeftEl.querySelectorAll('[data-add-page-ch]').forEach(btn => btn.addEventListener('click', () => createPage(hall.id, book.id, btn.dataset.addPageCh)));
  bookLeftEl.querySelectorAll('[data-del-ch]').forEach(btn => btn.addEventListener('click', () => deleteChapter(hall.id, book.id, btn.dataset.delCh)));
  bookLeftEl.querySelectorAll('[data-pick-page]').forEach(btn => btn.addEventListener('click', () => selectBookPage(btn.dataset.pickPage, true)));

  document.getElementById('open-first-page-btn')?.addEventListener('click', () => createPage(hall.id, book.id, activeChapter?.id));
  document.getElementById('open-jump-hall')?.addEventListener('click', () => {
    closeOpenBook();
    if (isCart || isLoosePaper) selectNode('cart', null, false);
    else selectNode('hall', hall.id, true);
  });
  document.getElementById('open-export-book-md')?.addEventListener('click', () => {
    const md = bookToMarkdown(book, hall.title, 1);
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${slugify(book.title)}.md`);
    showToast(`Exported "${book.title}" as Markdown (.md)`);
  });
  document.getElementById('open-del-book')?.addEventListener('click', () => recycleBook(hall.id, book.id));

  // ---- WIRE RIGHT PAGE STAMPS, TASKS, [[ WIKILINK AUTOCOMPLETE & RICH EDITOR ----
  if (activePage && !isDndSheetPage) {
    const editorEl = document.getElementById('open-page-editor');
    const dropzoneEl = document.getElementById('right-page-dropzone');
    const dropOverlay = document.getElementById('drop-overlay');
    const linkPop = document.getElementById('link-popover');
    const linkLabelInp = document.getElementById('link-pop-label');
    const linkUrlInp = document.getElementById('link-pop-url');
    const linkTabInt = document.getElementById('link-tab-int');
    const linkTabExt = document.getElementById('link-tab-ext');
    const linkPaneInt = document.getElementById('link-pane-int');
    const linkPaneExt = document.getElementById('link-pane-ext');
    const linkIntFilter = document.getElementById('link-int-filter');
    const linkIntList = document.getElementById('link-int-list');
    const linkIntLabel = document.getElementById('link-int-label');
    const stampTrayPop = document.getElementById('stamp-tray-pop');
    const stampXrefPop = document.getElementById('stamp-xref-pop');
    const quickWikiPop = document.getElementById('quick-wikilink-pop');
    const prevPage = orderedPages[activeIdx - 1];
    const nextPage = orderedPages[activeIdx + 1];

    // ---- Obsidian-Style Page Properties, Load Template & Save as Template Wiring ----
    const propsListEl = document.getElementById('page-props-list');
    const propsChevronEl = document.getElementById('page-props-chevron');
    const loadTplPop = document.getElementById('load-tpl-pop');
    const saveTplPop = document.getElementById('save-tpl-pop');
    const saveTplNameInp = document.getElementById('save-tpl-name');

    document.getElementById('btn-toggle-page-props')?.addEventListener('click', () => {
      if (!propsListEl) return;
      const nowHidden = propsListEl.classList.toggle('hidden');
      if (propsChevronEl) propsChevronEl.innerHTML = nowHidden ? '&#9656;' : '&#9662;';
    });
    document.getElementById('btn-add-page-prop')?.addEventListener('click', () => {
      if (!Array.isArray(activePage.properties)) activePage.properties = [];
      activePage.properties.push({ id: uid('pr'), key: '', type: 'text', value: '' });
      commitChange();
      setTimeout(() => {
        const inputs = bookRightEl.querySelectorAll('[data-prop-key]');
        inputs[inputs.length - 1]?.focus();
      }, 30);
    });
    document.getElementById('btn-open-load-tpl')?.addEventListener('click', (e) => {
      e.stopPropagation();
      stampTrayPop.classList.add('hidden');
      stampXrefPop.classList.add('hidden');
      linkPop.classList.add('hidden');
      saveTplPop?.classList.add('hidden');
      loadTplPop?.classList.toggle('hidden');
    });
    document.getElementById('load-tpl-manage')?.addEventListener('click', () => {
      loadTplPop?.classList.add('hidden');
      closeOpenBook();
      openCardIndex('templates', false);
    });
    bookRightEl.querySelectorAll('[data-apply-page-tpl]').forEach(btn => {
      btn.addEventListener('click', () => {
        loadTplPop?.classList.add('hidden');
        applyTemplateToPage(activePage, btn.dataset.applyPageTpl);
      });
    });
    document.getElementById('btn-open-save-tpl')?.addEventListener('click', (e) => {
      e.stopPropagation();
      stampTrayPop.classList.add('hidden');
      stampXrefPop.classList.add('hidden');
      linkPop.classList.add('hidden');
      loadTplPop?.classList.add('hidden');
      saveTplPop?.classList.toggle('hidden');
      if (saveTplPop && !saveTplPop.classList.contains('hidden')) {
        setTimeout(() => { saveTplNameInp?.focus(); saveTplNameInp?.select(); }, 30);
      }
    });
    const closeSaveTplPop = () => saveTplPop?.classList.add('hidden');
    document.getElementById('save-tpl-cancel')?.addEventListener('click', closeSaveTplPop);
    document.getElementById('save-tpl-cancel-x')?.addEventListener('click', closeSaveTplPop);
    const doSavePageTpl = () => {
      const tplName = (saveTplNameInp?.value || '').trim() || `${activePage.title || 'Page'} Template`;
      closeSaveTplPop();
      savePageAsTemplate(activePage, book, hall, tplName);
    };
    document.getElementById('save-tpl-confirm')?.addEventListener('click', doSavePageTpl);
    saveTplNameInp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSavePageTpl(); }
      if (e.key === 'Escape') { e.stopPropagation(); closeSaveTplPop(); }
    });

    bookRightEl.querySelectorAll('[data-prop-key]').forEach(inp => {
      const idx = Number(inp.dataset.propKey);
      inp.addEventListener('input', () => {
        if (activePage.properties?.[idx]) {
          activePage.properties[idx].key = inp.value;
          persistState();
        }
      });
      inp.addEventListener('change', () => pushHistory());
    });
    bookRightEl.querySelectorAll('[data-prop-type]').forEach(sel => {
      const idx = Number(sel.dataset.propType);
      sel.addEventListener('change', () => {
        const pr = activePage.properties?.[idx];
        if (!pr) return;
        pr.type = sel.value;
        if (pr.type === 'checkbox') pr.value = Boolean(pr.value && pr.value !== 'false');
        else if (typeof pr.value === 'boolean') pr.value = pr.value ? 'Yes' : '';
        commitChange();
      });
    });
    bookRightEl.querySelectorAll('[data-prop-val]').forEach(inp => {
      const idx = Number(inp.dataset.propVal);
      if (inp.type === 'checkbox') {
        inp.addEventListener('change', () => {
          if (activePage.properties?.[idx]) {
            activePage.properties[idx].value = inp.checked;
            commitChange();
          }
        });
      } else {
        inp.addEventListener('input', () => {
          if (activePage.properties?.[idx]) {
            activePage.properties[idx].value = inp.value;
            persistState();
          }
        });
        inp.addEventListener('change', () => pushHistory());
      }
    });
    bookRightEl.querySelectorAll('[data-prop-del]').forEach(btn => {
      const idx = Number(btn.dataset.propDel);
      btn.addEventListener('click', () => {
        if (!Array.isArray(activePage.properties)) return;
        activePage.properties.splice(idx, 1);
        commitChange();
      });
    });

    // Stamp tray toggle & quick-mint
    document.getElementById('btn-open-stamp-tray').addEventListener('click', (e) => {
      e.stopPropagation();
      stampXrefPop.classList.add('hidden');
      linkPop.classList.add('hidden');
      saveTplPop?.classList.add('hidden');
      stampTrayPop.classList.toggle('hidden');
    });
    document.getElementById('stamp-tray-manage').addEventListener('click', () => {
      closeOpenBook(); openCardIndex('stamps');
    });
    stampTrayPop.querySelectorAll('[data-toggle-stamp]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sid = btn.dataset.toggleStamp;
        if (!Array.isArray(activePage.stamps)) activePage.stamps = [];
        if (activePage.stamps.includes(sid)) activePage.stamps = activePage.stamps.filter(x => x !== sid);
        else activePage.stamps.push(sid);
        commitChange();
      });
    });
    const addQuickStamp = () => {
      const name = document.getElementById('quick-stamp-name').value.trim();
      const color = document.getElementById('quick-stamp-color').value || '#8a4f38';
      if (!name) return;
      const st = { id: uid('st'), label: name, color };
      state.stamps.push(st);
      if (!Array.isArray(activePage.stamps)) activePage.stamps = [];
      activePage.stamps.push(st.id);
      commitChange();
      showToast(`Minted & stamped "${name}"`);
    };
    document.getElementById('quick-stamp-add').addEventListener('click', addQuickStamp);
    document.getElementById('quick-stamp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addQuickStamp(); } });

    bookRightEl.querySelectorAll('[data-remove-page-stamp]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        activePage.stamps = (activePage.stamps || []).filter(x => x !== btn.dataset.removePageStamp);
        commitChange();
      });
    });

    bookRightEl.querySelectorAll('[data-xref-stamp]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        stampTrayPop.classList.add('hidden');
        linkPop.classList.add('hidden');
        const st = getStamp(btn.dataset.xrefStamp);
        if (!st) return;
        const matches = findPagesWithStamp(st.id, activePage.id);
        stampXrefPop.innerHTML = `
          <div class="flex items-center justify-between gap-2 pb-1.5 border-b" style="border-color:rgba(130,96,62,0.2);">
            <span class="library-stamp" style="color:${st.color}; background:${st.color}16;">${esc(st.label)}</span>
            <div class="flex items-center gap-1.5">
              <button id="btn-xref-glow-map" type="button" title="Light up all books carrying this stamp on the 2D library map"
                      class="text-[10.5px] font-bold px-2 py-0.5 rounded-lg cursor-pointer"
                      style="background:${st.color}; color:#fffaf2; border:1px solid #3c2516;">&#10022; Glow on Map</button>
              <button id="close-xref-pop" type="button" class="text-xs font-bold px-1.5 py-0.5 rounded hover:bg-black/10 bg-transparent border-0 cursor-pointer" style="color:#6d4c33;">&times;</button>
            </div>
          </div>
          <div class="text-[11px] font-semibold" style="color:#7a5c44;">
            ${matches.length ? `Cross-referenced in ${matches.length} other page${matches.length === 1 ? '' : 's'}:` : 'No other pages carry this stamp yet.'}
          </div>
          <div class="max-h-44 overflow-y-auto nice-scroll space-y-1">
            ${matches.map((m, idx) => `
              <button data-jump-xref="${idx}" type="button" class="w-full text-left px-2.5 py-1.5 rounded-xl text-xs hover:bg-black/5 flex flex-col cursor-pointer bg-transparent border border-amber-900/15">
                <span class="font-storybook font-bold truncate" style="color:#2d1a0f;">${esc(m.page.title)}</span>
                <span class="text-[10.5px] truncate" style="color:#7a5c44;">${esc(m.hall.title)} &rsaquo; ${esc(m.book.title)}</span>
              </button>
            `).join('')}
          </div>
        `;
        stampXrefPop.classList.remove('hidden');
        document.getElementById('close-xref-pop').addEventListener('click', () => stampXrefPop.classList.add('hidden'));
        document.getElementById('btn-xref-glow-map').addEventListener('click', () => {
          stampXrefPop.classList.add('hidden');
          closeOpenBook();
          clearSearch(false);
          if (activeStampLensId === st.id) activeStampLensId = null;
          setStampLens(st.id);
        });
        stampXrefPop.querySelectorAll('[data-jump-xref]').forEach(jb => {
          jb.addEventListener('click', () => {
            const m = matches[Number(jb.dataset.jumpXref)];
            stampXrefPop.classList.add('hidden');
            openBookCenter(m.hall.id, m.book.id, m.page.id, openBookViewMode);
          });
        });
      });
    });

    dropzoneEl.addEventListener('click', (e) => {
      if (!e.target.closest('#stamp-tray-pop') && !e.target.closest('#btn-open-stamp-tray')) stampTrayPop.classList.add('hidden');
      if (!e.target.closest('#stamp-xref-pop') && !e.target.closest('[data-xref-stamp]')) stampXrefPop.classList.add('hidden');
      if (!e.target.closest('#link-popover') && !e.target.closest('#btn-insert-link')) linkPop.classList.add('hidden');
      if (!e.target.closest('#quick-wikilink-pop')) quickWikiPop?.classList.add('hidden');
    });

    function syncEditorToPage(recordHistory = false) {
      activePage.html = editorEl.innerHTML;
      activePage.body = (editorEl.innerText || '').trim();
      persistState();
      if (recordHistory) pushHistory();
      applyEditorSearchHighlights(editorEl);
      updateGlobalTasksMenuUI();
      if (isLoosePaper) renderCornerTabletop();
      const tocBtn = bookLeftEl.querySelector(`[data-pick-page="${activePage.id}"]`);
      if (tocBtn) {
        const prevEl = tocBtn.querySelector('.toc-page-preview');
        if (prevEl) prevEl.textContent = truncate(activePage.body.replace(/\s+/g, ' '), 40);
        const todos = countPageTodos(activePage.html);
        let badgeEl = tocBtn.querySelector('.toc-todo-badge');
        if (todos.total > 0) {
          if (!badgeEl) {
            badgeEl = document.createElement('span');
            badgeEl.className = 'toc-todo-badge text-[9.5px] font-bold px-1.5 py-0 rounded-full';
            tocBtn.querySelector('.toc-page-title')?.after(badgeEl);
          }
          badgeEl.innerHTML = `&#10003; ${todos.done}/${todos.total}`;
          badgeEl.style.background = todos.done === todos.total ? '#d7ecd9' : 'rgba(130,96,62,0.14)';
          badgeEl.style.color = todos.done === todos.total ? '#2f5e36' : '#6c4d35';
        } else if (badgeEl) {
          badgeEl.remove();
        }
      }
    }

    // ---- Type [[ Inline Wikilink Autocomplete (Suggestion 3 / Item 4) ----
    let wikiContext = null; // { textNode, startOffset, endOffset, rows, selectedIdx }

    function buildWikilinkCandidates(rawQuery) {
      const q = (rawQuery || '').trim().toLowerCase();
      const rows = [];
      getAllBooksFlat().forEach(({ hall: h, book: b }) => {
        const bsw = getSwatch(b.color || h.color);
        b.pages.forEach(p => {
          if (p.id === activePage.id) return;
          if (!q || p.title.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
            const exact = q && p.title.toLowerCase() === q ? 0 : (q && p.title.toLowerCase().startsWith(q) ? 1 : 2);
            rows.push({ bookId: b.id, pageId: p.id, title: p.title, sub: `Page in ${b.title}`, color: bsw.fill, soft: bsw.soft, rank: exact });
          }
        });
        if (!q || b.title.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)) {
          const exact = q && b.title.toLowerCase() === q ? 0 : (q && b.title.toLowerCase().startsWith(q) ? 1 : 3);
          rows.push({ bookId: b.id, pageId: '', title: b.title, sub: `Book in ${h.title}`, color: bsw.fill, soft: bsw.soft, rank: exact });
        }
      });
      (state.cart?.books || []).forEach(b => {
        const bsw = getSwatch(b.color);
        b.pages.forEach(p => {
          if (p.id === activePage.id) return;
          if (!q || p.title.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
            const exact = q && p.title.toLowerCase() === q ? 0 : (q && p.title.toLowerCase().startsWith(q) ? 1 : 2);
            rows.push({ bookId: b.id, pageId: p.id, title: p.title, sub: `Page in ${b.title} (Sorting Pile)`, color: bsw.fill, soft: bsw.soft, rank: exact });
          }
        });
        if (!q || b.title.toLowerCase().includes(q)) {
          const exact = q && b.title.toLowerCase() === q ? 0 : (q && b.title.toLowerCase().startsWith(q) ? 1 : 3);
          rows.push({ bookId: b.id, pageId: '', title: b.title, sub: 'Unfiled Book in Sorting Pile', color: bsw.fill, soft: bsw.soft, rank: exact });
        }
      });
      rows.sort((a, b) => a.rank - b.rank);
      return rows;
    }

    function resolveCaretTextNode() {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
      let node = sel.anchorNode;
      let offset = sel.anchorOffset;
      if (!node || !editorEl.contains(node)) return null;

      if (node.nodeType === 1) {
        if (offset > 0 && node.childNodes[offset - 1]) {
          let candidate = node.childNodes[offset - 1];
          while (candidate && candidate.nodeType === 1 && candidate.lastChild) {
            candidate = candidate.lastChild;
          }
          if (candidate && candidate.nodeType === 3) {
            node = candidate;
            offset = (candidate.nodeValue || '').length;
          }
        }
      }
      if (node.nodeType !== 3) return null;

      // Merge adjacent preceding text node if the browser split "[[" across two text nodes
      while (node.previousSibling && node.previousSibling.nodeType === 3) {
        const prev = node.previousSibling;
        const prevText = prev.nodeValue || '';
        prev.nodeValue = prevText + (node.nodeValue || '');
        offset += prevText.length;
        node.parentNode.removeChild(node);
        node = prev;
        const r = document.createRange();
        r.setStart(node, offset);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return { node, offset, sel };
    }

    function positionQuickWikilinkPop(sel) {
      if (!quickWikiPop || !dropzoneEl) return;
      try {
        const dropRect = dropzoneEl.getBoundingClientRect();
        const rangeRect = sel.getRangeAt(0).getBoundingClientRect();
        if (rangeRect && (rangeRect.width > 0 || rangeRect.height > 0) && dropRect.width > 0) {
          const popW = 288;
          const popH = 235;
          const relLeft = Math.max(8, Math.min(Math.max(8, dropRect.width - popW - 8), rangeRect.left - dropRect.left));
          let relTop = rangeRect.bottom - dropRect.top + 6;
          if (relTop + popH > dropRect.height - 8) {
            relTop = Math.max(8, rangeRect.top - dropRect.top - popH - 6);
          }
          quickWikiPop.style.left = `${Math.round(relLeft)}px`;
          quickWikiPop.style.top = `${Math.round(relTop)}px`;
        }
      } catch (err) {}
    }

    function checkQuickWikilink() {
      if (!quickWikiPop) return;
      const resolved = resolveCaretTextNode();
      if (!resolved) {
        wikiContext = null;
        quickWikiPop.classList.add('hidden');
        return;
      }
      const { node, offset, sel } = resolved;
      const before = (node.nodeValue || '').slice(0, offset);

      // If user typed closing brackets [[Query]], automatically convert into a scroll link chip!
      const closedMatch = before.match(/\[\[([^\[\]\n]{1,48})\]\]$/);
      if (closedMatch) {
        const matches = buildWikilinkCandidates(closedMatch[1]);
        if (matches.length > 0) {
          wikiContext = {
            textNode: node,
            startOffset: offset - closedMatch[0].length,
            endOffset: offset,
            rows: matches.slice(0, 8),
            selectedIdx: 0
          };
          commitQuickWikilink(0);
          return;
        }
      }

      const m = before.match(/\[\[([^\[\]\n]{0,40})$/);
      if (!m) {
        wikiContext = null;
        quickWikiPop.classList.add('hidden');
        return;
      }
      const topRows = buildWikilinkCandidates(m[1]).slice(0, 8);
      if (topRows.length === 0) {
        wikiContext = null;
        quickWikiPop.classList.add('hidden');
        return;
      }
      const prevIdx = wikiContext ? Math.min(wikiContext.selectedIdx, topRows.length - 1) : 0;
      wikiContext = {
        textNode: node,
        startOffset: offset - m[0].length,
        endOffset: offset,
        rows: topRows,
        selectedIdx: prevIdx
      };
      positionQuickWikilinkPop(sel);
      renderQuickWikilinkPop();
    }

    function renderQuickWikilinkPop() {
      if (!wikiContext || !quickWikiPop) return;
      quickWikiPop.innerHTML = `
        <div class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 flex items-center justify-between" style="color:#7a5c44;">
          <span>&#167; Link Page or Book</span>
          <span class="font-mono text-[9.5px]">Enter / Click</span>
        </div>
        <div class="max-h-48 overflow-y-auto nice-scroll space-y-1">
          ${wikiContext.rows.map((r, idx) => `
            <button type="button" data-wiki-pick="${idx}" class="w-full text-left px-2 py-1 rounded-xl text-xs flex items-center gap-2 cursor-pointer"
                    style="background:${idx === wikiContext.selectedIdx ? r.soft : 'transparent'}; border:1.5px solid ${idx === wikiContext.selectedIdx ? r.color : 'transparent'}; border-left:3.5px solid ${r.color}; color:#2d1a0f;">
              <span class="min-w-0 flex-1">
                <span class="font-storybook font-bold block truncate">&#167; ${esc(r.title)}</span>
                <span class="text-[10px] block truncate" style="color:#785940;">${esc(r.sub)}</span>
              </span>
            </button>
          `).join('')}
        </div>
      `;
      quickWikiPop.classList.remove('hidden');
      quickWikiPop.querySelectorAll('[data-wiki-pick]').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          commitQuickWikilink(Number(btn.dataset.wikiPick));
        });
      });
    }

    function commitQuickWikilink(idx) {
      if (!wikiContext) return;
      const chosen = wikiContext.rows[idx] || wikiContext.rows[0];
      if (!chosen) return;
      const { textNode, startOffset, endOffset } = wikiContext;
      const r = document.createRange();
      r.setStart(textNode, startOffset);
      r.setEnd(textNode, endOffset);
      r.deleteContents();
      const linkNode = makeInternalLinkNode(chosen.title, chosen.bookId, chosen.pageId);
      r.insertNode(linkNode);
      const spacer = document.createTextNode('\u00A0');
      linkNode.after(spacer);
      const afterR = document.createRange();
      afterR.setStart(spacer, spacer.nodeValue.length);
      afterR.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(afterR);
      savedRange = afterR.cloneRange();
      wikiContext = null;
      quickWikiPop.classList.add('hidden');
      syncEditorToPage(true);
      showToast(`Linked scroll to "${chosen.title}"`);
    }

    editorEl.addEventListener('keyup', (e) => {
      saveEditorRange(editorEl);
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        checkQuickWikilink();
      }
    });
    editorEl.addEventListener('mouseup', () => saveEditorRange(editorEl));
    editorEl.addEventListener('input', () => {
      checkQuickWikilink();
      syncEditorToPage(false);
    });
    editorEl.addEventListener('blur', () => pushHistory());

    // Bullet-Style Tasks: Enter creates a new task on a new line, Shift+Enter breaks out of task mode!
    editorEl.addEventListener('keydown', (e) => {
      if (wikiContext && !quickWikiPop.classList.contains('hidden')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          wikiContext.selectedIdx = (wikiContext.selectedIdx + 1) % wikiContext.rows.length;
          renderQuickWikilinkPop();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          wikiContext.selectedIdx = (wikiContext.selectedIdx - 1 + wikiContext.rows.length) % wikiContext.rows.length;
          renderQuickWikilinkPop();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          commitQuickWikilink(wikiContext.selectedIdx);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          wikiContext = null;
          quickWikiPop.classList.add('hidden');
          return;
        }
      }

      if (e.key === 'Enter') {
        const sel = window.getSelection();
        const anchorNode = sel?.anchorNode;
        const todoRow = anchorNode ? (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement)?.closest('.page-todo-item') : null;
        if (todoRow && editorEl.contains(todoRow)) {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Enter breaks out of task mode onto a normal line!
            const txtSpan = todoRow.querySelector('.page-todo-text');
            const currentText = (txtSpan?.textContent || '').trim();
            const normalLine = document.createElement('div');
            normalLine.innerHTML = '<br>';
            if (!currentText) {
              todoRow.replaceWith(normalLine);
            } else {
              todoRow.after(normalLine);
            }
            const r = document.createRange();
            r.setStart(normalLine, 0);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            savedRange = r.cloneRange();
            syncEditorToPage(true);
          } else {
            // Enter always creates a new task on a new line right below!
            const nextRow = makeTodoRowNode('', false);
            todoRow.after(nextRow);
            focusTodoRowCaret(editorEl, nextRow, true);
            syncEditorToPage(true);
          }
          return;
        }
      }

      if (e.key === 'Backspace') {
        const sel = window.getSelection();
        if (sel && sel.isCollapsed) {
          const anchorNode = sel.anchorNode;
          const todoRow = anchorNode ? (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement)?.closest('.page-todo-item') : null;
          if (todoRow && editorEl.contains(todoRow)) {
            const txtSpan = todoRow.querySelector('.page-todo-text');
            const currentText = (txtSpan?.textContent || '').trim();
            if (!currentText) {
              e.preventDefault();
              const normalLine = document.createElement('div');
              normalLine.innerHTML = '<br>';
              todoRow.replaceWith(normalLine);
              const r = document.createRange();
              r.setStart(normalLine, 0);
              r.collapse(true);
              sel.removeAllRanges();
              sel.addRange(r);
              savedRange = r.cloneRange();
              syncEditorToPage(true);
            }
          }
        }
      }
    });

    editorEl.addEventListener('click', (e) => {
      const todoBox = e.target.closest('.page-todo-box');
      if (todoBox) {
        e.preventDefault(); e.stopPropagation();
        const row = todoBox.closest('.page-todo-item');
        if (row) {
          const next = row.dataset.checked !== 'true';
          row.dataset.checked = next ? 'true' : 'false';
          todoBox.setAttribute('aria-checked', next ? 'true' : 'false');
          if (next) playCozySound('chime');
          syncEditorToPage(true);
        }
        return;
      }
      const delBtn = e.target.closest('.page-img-del');
      if (delBtn) {
        e.preventDefault(); e.stopPropagation();
        delBtn.closest('.page-img-card')?.remove();
        syncEditorToPage(true);
        showToast('Removed image from page');
        return;
      }
      const imgEl = e.target.closest('.page-img-card img');
      if (imgEl) { e.preventDefault(); openLightbox(imgEl.src); return; }
      const intLink = e.target.closest('a.lib-internal-link');
      if (intLink) {
        e.preventDefault(); e.stopPropagation();
        const targetBookId = intLink.dataset.libBook;
        const targetPageId = intLink.dataset.libPage || null;
        const entry = findBookEntry(targetBookId);
        if (entry) {
          if (expandAncestorsOfHall(entry.hall.id, true)) renderMap();
          const bg = layoutCache.books[entry.book.id];
          if (bg) flyTo(bg.x, bg.y, 0.94, 380);
          openBookCenter(entry.hall.id, entry.book.id, targetPageId, openBookViewMode);
          showToast(`Jumped to "${entry.book.title}"`);
          return;
        }
        const cartBook = (state.cart?.books || []).find(b => b.id === targetBookId);
        if (cartBook) {
          openBookCenter(CART_HALL_ID, cartBook.id, targetPageId, openBookViewMode);
          showToast(`Jumped to "${cartBook.title}" in Sorting Pile`);
          return;
        }
        showToast('That cited book is no longer on the shelves');
        return;
      }
      const linkEl = e.target.closest('a[href]');
      if (linkEl) { e.preventDefault(); window.open(linkEl.href, '_blank', 'noopener,noreferrer'); }
    });

    async function handleImageFiles(files) {
      const imgs = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
      if (imgs.length === 0) return false;
      for (const f of imgs) {
        try { insertNodeAtCaret(editorEl, makeInlineImageCard(await compressImageFile(f))); }
        catch (err) { showToast('Could not read that image'); }
      }
      syncEditorToPage(true);
      showToast(imgs.length === 1 ? 'Pinned image onto page!' : `Pinned ${imgs.length} images onto page!`);
      return true;
    }

    editorEl.addEventListener('paste', async (e) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const pastedFiles = [];
      if (dt.items) {
        for (const item of dt.items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) pastedFiles.push(f); }
        }
      }
      if (pastedFiles.length === 0 && dt.files?.length) {
        for (const f of dt.files) if (f.type.startsWith('image/')) pastedFiles.push(f);
      }
      if (pastedFiles.length > 0) {
        e.preventDefault(); saveEditorRange(editorEl);
        await handleImageFiles(pastedFiles);
        return;
      }
      const text = dt.getData('text/plain');
      if (text) {
        e.preventDefault(); saveEditorRange(editorEl);
        const trimmed = text.trim();
        if (/^https?:\/\/\S+$/i.test(trimmed)) insertNodeAtCaret(editorEl, makeHyperlinkNode(trimmed, trimmed));
        else {
          const frag = document.createElement('span');
          frag.innerHTML = plainTextToHtml(text);
          const range = restoreOrEndRange(editorEl);
          range.deleteContents();
          let lastNode = null;
          while (frag.firstChild) { lastNode = frag.firstChild; range.insertNode(lastNode); range.setStartAfter(lastNode); }
          range.collapse(true);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        }
        syncEditorToPage(true);
      }
    });

    let dragCounter = 0;
    dropzoneEl.addEventListener('dragenter', (e) => {
      if (!listDrag && e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault(); dragCounter++;
        dropzoneEl.classList.add('drop-active-ring'); dropOverlay.classList.remove('hidden');
      }
    });
    dropzoneEl.addEventListener('dragover', (e) => {
      if (!listDrag && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    dropzoneEl.addEventListener('dragleave', () => {
      if (dragCounter > 0) {
        dragCounter--;
        if (dragCounter === 0) { dropzoneEl.classList.remove('drop-active-ring'); dropOverlay.classList.add('hidden'); }
      }
    });
    dropzoneEl.addEventListener('drop', async (e) => {
      if (listDrag) return;
      e.preventDefault(); dragCounter = 0;
      dropzoneEl.classList.remove('drop-active-ring'); dropOverlay.classList.add('hidden');
      if (e.dataTransfer?.files?.length) await handleImageFiles(e.dataTransfer.files);
    });

    document.getElementById('fmt-bold').addEventListener('mousedown', (e) => { e.preventDefault(); document.execCommand('bold'); syncEditorToPage(true); });
    document.getElementById('fmt-italic').addEventListener('mousedown', (e) => { e.preventDefault(); document.execCommand('italic'); syncEditorToPage(true); });
    document.getElementById('fmt-list').addEventListener('mousedown', (e) => { e.preventDefault(); document.execCommand('insertUnorderedList'); syncEditorToPage(true); });
    document.getElementById('fmt-todo').addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertTaskFromToolbar(editorEl, syncEditorToPage);
    });

    document.getElementById('btn-insert-img').addEventListener('mousedown', (e) => {
      e.preventDefault(); saveEditorRange(editorEl);
      pageImagePicker.onchange = async (ev) => { if (ev.target.files?.length) await handleImageFiles(ev.target.files); pageImagePicker.value = ''; };
      pageImagePicker.click();
    });

    // Upgraded 2-Tab Link Popover (Internal Library Scroll vs External Web ↗)
    let linkMode = 'int'; // 'int' | 'ext'
    let pickedInternal = null; // { bookId, pageId, defaultLabel }

    function setLinkTab(mode) {
      linkMode = mode;
      const isInt = mode === 'int';
      linkPaneInt.classList.toggle('hidden', !isInt);
      linkPaneExt.classList.toggle('hidden', isInt);
      linkTabInt.style.background = isInt ? '#fffaf0' : 'transparent';
      linkTabInt.style.color = isInt ? '#321f13' : '#6d4f38';
      linkTabExt.style.background = !isInt ? '#fffaf0' : 'transparent';
      linkTabExt.style.color = !isInt ? '#321f13' : '#6d4f38';
      document.getElementById('link-pop-ok').textContent = isInt ? 'Insert Scroll' : 'Insert Web ↗';
    }

    function renderInternalLinkPicker(filter = '') {
      const q = filter.trim().toLowerCase();
      const rows = [];
      getAllBooksFlat().forEach(({ hall: h, book: b }) => {
        const bsw = getSwatch(b.color || h.color);
        const bookMatch = !q || b.title.toLowerCase().includes(q) || h.title.toLowerCase().includes(q);
        if (bookMatch) {
          rows.push({ bookId: b.id, pageId: '', title: b.title, sub: `Book in ${h.title}`, color: bsw.fill, soft: bsw.soft, deep: bsw.deep });
        }
        b.pages.forEach(p => {
          if (p.id === activePage.id) return;
          if (!q || p.title.toLowerCase().includes(q) || b.title.toLowerCase().includes(q)) {
            rows.push({ bookId: b.id, pageId: p.id, title: p.title, sub: `Page in ${b.title}`, color: bsw.fill, soft: bsw.soft, deep: bsw.deep });
          }
        });
      });
      if (!pickedInternal || !rows.some(r => r.bookId === pickedInternal.bookId && r.pageId === pickedInternal.pageId)) {
        pickedInternal = rows[0] ? { bookId: rows[0].bookId, pageId: rows[0].pageId, defaultLabel: rows[0].title } : null;
      }
      linkIntList.innerHTML = rows.slice(0, 32).map((r, i) => {
        const sel = pickedInternal && pickedInternal.bookId === r.bookId && pickedInternal.pageId === r.pageId;
        return `
          <button type="button" data-int-pick="${i}" class="w-full text-left px-2 py-1.5 rounded-xl text-xs flex items-center gap-2 cursor-pointer transition-colors"
                  style="background:${sel ? r.soft : 'rgba(255,255,255,0.75)'}; border:1.5px solid ${sel ? r.color : 'rgba(130,96,62,0.16)'}; border-left:4px solid ${r.color}; color:#2d1a0f;">
            <span class="min-w-0 flex-1">
              <span class="font-storybook font-bold block truncate">${esc(r.title)}</span>
              <span class="text-[10px] block truncate" style="color:#785940;">${esc(r.sub)}</span>
            </span>
          </button>
        `;
      }).join('') || `<div class="text-xs italic px-2 py-2" style="color:#8a6a4e;">No matching books or pages found.</div>`;

      linkIntList.querySelectorAll('[data-int-pick]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = rows[Number(btn.dataset.intPick)];
          pickedInternal = { bookId: r.bookId, pageId: r.pageId, defaultLabel: r.title };
          renderInternalLinkPicker(linkIntFilter.value);
        });
        btn.addEventListener('dblclick', () => {
          const r = rows[Number(btn.dataset.intPick)];
          pickedInternal = { bookId: r.bookId, pageId: r.pageId, defaultLabel: r.title };
          commitLink();
        });
      });
    }

    linkTabInt.addEventListener('click', () => { setLinkTab('int'); linkIntFilter.focus(); });
    linkTabExt.addEventListener('click', () => { setLinkTab('ext'); linkUrlInp.focus(); });
    linkIntFilter.addEventListener('input', () => renderInternalLinkPicker(linkIntFilter.value));

    document.getElementById('btn-insert-link').addEventListener('mousedown', (e) => {
      e.preventDefault(); saveEditorRange(editorEl);
      stampTrayPop.classList.add('hidden'); stampXrefPop.classList.add('hidden');
      const selText = window.getSelection()?.toString().trim() || '';
      linkLabelInp.value = selText; linkUrlInp.value = '';
      linkIntLabel.value = selText; linkIntFilter.value = '';
      setLinkTab('int');
      renderInternalLinkPicker('');
      linkPop.classList.remove('hidden');
      setTimeout(() => linkIntFilter.focus(), 30);
    });
    document.getElementById('link-pop-cancel').addEventListener('click', () => { linkPop.classList.add('hidden'); editorEl.focus(); });
    const commitLink = () => {
      if (linkMode === 'int') {
        if (!pickedInternal) { showToast('Pick a library book or page to link'); return; }
        const label = linkIntLabel.value.trim() || pickedInternal.defaultLabel;
        linkPop.classList.add('hidden');
        insertNodeAtCaret(editorEl, makeInternalLinkNode(label, pickedInternal.bookId, pickedInternal.pageId));
        syncEditorToPage(true);
        showToast(`Added scroll link to "${pickedInternal.defaultLabel}"`);
      } else {
        const url = linkUrlInp.value.trim();
        if (!url) { linkUrlInp.focus(); return; }
        const label = linkLabelInp.value.trim() || url;
        linkPop.classList.add('hidden');
        insertNodeAtCaret(editorEl, makeHyperlinkNode(label, url));
        syncEditorToPage(true);
        showToast('Added external web link ↗');
      }
    };
    document.getElementById('link-pop-ok').addEventListener('click', commitLink);
    linkUrlInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitLink(); } });
    linkLabelInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); linkUrlInp.focus(); } });
    linkIntLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitLink(); } });

    document.getElementById('open-page-title').addEventListener('input', (e) => {
      activePage.title = e.target.value;
      if (isScroll) {
        book.title = e.target.value;
        renderMap();
        renderCornerTabletop();
      }
      persistState(); renderBreadcrumbs();
      if (isLoosePaper) renderCornerTabletop();
      const tocTitle = bookLeftEl.querySelector(`[data-pick-page="${activePage.id}"] .toc-page-title`);
      if (tocTitle) tocTitle.textContent = activePage.title || 'Untitled Page';
    });
    document.getElementById('open-page-title').addEventListener('change', () => pushHistory());
    document.getElementById('open-prev-page')?.addEventListener('click', () => { if (prevPage) selectBookPage(prevPage.id, true); });
    document.getElementById('open-next-page')?.addEventListener('click', () => { if (nextPage) selectBookPage(nextPage.id, true); });
    document.getElementById('open-del-page').addEventListener('click', () => {
      if (isScroll) {
        recycleBook(hall.id, book.id);
      } else if (isLoosePaper) {
        const nextChoice = nextPage || prevPage || null;
        recycleCartPage(activePage.id);
        if (nextChoice) openLoosePaperCenter(nextChoice.id);
        else closeOpenBook();
      } else {
        recycleBookPage(hall.id, book.id, activePage.id);
      }
    });
  }
}

function focusChapterRenameInput() {
  setTimeout(() => {
    const inp = bookLeftEl.querySelector('[data-rename-chapter]');
    if (inp) { inp.focus(); inp.select(); }
  }, 30);
}

bookModal.addEventListener('click', (e) => {
  if (e.target === bookModal) { closeOpenBook(); return; }
  if (!e.target.closest('#load-tpl-pop') && !e.target.closest('#btn-open-load-tpl')) {
    document.getElementById('load-tpl-pop')?.classList.add('hidden');
  }
  if (!e.target.closest('#save-tpl-pop') && !e.target.closest('#btn-open-save-tpl')) {
    document.getElementById('save-tpl-pop')?.classList.add('hidden');
  }
  if (!e.target.closest('#tpl-picker-pop') && !e.target.closest('#btn-open-tpl-picker')) {
    document.getElementById('tpl-picker-pop')?.classList.add('hidden');
  }
});
document.getElementById('btn-close-book').addEventListener('click', closeOpenBook);
