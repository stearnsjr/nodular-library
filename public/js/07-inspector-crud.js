// ============================================================
// 9. CANVAS SELECTION, CRUD & CENTRAL ROTUNDA CARD INDEX
// ============================================================
const inspPanel = document.getElementById('inspector-panel');
const inspBody = document.getElementById('inspector-body');
const inspBadge = document.getElementById('insp-badge');
const inspHeaderTitle = document.getElementById('insp-header-title');

const cornerTabletopWrap = document.getElementById('corner-tabletop-wrap');
function openInspector() {
  inspPanel.classList.remove('hidden-panel');
  cornerTabletopWrap?.classList.add('inspector-open-shift');
}
function closeInspector() {
  inspPanel.classList.add('hidden-panel');
  cornerTabletopWrap?.classList.remove('inspector-open-shift');
}

function openCardIndex(tab = 'colors', shouldFly = false) {
  cardIndexTab = tab;
  selectNode('hub', null, shouldFly);
}

function selectNode(type, hallId = null, shouldFly = false) {
  selection = { type, hallId };
  renderAll();
  openInspector();
  if (shouldFly) {
    if (type === 'hub') flyTo(0, 0, 0.92);
    else if (type === 'hall') {
      const hg = layoutCache.hallMap[hallId];
      if (hg) { const mid = hg.spineAt(0.5); flyTo(mid.x, mid.y, 0.9); }
    }
  }
}

function clearSelection() {
  selection = { type: null, hallId: null };
  closeInspector();
  renderAll();
}

svgEl.addEventListener('click', (e) => {
  if (suppressNextClick || dragMoved) return;
  const target = e.target.closest('[data-action]');
  if (!target) { if (selection.type) clearSelection(); return; }
  e.stopPropagation();
  const { action, hallId, bookId } = target.dataset;
  if (action === 'drag-hall-angle') return;
  if (action === 'select-hub') { cardIndexTab = 'rotunda'; selectNode('hub'); }
  else if (action === 'pet-cat') {
    playCozySound('purr');
    showToast('Mochi the Library Cat purrs softly…');
  }
  else if (action === 'select-study') selectNode('study');
  else if (action === 'select-cart') selectNode('cart');
  else if (action === 'toggle-collapse-hall') toggleCollapseHall(hallId);
  else if (action === 'open-card-index') openCardIndex('colors', false);
  else if (action === 'inspect-ribbon') openCardIndex('ribbons', false);
  else if (action === 'select-hall') selectNode('hall', hallId);
  else if (action === 'open-book') openBookCenter(hallId, bookId);
  else if (action === 'add-hall') createHall(null);
  else if (action === 'add-subhall') createHall(hallId);
  else if (action === 'add-book') createBook(hallId);
  else if (action === 'add-scroll') createScroll(hallId);
  else if (action === 'add-dndchar') createCharacterBook(hallId, '2024');
});

svgEl.addEventListener('dblclick', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, hallId } = target.dataset;
  if (action === 'drag-hall-angle') {
    const info = findHallInfo(hallId);
    if (info && info.hall.customAngle != null) {
      info.hall.customAngle = null;
      commitChange();
      showToast(`Reset "${info.hall.title}" angle`);
    }
    return;
  }
  if (action === 'select-hub') { cardIndexTab = 'rotunda'; selectNode('hub', null, true); }
  if (action === 'select-hall') selectNode('hall', hallId, true);
});

function toggleCollapseHall(hallId) {
  const info = findHallInfo(hallId);
  if (!info) return;
  info.hall.collapsed = !info.hall.collapsed;
  commitChange();
  showToast(info.hall.collapsed ? `Folded "${info.hall.title}" wing` : `Expanded "${info.hall.title}" wing`);
}

function togglePinBook(bookId, forceState = null) {
  const entry = findBookEntry(bookId);
  if (!entry) return;
  if (!Array.isArray(state.studyStack)) state.studyStack = [];
  const isCurrentlyPinned = state.studyStack.includes(bookId) || Boolean(entry.book.pinned);
  const next = forceState !== null ? Boolean(forceState) : !isCurrentlyPinned;

  if (next) {
    if (!state.studyStack.includes(bookId)) {
      if (state.studyStack.length >= MAX_STUDY_TABLE_BOOKS) {
        showToast(`Study Table holds up to ${MAX_STUDY_TABLE_BOOKS} books — remove a book from the table first!`);
        return;
      }
      state.studyStack.push(bookId);
    }
    entry.book.pinned = true;
    tabletopCollapsed = false;
    expandAncestorsOfHall(entry.hall.id, true);
    commitChange();
    dispatchLibrarian({
      direction: 'in',
      kind: 'book',
      source: 'study',
      bookId: entry.book.id,
      hallId: entry.hall.id,
      title: entry.book.title,
      colorId: entry.book.color || entry.hall.color
    });
    showToast(`Little librarian fetched "${entry.book.title}" for your Study Table (${state.studyStack.length}/${MAX_STUDY_TABLE_BOOKS})`);
  } else {
    const startScreenPt = captureTabletopItemScreenPoint('study', bookId);
    state.studyStack = state.studyStack.filter(id => id !== bookId);
    entry.book.pinned = false;
    expandAncestorsOfHall(entry.hall.id, true);
    commitChange();
    dispatchLibrarian({
      direction: 'out',
      kind: 'book',
      source: 'study',
      bookId: entry.book.id,
      hallId: entry.hall.id,
      title: entry.book.title,
      colorId: entry.book.color || entry.hall.color,
      startScreenPt
    });
    showToast(`Little librarian is returning "${entry.book.title}" to ${entry.hall.title}!`);
  }
}

function putAllStudyTableBooksBack() {
  const pinned = getPinnedBooks();
  if (pinned.length === 0) return;
  const returns = [...pinned].reverse().map((entry, idx) => ({
    entry,
    startScreenPt: captureTabletopItemScreenPoint('study', entry.book.id),
    delayMs: idx * 95
  }));
  state.studyStack = [];
  forEachHall(h => h.books.forEach(b => { b.pinned = false; }));
  returns.forEach(({ entry }) => expandAncestorsOfHall(entry.hall.id, true));
  commitChange();
  returns.forEach(({ entry, startScreenPt, delayMs }) => {
    dispatchLibrarian({
      direction: 'out',
      kind: 'book',
      source: 'study',
      bookId: entry.book.id,
      hallId: entry.hall.id,
      title: entry.book.title,
      colorId: entry.book.color || entry.hall.color,
      startScreenPt,
      delayMs
    });
  });
  showToast(returns.length === 1
    ? `Little librarian is returning "${returns[0].entry.book.title}" to its shelf!`
    : `${returns.length} little librarians are returning your Study Table books to their shelves!`);
}

function reorderStudyTableStack(draggedBookId, targetBookId, placeAboveVisually = true) {
  if (!Array.isArray(state.studyStack) || draggedBookId === targetBookId) return;
  const fromIdx = state.studyStack.indexOf(draggedBookId);
  if (fromIdx === -1) return;
  state.studyStack.splice(fromIdx, 1);
  const toIdx = state.studyStack.indexOf(targetBookId);
  if (toIdx === -1) {
    state.studyStack.push(draggedBookId);
  } else {
    // Visual top of the Study Table is the end of state.studyStack (rendered with reverse())
    const insertIdx = placeAboveVisually ? toIdx + 1 : toIdx;
    state.studyStack.splice(insertIdx, 0, draggedBookId);
  }
  commitChange();
  showToast('Reordered books on the Study Table');
}

function saveStudyPreset(rawName) {
  const pinned = getPinnedBooks();
  if (pinned.length === 0) {
    showToast('Stack at least 1 book on the Study Table before saving a Reading Stack');
    return;
  }
  if (!Array.isArray(state.studyPresets)) state.studyPresets = [];
  const name = (rawName || '').trim() || `Reading Stack ${state.studyPresets.length + 1}`;
  state.studyPresets.unshift({
    id: uid('sp'),
    name,
    bookIds: pinned.map(e => e.book.id).slice(0, MAX_STUDY_TABLE_BOOKS)
  });
  playCozySound('chime');
  commitChange();
  showToast(`Saved Reading Stack "${name}" (${pinned.length} book${pinned.length === 1 ? '' : 's'})`);
}

function loadStudyPreset(presetId) {
  const preset = (state.studyPresets || []).find(p => p.id === presetId);
  if (!preset) return;
  const validNextIds = (preset.bookIds || []).filter(id => Boolean(findBookEntry(id))).slice(0, MAX_STUDY_TABLE_BOOKS);
  if (validNextIds.length === 0) {
    showToast(`No books from "${preset.name}" are currently on the shelves`);
    return;
  }
  const prevPinned = getPinnedBooks();
  const prevSet = new Set(prevPinned.map(e => e.book.id));
  const nextSet = new Set(validNextIds);

  const leaving = prevPinned.filter(e => !nextSet.has(e.book.id));
  const joining = validNextIds.filter(id => !prevSet.has(id)).map(id => findBookEntry(id)).filter(Boolean);

  state.studyStack = [...validNextIds];
  forEachHall(h => h.books.forEach(b => { b.pinned = nextSet.has(b.id); }));
  [...leaving, ...joining].forEach(e => expandAncestorsOfHall(e.hall.id, true));
  tabletopCollapsed = false;
  commitChange();

  leaving.forEach((entry, idx) => {
    dispatchLibrarian({
      direction: 'out',
      kind: 'book',
      source: 'study',
      bookId: entry.book.id,
      hallId: entry.hall.id,
      title: entry.book.title,
      colorId: entry.book.color || entry.hall.color,
      delayMs: idx * 80
    });
  });
  joining.forEach((entry, idx) => {
    dispatchLibrarian({
      direction: 'in',
      kind: 'book',
      source: 'study',
      bookId: entry.book.id,
      hallId: entry.hall.id,
      title: entry.book.title,
      colorId: entry.book.color || entry.hall.color,
      delayMs: (leaving.length * 45) + idx * 85
    });
  });
  showToast(`Loaded "${preset.name}" (${validNextIds.length} book${validNextIds.length === 1 ? '' : 's'} stacked)`);
}

function deleteStudyPreset(presetId) {
  if (!Array.isArray(state.studyPresets)) return;
  const found = state.studyPresets.find(p => p.id === presetId);
  state.studyPresets = state.studyPresets.filter(p => p.id !== presetId);
  commitChange();
  if (found) showToast(`Deleted Reading Stack "${found.name}"`);
}

function createCartBook() {
  const pal = getPalette();
  const col = pal[(state.cart.books.length + 2) % pal.length].id;
  const chId = uid('ch'), pId = uid('p');
  const newBook = {
    id: uid('b'), title: `Draft Book ${state.cart.books.length + 1}`, color: col, pinned: false, summary: 'Quick-captured in the Sorting Pile.',
    chapters: [{ id: chId, title: 'Chapter 1', color: col }],
    pages: [{ id: pId, chapterId: chId, title: 'First Notes', stamps: [], body: '', html: '' }]
  };
  state.cart.books.push(newBook);
  tabletopCollapsed = false;
  commitChange();
  openBookCenter(CART_HALL_ID, newBook.id, pId);
  setTimeout(() => {
    const inp = document.getElementById('open-book-title');
    if (inp) { inp.focus(); inp.select(); }
  }, 80);
  showToast('Added unfiled book to the Sorting Pile');
}

function createCartPage(openInSinglePage = false) {
  const newPage = { id: uid('cp'), title: `Loose Paper ${state.cart.pages.length + 1}`, stamps: [], body: '', html: '' };
  state.cart.pages.push(newPage);
  expandedCartPageId = newPage.id;
  tabletopCollapsed = false;
  commitChange();
  if (openInSinglePage === true) {
    openLoosePaperCenter(newPage.id);
    setTimeout(() => {
      const inp = document.getElementById('open-page-title');
      if (inp) { inp.focus(); inp.select(); }
    }, 60);
  } else {
    selectNode('cart', null, false);
    setTimeout(() => {
      const inp = inspBody.querySelector(`[data-cart-page-title="${newPage.id}"]`);
      if (inp) { inp.focus(); inp.select(); }
    }, 50);
  }
  showToast('Tossed a new loose paper onto the Sorting Pile');
}

function moveBookToCart(fromHallId, bookId) {
  const info = findHallInfo(fromHallId);
  if (!info) return;
  const idx = info.hall.books.findIndex(b => b.id === bookId);
  if (idx === -1) return;
  const [book] = info.hall.books.splice(idx, 1);
  book.pinned = false;
  if (Array.isArray(state.studyStack)) {
    state.studyStack = state.studyStack.filter(id => id !== bookId);
  }
  state.cart.books.push(book);
  tabletopCollapsed = false;
  if (openBookState.bookId === bookId) openBookState.hallId = CART_HALL_ID;
  commitChange();
  dispatchLibrarian({
    direction: 'in',
    kind: 'book',
    source: 'pile',
    bookId: null,
    hallId: fromHallId,
    title: book.title,
    colorId: book.color || info.hall.color
  });
  showToast(`Little librarian carried "${book.title}" to the Sorting Pile`);
}

function shelveCartBookAt(bookId, destHallId, rawInsertIdx = null) {
  const idx = (state.cart?.books || []).findIndex(b => b.id === bookId);
  const destInfo = findHallInfo(destHallId);
  if (idx === -1 || !destInfo) return;
  const startScreenPt = captureTabletopItemScreenPoint('pile', bookId);
  const [book] = state.cart.books.splice(idx, 1);
  expandAncestorsOfHall(destHallId, true);
  if (typeof rawInsertIdx === 'number' && Number.isFinite(rawInsertIdx)) {
    const targetIdx = Math.max(0, Math.min(destInfo.hall.books.length, rawInsertIdx));
    destInfo.hall.books.splice(targetIdx, 0, book);
  } else {
    destInfo.hall.books.push(book);
  }
  if (openBookState.bookId === bookId) openBookState.hallId = destInfo.hall.id;
  commitChange();
  dispatchLibrarian({
    kind: 'book',
    source: 'pile',
    bookId: book.id,
    hallId: destInfo.hall.id,
    title: book.title,
    colorId: book.color || destInfo.hall.color,
    startScreenPt
  });
  showToast(`Little librarian is shelving "${book.title}" into ${destInfo.hall.title}!`);
}

function shelveCartBook(bookId, destHallId, keepOpen = false) {
  const idx = (state.cart?.books || []).findIndex(b => b.id === bookId);
  const destInfo = findHallInfo(destHallId);
  if (idx === -1 || !destInfo) return;
  const startScreenPt = captureTabletopItemScreenPoint('pile', bookId);
  const [book] = state.cart.books.splice(idx, 1);
  expandAncestorsOfHall(destHallId, true);
  destInfo.hall.books.push(book);
  if (openBookState.bookId === bookId) openBookState.hallId = destInfo.hall.id;
  commitChange();
  if (!keepOpen && selection.type === 'cart') renderInspector();
  dispatchLibrarian({
    kind: 'book',
    source: 'pile',
    bookId: book.id,
    hallId: destInfo.hall.id,
    title: book.title,
    colorId: book.color || destInfo.hall.color,
    startScreenPt
  });
  showToast(`Little librarian is shelving "${book.title}" into ${destInfo.hall.title}!`);
}

function fileCartPageIntoBook(cartPageId, destBookId, targetChapterId = null, openAfter = false) {
  const idx = (state.cart?.pages || []).findIndex(p => p.id === cartPageId);
  if (idx === -1) return;
  let targetBook = null;
  let targetHallId = null;
  let targetHallColor = null;
  const shelvedEntry = findBookEntry(destBookId);
  if (shelvedEntry) {
    targetBook = shelvedEntry.book;
    targetHallId = shelvedEntry.hall.id;
    targetHallColor = shelvedEntry.hall.color;
  } else {
    const cartBook = (state.cart?.books || []).find(b => b.id === destBookId);
    if (cartBook) {
      targetBook = cartBook;
      targetHallId = CART_HALL_ID;
      targetHallColor = cartBook.color;
    }
  }
  if (!targetBook) return;
  const startScreenPt = captureTabletopItemScreenPoint('pile', cartPageId);
  const [pg] = state.cart.pages.splice(idx, 1);
  const chId = (targetChapterId && targetBook.chapters.some(c => c.id === targetChapterId))
    ? targetChapterId
    : targetBook.chapters[0]?.id;
  const filed = {
    id: uid('p'),
    chapterId: chId,
    title: pg.title || 'Filed Note',
    stamps: Array.isArray(pg.stamps) ? [...pg.stamps] : [],
    properties: Array.isArray(pg.properties) ? deepClone(pg.properties) : [],
    body: pg.body || '',
    html: pg.html || plainTextToHtml(pg.body || '')
  };
  targetBook.pages.push(filed);
  if (expandedCartPageId === cartPageId) expandedCartPageId = null;
  if (targetHallId && targetHallId !== CART_HALL_ID) {
    expandAncestorsOfHall(targetHallId, true);
  }
  if (openBookState.hallId === LOOSE_PAPER_MODE_ID && openBookState.pageId === cartPageId) {
    openBookState = { hallId: targetHallId, bookId: targetBook.id, chapterId: chId, pageId: filed.id };
    openBookViewMode = 'single';
  } else if (openAfter || openBookState.bookId === targetBook.id) {
    openBookState = { hallId: targetHallId, bookId: targetBook.id, chapterId: chId, pageId: filed.id };
  }
  commitChange();
  if (targetHallId && targetHallId !== CART_HALL_ID) {
    dispatchLibrarian({
      kind: 'paper',
      source: 'pile',
      itemId: cartPageId,
      bookId: targetBook.id,
      hallId: targetHallId,
      title: filed.title,
      colorId: targetBook.color || targetHallColor,
      startScreenPt
    });
    showToast(`Little librarian is filing "${filed.title}" into "${targetBook.title}"!`);
  } else {
    showToast(`Sorted "${filed.title}" from pile into "${targetBook.title}"`);
  }
}

function promoteCartPageToBook(cartPageId) {
  const idx = (state.cart?.pages || []).findIndex(p => p.id === cartPageId);
  if (idx === -1) return null;
  const [pg] = state.cart.pages.splice(idx, 1);
  const pal = getPalette();
  const col = pal[(state.cart.books.length + 1) % pal.length].id;
  const chId = uid('ch'), pId = uid('p');
  const newBook = {
    id: uid('b'),
    title: pg.title || 'New Draft Book',
    color: col,
    pinned: false,
    summary: '',
    chapters: [{ id: chId, title: 'Chapter 1', color: col }],
    pages: [{ id: pId, chapterId: chId, title: pg.title || 'Page One', stamps: pg.stamps || [], properties: Array.isArray(pg.properties) ? deepClone(pg.properties) : [], body: pg.body || '', html: pg.html || plainTextToHtml(pg.body || '') }]
  };
  state.cart.books.push(newBook);
  if (expandedCartPageId === cartPageId) expandedCartPageId = null;
  commitChange();
  showToast(`Bound "${newBook.title}" into a book in the Sorting Pile`);
  return newBook;
}

function promoteCartPageIntoHall(cartPageId, destHallId, rawInsertIdx = null) {
  const idx = (state.cart?.pages || []).findIndex(p => p.id === cartPageId);
  const destInfo = findHallInfo(destHallId);
  if (idx === -1 || !destInfo) return null;
  const startScreenPt = captureTabletopItemScreenPoint('pile', cartPageId);
  const [pg] = state.cart.pages.splice(idx, 1);
  const pal = getPalette();
  const baseIdx = Math.max(0, pal.findIndex(s => s.id === destInfo.hall.color));
  const col = pal[(baseIdx + destInfo.hall.books.length) % pal.length].id;
  const chId = uid('ch'), pId = uid('p');
  const newBook = {
    id: uid('b'),
    title: pg.title || 'Bound Loose Paper',
    color: col,
    pinned: false,
    summary: '',
    chapters: [{ id: chId, title: 'Chapter 1', color: col }],
    pages: [{ id: pId, chapterId: chId, title: pg.title || 'Page One', stamps: pg.stamps || [], properties: Array.isArray(pg.properties) ? deepClone(pg.properties) : [], body: pg.body || '', html: pg.html || plainTextToHtml(pg.body || '') }]
  };
  expandAncestorsOfHall(destHallId, true);
  if (typeof rawInsertIdx === 'number' && Number.isFinite(rawInsertIdx)) {
    const targetIdx = Math.max(0, Math.min(destInfo.hall.books.length, rawInsertIdx));
    destInfo.hall.books.splice(targetIdx, 0, newBook);
  } else {
    destInfo.hall.books.push(newBook);
  }
  if (expandedCartPageId === cartPageId) expandedCartPageId = null;
  commitChange();
  dispatchLibrarian({
    kind: 'book',
    source: 'pile',
    bookId: newBook.id,
    hallId: destInfo.hall.id,
    title: newBook.title,
    colorId: newBook.color || destInfo.hall.color,
    startScreenPt
  });
  showToast(`Little librarian is shelving "${newBook.title}" into "${destInfo.hall.title}"!`);
  return newBook;
}

function moveBookPageToSortingPile(fromHallId, fromBookId, pageId) {
  const container = findOpenBookContainer(fromHallId, fromBookId);
  const book = container?.book;
  if (!book || container?.isLoosePaper) return;
  const idx = book.pages.findIndex(p => p.id === pageId);
  if (idx === -1) return;
  const ordered = getOrderedBookPages(book);
  const ordIdx = ordered.findIndex(p => p.id === pageId);
  const [pg] = book.pages.splice(idx, 1);
  const loosePaper = {
    id: uid('cp'),
    title: pg.title || 'Torn-Out Page',
    stamps: Array.isArray(pg.stamps) ? [...pg.stamps] : [],
    properties: Array.isArray(pg.properties) ? deepClone(pg.properties) : [],
    body: pg.body || '',
    html: pg.html || plainTextToHtml(pg.body || '')
  };
  state.cart.pages.push(loosePaper);
  tabletopCollapsed = false;
  if (openBookState.bookId === book.id && openBookState.pageId === pageId) {
    const remaining = getOrderedBookPages(book);
    const nextChoice = remaining[Math.min(ordIdx, remaining.length - 1)] || null;
    openBookState.pageId = nextChoice?.id || null;
    if (nextChoice) openBookState.chapterId = nextChoice.chapterId;
  }
  commitChange();
  showToast(`Moved "${loosePaper.title}" to the Sorting Pile as a loose paper`);
}

function moveBookPageToAnotherBook(fromHallId, fromBookId, pageId, targetBookId) {
  if (!targetBookId || fromBookId === targetBookId) return;
  const container = findOpenBookContainer(fromHallId, fromBookId);
  const srcBook = container?.book;
  if (!srcBook || container?.isLoosePaper) return;
  const destEntry = findBookEntry(targetBookId);
  const destBook = destEntry ? destEntry.book : (state.cart?.books || []).find(b => b.id === targetBookId);
  if (!destBook) return;
  const idx = srcBook.pages.findIndex(p => p.id === pageId);
  if (idx === -1) return;
  const ordered = getOrderedBookPages(srcBook);
  const ordIdx = ordered.findIndex(p => p.id === pageId);
  const [pg] = srcBook.pages.splice(idx, 1);
  pg.chapterId = destBook.chapters[0]?.id;
  destBook.pages.push(pg);
  if (openBookState.bookId === srcBook.id && openBookState.pageId === pageId) {
    const remaining = getOrderedBookPages(srcBook);
    const nextChoice = remaining[Math.min(ordIdx, remaining.length - 1)] || null;
    openBookState.pageId = nextChoice?.id || null;
    if (nextChoice) openBookState.chapterId = nextChoice.chapterId;
  }
  commitChange();
  showToast(`Moved page "${pg.title}" into "${destBook.title}"`);
}

function deleteCartPage(cartPageId) {
  state.cart.pages = (state.cart.pages || []).filter(p => p.id !== cartPageId);
  if (expandedCartPageId === cartPageId) expandedCartPageId = null;
  if (openBookState.hallId === LOOSE_PAPER_MODE_ID && openBookState.pageId === cartPageId) closeOpenBook();
  commitChange();
  showToast('Removed loose paper from the Sorting Pile');
}

function tieBookRibbon(fromBookId, toBookId, label, colorId) {
  if (!fromBookId || !toBookId || fromBookId === toBookId) return;
  state.ribbons.push({ id: uid('rib'), fromBookId, toBookId, label: (label || '').trim(), colorId: colorId || state.palette[0].id });
  if (!showRibbons) {
    showRibbons = true;
    document.getElementById('btn-toggle-ribbons').classList.add('active');
  }
  commitChange();
  showToast('Tied cross-reference ribbon between books');
}

function untieBookRibbon(ribbonId) {
  state.ribbons = state.ribbons.filter(r => r.id !== ribbonId);
  commitChange();
  showToast('Untied ribbon');
}

function createHall(parentHallId = null) {
  const pal = getPalette();
  if (!parentHallId) {
    const swatch = pal[state.halls.length % pal.length];
    const icon = HALL_ICONS[state.halls.length % HALL_ICONS.length];
    const newHall = { id: uid('h'), title: `Hall ${state.halls.length + 1}`, color: swatch.id, icon: icon.id, customAngle: null, collapsed: false, books: [], subHalls: [] };
    state.halls.push(newHall);
    commitChange();
    selectNode('hall', newHall.id, true);
    focusHallInput();
    showToast('Built a new Hall off the Rotunda');
    return;
  }
  const parentInfo = findHallInfo(parentHallId);
  if (!parentInfo) return;
  const parent = parentInfo.hall;
  parent.collapsed = false;
  const baseColorIdx = Math.max(0, pal.findIndex(s => s.id === parent.color));
  const subSwatch = pal[(baseColorIdx + parent.subHalls.length + 1) % pal.length];
  const subIcon = HALL_ICONS[(parent.subHalls.length + 2) % HALL_ICONS.length];
  const newSub = { id: uid('sh'), title: `Sub-Hall ${parent.subHalls.length + 1}`, color: subSwatch.id, icon: subIcon.id, customAngle: null, collapsed: false, books: [], subHalls: [] };
  parent.subHalls.push(newSub);
  commitChange();
  selectNode('hall', newSub.id, true);
  focusHallInput();
  showToast(`Branched angled sub-hall off "${parent.title}"`);
}

function focusHallInput() {
  setTimeout(() => {
    const inp = document.getElementById('edit-hall-title');
    if (inp) { inp.focus(); inp.select(); }
  }, 70);
}

function deleteHall(hallId) {
  const info = findHallInfo(hallId);
  if (!info) return;
  info.parentList.splice(info.index, 1);
  const parentHall = info.ancestors[info.ancestors.length - 1];
  if (parentHall) selectNode('hall', parentHall.id, true);
  else clearSelection();
  commitChange();
  showToast(info.ancestors.length > 0 ? 'Removed Sub-Hall' : 'Removed Hall');
}

function createBook(hallId) {
  const info = findHallInfo(hallId);
  if (!info) return;
  const hall = info.hall;
  hall.collapsed = false;
  const pal = getPalette();
  const prevBays = packBooksIntoBays(hall.books).length;
  const baseIdx = Math.max(0, pal.findIndex(s => s.id === hall.color));
  const bookColor = pal[(baseIdx + hall.books.length) % pal.length].id;
  const chId = uid('ch'), firstPageId = uid('p');
  const newBook = {
    id: uid('b'), title: `Book ${hall.books.length + 1}`, color: bookColor, pinned: false, summary: '',
    chapters: [{ id: chId, title: 'Chapter 1', color: bookColor }],
    pages: [{ id: firstPageId, chapterId: chId, title: 'Page One', stamps: [], body: '', html: '' }]
  };
  hall.books.push(newBook);
  const nextBays = packBooksIntoBays(hall.books).length;
  commitChange();
  openBookCenter(hall.id, newBook.id, firstPageId);
  setTimeout(() => {
    const inp = document.getElementById('open-book-title');
    if (inp) { inp.focus(); inp.select(); }
  }, 90);
  showToast(nextBays > prevBays
    ? `Expanded "${hall.title}" with Bookshelf #${nextBays}!`
    : `Shelved a new book in "${hall.title}"`
  );
}

function createScroll(hallId) {
  const info = findHallInfo(hallId);
  if (!info) return;
  const hall = info.hall;
  hall.collapsed = false;
  const pal = getPalette();
  const prevBays = packBooksIntoBays(hall.books).length;
  const baseIdx = Math.max(0, pal.findIndex(s => s.id === hall.color));
  const scrollColor = pal[(baseIdx + hall.books.length) % pal.length].id;
  const scrollNum = hall.books.filter(b => isScrollItem(b)).length + 1;
  const chId = uid('ch'), pageId = uid('p');
  const title = `Scroll ${scrollNum}`;
  const newScroll = {
    id: uid('b'),
    itemType: 'scroll',
    title,
    color: scrollColor,
    pinned: false,
    summary: '',
    chapters: [{ id: chId, title: 'Scroll', color: scrollColor }],
    pages: [{ id: pageId, chapterId: chId, title, stamps: [], properties: [], body: '', html: '' }]
  };
  hall.books.push(newScroll);
  const nextBays = packBooksIntoBays(hall.books).length;
  commitChange();
  openBookCenter(hall.id, newScroll.id, pageId, 'single');
  setTimeout(() => {
    const inp = document.getElementById('open-page-title');
    if (inp) { inp.focus(); inp.select(); }
  }, 90);
  showToast(nextBays > prevBays
    ? `Expanded "${hall.title}" with Bookshelf #${nextBays} & shelved a new Scroll!`
    : `Shelved a new parchment Scroll in "${hall.title}"`
  );
}

function convertScrollToBook(hallId, bookId) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  if (!book || !isScrollItem(book)) return;
  book.itemType = 'book';
  if (book.chapters[0] && book.chapters[0].title === 'Scroll') {
    book.chapters[0].title = 'Chapter 1';
  }
  openBookViewMode = 'spread';
  playCozySound('chime');
  commitChange();
  showToast(`Bound "${book.title}" into a multi-page Book!`);
}

function createCharacterBook(hallId, edition = '2024') {
  const info = findHallInfo(hallId);
  if (!info) return;
  const hall = info.hall;
  hall.collapsed = false;
  const pal = getPalette();
  const prevBays = packBooksIntoBays(hall.books).length;
  const baseIdx = Math.max(0, pal.findIndex(s => s.id === hall.color));
  const bookColor = pal[(baseIdx + hall.books.length) % pal.length].id;
  const charNum = hall.books.filter(b => isCharacterBook(b)).length + 1;
  const title = `Adventurer ${charNum}`;
  const chSheetId = uid('ch');
  const chNotesId = uid('ch');
  const pCoreId = uid('p');
  const pBioId = uid('p');
  const pSpellsId = uid('p');
  const pLogId = uid('p');
  const newBook = {
    id: uid('b'),
    itemType: 'book',
    title,
    color: bookColor,
    pinned: false,
    summary: 'D&D Player Character Sheet & Campaign Notes',
    dndChar: createDefaultDndCharData(title, edition),
    chapters: [
      { id: chSheetId, title: 'Character Sheet', color: bookColor },
      { id: chNotesId, title: 'Session Notes', color: pal[(baseIdx + 2) % pal.length].id }
    ],
    pages: [
      { id: pCoreId,   chapterId: chSheetId, title: 'Core & Combat',   sheetType: 'dnd-core',   stamps: [], properties: [], body: '', html: '' },
      { id: pBioId,    chapterId: chSheetId, title: 'Bio & Inventory', sheetType: 'dnd-bio',    stamps: [], properties: [], body: '', html: '' },
      { id: pSpellsId, chapterId: chSheetId, title: 'Spellcasting',    sheetType: 'dnd-spells', stamps: [], properties: [], body: '', html: '' },
      { id: pLogId,    chapterId: chNotesId, title: 'Campaign Log',    sheetType: null,         stamps: [], properties: [], body: 'Session 1 notes, quests, and NPCs met:', html: 'Session 1 notes, quests, and NPCs met:' }
    ]
  };
  hall.books.push(newBook);
  const nextBays = packBooksIntoBays(hall.books).length;
  commitChange();
  openBookCenter(hall.id, newBook.id, pCoreId, 'spread');
  showToast(nextBays > prevBays
    ? `Expanded "${hall.title}" with Bookshelf #${nextBays} & created D&D Character Book!`
    : `Created D&D Character Book in "${hall.title}"`
  );
}

function deleteBook(hallId, bookId) {
  if (hallId === CART_HALL_ID) {
    state.cart.books = (state.cart.books || []).filter(b => b.id !== bookId);
    if (openBookState.bookId === bookId) closeOpenBook();
    commitChange();
    showToast('Removed book from Sorting Pile');
    return;
  }
  const info = findHallInfo(hallId);
  if (!info) return;
  info.hall.books = info.hall.books.filter(b => b.id !== bookId);
  if (Array.isArray(state.studyStack)) {
    state.studyStack = state.studyStack.filter(id => id !== bookId);
  }
  if (openBookState.bookId === bookId) closeOpenBook();
  commitChange();
  showToast('Removed book from shelf');
}

function pushToRecycleBin(entry) {
  if (!Array.isArray(state.trash)) state.trash = [];
  state.trash.unshift({ id: uid('tr'), deletedAt: Date.now(), ...entry });
  if (state.trash.length > 60) state.trash = state.trash.slice(0, 60);
}

function recycleBook(hallId, bookId) {
  let removed = null;
  let originHallId = hallId;
  let originHallTitle = 'Sorting Pile';
  if (hallId === CART_HALL_ID) {
    const idx = (state.cart?.books || []).findIndex(b => b.id === bookId);
    if (idx === -1) return;
    [removed] = state.cart.books.splice(idx, 1);
  } else {
    const info = findHallInfo(hallId);
    if (!info) return;
    const idx = info.hall.books.findIndex(b => b.id === bookId);
    if (idx === -1) return;
    [removed] = info.hall.books.splice(idx, 1);
    originHallTitle = info.hall.title;
  }
  if (!removed) return;
  removed.pinned = false;
  if (Array.isArray(state.studyStack)) {
    state.studyStack = state.studyStack.filter(id => id !== bookId);
  }
  state.ribbons = (state.ribbons || []).filter(r => r.fromBookId !== bookId && r.toBookId !== bookId);
  if (openBookState.bookId === bookId) closeOpenBook();
  const kind = isScrollItem(removed) ? 'scroll' : 'book';
  pushToRecycleBin({
    kind,
    title: removed.title || (kind === 'scroll' ? 'Untitled Scroll' : 'Untitled Book'),
    color: removed.color,
    originHallId,
    originHallTitle,
    payload: deepClone(removed)
  });
  playCozySound('thump');
  commitChange();
  showToast(`Recycled ${kind} "${removed.title}" — click Recycle bin to restore`);
}

function recycleCartPage(cartPageId) {
  const idx = (state.cart?.pages || []).findIndex(p => p.id === cartPageId);
  if (idx === -1) return;
  const [pg] = state.cart.pages.splice(idx, 1);
  if (expandedCartPageId === cartPageId) expandedCartPageId = null;
  if (openBookState.hallId === LOOSE_PAPER_MODE_ID && openBookState.pageId === cartPageId) closeOpenBook();
  pushToRecycleBin({
    kind: 'loose-paper',
    title: pg.title || 'Loose Paper',
    color: null,
    originHallId: CART_HALL_ID,
    originHallTitle: 'Sorting Pile',
    payload: deepClone(pg)
  });
  playCozySound('page');
  commitChange();
  showToast(`Recycled loose paper "${pg.title || 'Untitled'}" — click Recycle bin to restore`);
}

function recycleBookPage(hallId, bookId, pageId) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  if (!book) return;
  if (isScrollItem(book)) {
    recycleBook(hallId, bookId);
    return;
  }
  const ordered = getOrderedBookPages(book);
  const ordIdx = ordered.findIndex(p => p.id === pageId);
  const idx = book.pages.findIndex(p => p.id === pageId);
  if (idx === -1) return;
  const [pg] = book.pages.splice(idx, 1);
  const remaining = getOrderedBookPages(book);
  const nextChoice = remaining[Math.min(ordIdx, remaining.length - 1)] || null;
  if (openBookState.bookId === bookId && openBookState.pageId === pageId) {
    openBookState.pageId = nextChoice?.id || null;
    if (nextChoice) openBookState.chapterId = nextChoice.chapterId;
  }
  pushToRecycleBin({
    kind: 'page',
    title: pg.title || 'Untitled Page',
    color: book.color,
    originHallId: hallId,
    originHallTitle: container.hall?.title || '',
    originBookId: book.id,
    originBookTitle: book.title,
    payload: deepClone(pg)
  });
  playCozySound('page');
  commitChange();
  showToast(`Recycled page "${pg.title || 'Untitled'}" — click Recycle bin to restore`);
}

function restoreTrashedItem(trashId) {
  const idx = (state.trash || []).findIndex(t => t.id === trashId);
  if (idx === -1) return;
  const [item] = state.trash.splice(idx, 1);
  const payload = deepClone(item.payload);
  if (item.kind === 'book' || item.kind === 'scroll') {
    if (item.originHallId === CART_HALL_ID) {
      state.cart.books.push(payload);
      showToast(`Restored "${item.title}" to Sorting Pile`);
    } else {
      const destHall = findHallInfo(item.originHallId)?.hall || state.halls[0];
      if (destHall) {
        destHall.books.push(payload);
        expandAncestorsOfHall(destHall.id, true);
        showToast(`Restored "${item.title}" to ${destHall.title}`);
      } else {
        state.cart.books.push(payload);
        showToast(`Restored "${item.title}" to Sorting Pile`);
      }
    }
  } else if (item.kind === 'loose-paper') {
    state.cart.pages.push(payload);
    showToast(`Restored loose paper "${item.title}" to Sorting Pile`);
  } else if (item.kind === 'page') {
    const bookEntry = item.originBookId ? findBookEntry(item.originBookId) : null;
    const cartBook = !bookEntry && item.originBookId ? (state.cart?.books || []).find(b => b.id === item.originBookId) : null;
    const targetBook = bookEntry?.book || cartBook;
    if (targetBook) {
      if (!targetBook.chapters.some(c => c.id === payload.chapterId)) {
        payload.chapterId = targetBook.chapters[0]?.id;
      }
      targetBook.pages.push(payload);
      showToast(`Restored page "${item.title}" to "${targetBook.title}"`);
    } else {
      state.cart.pages.push({ id: uid('cp'), title: payload.title, stamps: payload.stamps || [], properties: payload.properties || [], body: payload.body || '', html: payload.html || '' });
      showToast(`Restored page "${item.title}" to Sorting Pile`);
    }
  }
  playCozySound('chime');
  commitChange();
}

function permanentlyDeleteTrashedItem(trashId) {
  if (!Array.isArray(state.trash)) return;
  state.trash = state.trash.filter(t => t.id !== trashId);
  commitChange();
  showToast('Removed item from Recycling Basket');
}

function emptyRecycleBin() {
  const n = (state.trash || []).length;
  if (n === 0) return;
  state.trash = [];
  playCozySound('thump');
  commitChange();
  showToast(`Emptied ${n} item${n === 1 ? '' : 's'} from Recycling Basket`);
}

function reorderOrMoveBook(fromHallId, bookId, toHallId, rawInsertIdx) {
  const fromInfo = findHallInfo(fromHallId);
  const toInfo = findHallInfo(toHallId);
  if (!fromInfo || !toInfo) return;
  const fromIdx = fromInfo.hall.books.findIndex(b => b.id === bookId);
  if (fromIdx === -1) return;

  let targetIdx = Math.max(0, Math.min(toInfo.hall.books.length, rawInsertIdx));
  if (fromHallId === toHallId) {
    if (targetIdx === fromIdx || targetIdx === fromIdx + 1) { renderMap(); return; }
    if (fromIdx < targetIdx) targetIdx--;
  }

  const [book] = fromInfo.hall.books.splice(fromIdx, 1);
  toInfo.hall.books.splice(targetIdx, 0, book);
  if (openBookState.bookId === bookId) openBookState.hallId = toInfo.hall.id;
  const movedHall = fromHallId !== toHallId;
  if (movedHall) {
    expandAncestorsOfHall(fromHallId, true);
    expandAncestorsOfHall(toHallId, true);
  }
  commitChange();
  if (movedHall) {
    dispatchLibrarian({
      direction: 'transfer',
      kind: 'book',
      fromHallId,
      hallId: toInfo.hall.id,
      bookId: book.id,
      title: book.title,
      colorId: book.color || toInfo.hall.color
    });
    showToast(`Little librarian carried "${book.title}" to ${toInfo.hall.title}!`);
  } else {
    showToast(`Reordered "${book.title}"`);
  }
}

function moveBookToHall(fromHallId, bookId, toHallId) {
  if (fromHallId === toHallId) return;
  const toInfo = findHallInfo(toHallId);
  if (!toInfo) return;
  reorderOrMoveBook(fromHallId, bookId, toHallId, toInfo.hall.books.length);
}

function createChapter(hallId, bookId) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  if (!book) return;
  const pal = getPalette();
  const chColor = pal[(book.chapters.length + 1) % pal.length].id;
  const newCh = { id: uid('ch'), title: `Chapter ${book.chapters.length + 1}`, color: chColor };
  const newPage = { id: uid('p'), chapterId: newCh.id, title: 'Opening Notes', stamps: [], properties: [], body: '', html: '' };
  book.chapters.push(newCh);
  book.pages.push(newPage);
  openBookState.chapterId = newCh.id;
  openBookState.pageId = newPage.id;
  editingChapterId = newCh.id;
  commitChange();
  focusChapterRenameInput();
  showToast(`Added "${newCh.title}" tab`);
}

function deleteChapter(hallId, bookId, chapterId) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  if (!book || book.chapters.length <= 1) return;
  const idx = book.chapters.findIndex(c => c.id === chapterId);
  if (idx === -1) return;
  book.chapters.splice(idx, 1);
  const targetCh = book.chapters[Math.max(0, idx - 1)];
  book.pages.forEach(p => { if (p.chapterId === chapterId) p.chapterId = targetCh.id; });
  openBookState.chapterId = targetCh.id;
  if (!book.pages.some(p => p.id === openBookState.pageId)) {
    openBookState.pageId = book.pages.find(p => p.chapterId === targetCh.id)?.id || null;
  }
  commitChange();
  showToast(`Merged pages into "${targetCh.title}"`);
}

function createPage(hallId, bookId, chapterId = null) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  if (!book) return;
  const targetChId = chapterId || openBookState.chapterId || book.chapters[0]?.id;
  const newPage = { id: uid('p'), chapterId: targetChId, title: `Page ${book.pages.length + 1}`, stamps: [], properties: [], body: '', html: '' };
  book.pages.push(newPage);
  openBookState.chapterId = targetChId;
  openBookState.pageId = newPage.id;
  playCozySound('page');
  commitChange();
  setTimeout(() => {
    const inp = document.getElementById('open-page-title');
    if (inp) { inp.focus(); inp.select(); }
  }, 60);
  showToast('Added a fresh parchment page');
}

function savePageAsTemplate(page, book, hall, customName = '') {
  if (!page) return null;
  if (!Array.isArray(state.pageTemplates)) state.pageTemplates = [];
  const tplName = (customName || '').trim() || `${page.title || 'Page'} Template`;
  const isLoose = hall?.id === LOOSE_PAPER_MODE_ID;
  const tpl = {
    id: uid('ptpl'),
    name: tplName,
    sourceBookId: isLoose ? null : (book?.id || null),
    sourceBookTitle: isLoose ? 'Sorting Pile (Loose Paper)' : (book?.title || ''),
    sourceHallTitle: isLoose ? 'Sorting Pile' : (hall?.title || ''),
    stamps: Array.isArray(page.stamps) ? [...page.stamps] : [],
    properties: (Array.isArray(page.properties) ? page.properties : []).map(pr => ({
      id: uid('pr'),
      key: String(pr.key || ''),
      type: ['text', 'date', 'number', 'checkbox'].includes(pr.type) ? pr.type : 'text',
      value: pr.type === 'checkbox' ? Boolean(pr.value) : String(pr.value ?? '')
    })),
    body: page.body || '',
    html: page.html || plainTextToHtml(page.body || '')
  };
  state.pageTemplates.unshift(tpl);
  playCozySound('chime');
  commitChange();
  showToast(`Saved "${tplName}" to Card Index Templates!`);
  return tpl;
}

function createPageFromTemplate(hallId, bookId, chapterId, templateId) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  const tpl = (state.pageTemplates || []).find(t => t.id === templateId);
  if (!book || !tpl) return;
  const targetChId = chapterId || openBookState.chapterId || book.chapters[0]?.id;
  const newPage = {
    id: uid('p'),
    chapterId: targetChId,
    title: tpl.name.replace(/\s+template$/i, '').trim() || `Page ${book.pages.length + 1}`,
    stamps: Array.isArray(tpl.stamps) ? [...tpl.stamps] : [],
    properties: (Array.isArray(tpl.properties) ? tpl.properties : []).map(pr => ({
      id: uid('pr'),
      key: pr.key || '',
      type: pr.type || 'text',
      value: pr.type === 'checkbox' ? Boolean(pr.value) : (pr.value ?? '')
    })),
    body: tpl.body || '',
    html: tpl.html || plainTextToHtml(tpl.body || '')
  };
  book.pages.push(newPage);
  openBookState.chapterId = targetChId;
  openBookState.pageId = newPage.id;
  playCozySound('page');
  commitChange();
  setTimeout(() => {
    const inp = document.getElementById('open-page-title');
    if (inp) { inp.focus(); inp.select(); }
  }, 60);
  showToast(`Created page from "${tpl.name}"`);
}

function applyTemplateToPage(page, templateId) {
  const tpl = (state.pageTemplates || []).find(t => t.id === templateId);
  if (!page || !tpl) return;
  if (!Array.isArray(page.properties)) page.properties = [];
  const existingKeys = new Set(page.properties.map(p => (p.key || '').trim().toLowerCase()).filter(Boolean));
  (tpl.properties || []).forEach(pr => {
    const normKey = (pr.key || '').trim().toLowerCase();
    if (normKey && existingKeys.has(normKey)) return;
    page.properties.push({
      id: uid('pr'),
      key: pr.key || '',
      type: pr.type || 'text',
      value: pr.type === 'checkbox' ? Boolean(pr.value) : (pr.value ?? '')
    });
    if (normKey) existingKeys.add(normKey);
  });
  if (!Array.isArray(page.stamps)) page.stamps = [];
  (tpl.stamps || []).forEach(sid => {
    if (!page.stamps.includes(sid)) page.stamps.push(sid);
  });
  const tplHtml = tpl.html || plainTextToHtml(tpl.body || '');
  const tplPlain = (tpl.body || '').trim();
  if (tplPlain || (tplHtml && tplHtml.trim())) {
    const curPlain = (page.body || '').trim();
    if (!curPlain) {
      page.html = tplHtml;
      page.body = tpl.body || htmlToPlainText(tplHtml);
    } else {
      page.html = `${page.html || plainTextToHtml(page.body || '')}<br><br>${tplHtml}`;
      page.body = `${page.body || ''}\n\n${tpl.body || htmlToPlainText(tplHtml)}`;
    }
  }
  playCozySound('chime');
  commitChange();
  showToast(`Loaded "${tpl.name}" template!`);
}

function deletePage(hallId, bookId, pageId) {
  const container = findOpenBookContainer(hallId, bookId);
  const book = container?.book;
  if (!book) return;
  const ordered = getOrderedBookPages(book);
  const ordIdx = ordered.findIndex(p => p.id === pageId);
  const idx = book.pages.findIndex(p => p.id === pageId);
  if (idx === -1) return;
  book.pages.splice(idx, 1);
  const remaining = getOrderedBookPages(book);
  const nextChoice = remaining[Math.min(ordIdx, remaining.length - 1)] || null;
  openBookState.pageId = nextChoice?.id || null;
  if (nextChoice) openBookState.chapterId = nextChoice.chapterId;
  commitChange();
  showToast('Tore out page');
}

function renderBreadcrumbs() {
  document.getElementById('toolbar-title').textContent = state.title || 'My Library';
  const bc = document.getElementById('breadcrumbs');
  if (openBookState.bookId && openBookState.hallId === LOOSE_PAPER_MODE_ID) {
    const page = (state.cart?.pages || []).find(p => p.id === openBookState.pageId);
    bc.innerHTML = `<span class="opacity-60">&rsaquo;</span><button id="bc-go-cart" class="hover:underline bg-transparent border-0 p-0 cursor-pointer text-xs font-medium" style="color:var(--ui-ink);">Sorting Pile</button>`
      + `<span class="opacity-60">&rsaquo;</span><span class="font-semibold" style="color:var(--ui-accent);">${esc(truncate(page?.title || 'Loose Paper', 20))}</span>`;
    document.getElementById('bc-go-cart')?.addEventListener('click', () => { closeOpenBook(); selectNode('cart', null, false); });
    return;
  }
  if (openBookState.bookId && openBookState.hallId === CART_HALL_ID) {
    const book = (state.cart?.books || []).find(b => b.id === openBookState.bookId);
    const page = book?.pages.find(p => p.id === openBookState.pageId);
    bc.innerHTML = `<span class="opacity-60">&rsaquo;</span><button id="bc-go-cart" class="hover:underline bg-transparent border-0 p-0 cursor-pointer text-xs font-medium" style="color:var(--ui-ink);">Sorting Pile</button>`
      + (book ? `<span class="opacity-60">&rsaquo;</span><span class="font-semibold" style="color:var(--ui-ink);">${esc(truncate(book.title, 16))}</span>` : '')
      + (page ? `<span class="opacity-60">&rsaquo;</span><span class="font-semibold" style="color:var(--ui-accent);">${esc(truncate(page.title, 16))}</span>` : '');
    document.getElementById('bc-go-cart')?.addEventListener('click', () => { closeOpenBook(); selectNode('cart', null, false); });
    return;
  }
  const activeHallId = openBookState.bookId ? openBookState.hallId : (selection.type === 'hall' ? selection.hallId : null);
  if (!activeHallId) {
    const label = selection.type === 'study'
      ? 'Study Table'
      : (selection.type === 'cart' ? 'Sorting Pile' : (selection.type === 'trash' ? 'Recycling Basket' : 'Rotunda & Card Index'));
    bc.innerHTML = `<span class="opacity-60">&rsaquo;</span><span>${label}</span>`;
    return;
  }
  const info = findHallInfo(activeHallId);
  if (!info) return;
  const trail = [...info.ancestors, info.hall];
  let html = '';
  trail.forEach((h, i) => {
    const isCurrentHall = !openBookState.bookId && i === trail.length - 1;
    html += `<span class="opacity-60">&rsaquo;</span>`;
    html += isCurrentHall
      ? `<span class="font-semibold" style="color:var(--ui-accent);">${esc(truncate(h.title, 18))}</span>`
      : `<button data-bc-hall="${h.id}" class="hover:underline bg-transparent border-0 p-0 cursor-pointer text-xs font-medium" style="color:var(--ui-ink);">${esc(truncate(h.title, 18))}</button>`;
  });
  if (openBookState.bookId) {
    const book = info.hall.books.find(b => b.id === openBookState.bookId);
    const ch = book?.chapters.find(c => c.id === openBookState.chapterId);
    const page = book?.pages.find(p => p.id === openBookState.pageId);
    if (book) html += `<span class="opacity-60">&rsaquo;</span><span class="font-semibold" style="color:var(--ui-ink);">${esc(truncate(book.title, 16))}</span>`;
    if (ch) html += `<span class="opacity-60">&rsaquo;</span><span>${esc(truncate(ch.title, 14))}</span>`;
    if (page) html += `<span class="opacity-60">&rsaquo;</span><span class="font-semibold" style="color:var(--ui-accent);">${esc(truncate(page.title, 16))}</span>`;
  }
  bc.innerHTML = html;
  bc.querySelectorAll('[data-bc-hall]').forEach(btn => {
    btn.addEventListener('click', () => { closeOpenBook(); selectNode('hall', btn.dataset.bcHall, true); });
  });
}

// ---- CENTRAL ROTUNDA CARD INDEX + HALL INSPECTOR ----
function renderInspector() {
  if (!selection.type) return;

  // ---- LOWER-RIGHT WICKER RECYCLING BASKET INSPECTOR ----
  if (selection.type === 'trash') {
    const items = state.trash || [];
    inspBadge.textContent = `Recycle (${items.length})`;
    inspHeaderTitle.textContent = 'Wicker Recycling Basket';
    inspBody.innerHTML = `
      <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
        Drag any <strong>book</strong>, <strong>scroll</strong>, <strong>loose paper</strong>, or <strong>page</strong> onto the lower-right wicker basket to toss it here. Restore anything in one click or empty the basket permanently.
      </p>

      ${items.length > 0 ? `
        <div class="flex items-center justify-between gap-2 pt-1">
          <span class="text-xs font-semibold" style="color:var(--ui-muted);">Recycled Items (${items.length})</span>
          <button id="btn-empty-recycle-bin" type="button" class="text-[11px] font-bold px-2.5 py-1 rounded-xl cursor-pointer bg-transparent border border-red-400/50 text-red-600 hover:bg-red-500/10">Empty Basket</button>
        </div>
      ` : ''}

      <div class="space-y-2">
        ${items.map(it => {
          const sw = it.color ? getSwatch(it.color) : null;
          const kindLabel = it.kind === 'scroll'
            ? 'Scroll'
            : (it.kind === 'book' ? 'Book' : (it.kind === 'page' ? 'Page' : 'Loose Paper'));
          const originSub = it.kind === 'page' && it.originBookTitle
            ? `From ${it.originBookTitle}${it.originHallTitle ? ' (' + it.originHallTitle + ')' : ''}`
            : (it.originHallTitle ? `From ${it.originHallTitle}` : 'Recycled');
          return `
            <div class="rounded-2xl p-2.5 flex items-center justify-between gap-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="w-3 h-4 rounded-sm shrink-0" style="background:${sw ? sw.fill : '#e8d7b9'}; border:1.2px solid #3c2516;"></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="font-storybook font-bold text-xs truncate" style="color:var(--ui-ink);">${esc(it.title)}</span>
                    <span class="text-[9.5px] font-bold uppercase px-1.5 py-0.2 rounded shrink-0" style="background:rgba(130,96,62,0.14); color:var(--ui-muted);">${kindLabel}</span>
                  </div>
                  <div class="text-[10.5px] truncate" style="color:var(--ui-muted);">${esc(originSub)}</div>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button data-trash-restore="${it.id}" type="button" class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer">Restore</button>
                <button data-trash-purge="${it.id}" type="button" title="Delete forever" class="px-1.5 py-1 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
              </div>
            </div>
          `;
        }).join('') || `
          <div class="rounded-2xl p-5 text-center space-y-1" style="background:var(--ui-surface-alt); border:1.5px dashed var(--ui-border);">
            <div class="font-storybook font-bold text-xs" style="color:var(--ui-ink);">Recycling Basket is Empty</div>
            <div class="text-[11px]" style="color:var(--ui-muted);">Drag any book, scroll, or page onto the wicker basket in the lower right to recycle it.</div>
          </div>
        `}
      </div>
    `;

    document.getElementById('btn-empty-recycle-bin')?.addEventListener('click', emptyRecycleBin);
    inspBody.querySelectorAll('[data-trash-restore]').forEach(btn => {
      btn.addEventListener('click', () => restoreTrashedItem(btn.dataset.trashRestore));
    });
    inspBody.querySelectorAll('[data-trash-purge]').forEach(btn => {
      btn.addEventListener('click', () => permanentlyDeleteTrashedItem(btn.dataset.trashPurge));
    });
    return;
  }

  // ---- LOWER-RIGHT STUDY TABLE INSPECTOR (UP TO 11 BOOKS) ----
  if (selection.type === 'study') {
    const pinned = getPinnedBooks();
    const unpinned = getAllBooksFlat().filter(e => !e.book.pinned);
    const isFull = pinned.length >= MAX_STUDY_TABLE_BOOKS;
    inspBadge.textContent = `Study Table (${pinned.length}/${MAX_STUDY_TABLE_BOOKS})`;
    inspHeaderTitle.textContent = 'Lower-Right Reading Stack';
    inspBody.innerHTML = `
      <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
        Your lower-right <strong>Study Table Top</strong> holds up to <strong>${MAX_STUDY_TABLE_BOOKS} books</strong> at a time, stacked flat so every title stays completely legible. Drag any book onto the table or add one below!
      </p>

      ${unpinned.length > 0 ? `
        <div class="rounded-2xl p-3 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--ui-muted);">Stack Book on Table</span>
            <span class="text-[10.5px] font-mono font-bold" style="color:var(--ui-accent);">${pinned.length} / ${MAX_STUDY_TABLE_BOOKS} slots</span>
          </div>
          <div class="flex items-center gap-1.5">
            <select id="study-pin-sel" class="storybook-input flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs" ${isFull ? 'disabled' : ''}>
              ${unpinned.map(e => `<option value="${e.book.id}">${esc(truncate(e.hall.title, 14))} &rsaquo; ${esc(truncate(e.book.title, 22))}</option>`).join('')}
            </select>
            <button id="btn-study-pin-add" class="storybook-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer shrink-0" ${isFull ? 'disabled' : ''}>${isFull ? 'Full (11)' : '+ Stack'}</button>
          </div>
        </div>
      ` : ''}

      <div class="space-y-2 pt-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold" style="color:var(--ui-muted);">Stacked on Table (${pinned.length}/${MAX_STUDY_TABLE_BOOKS} · Top to Bottom)</span>
          ${pinned.length > 1 ? `<button id="btn-study-clear-all" class="text-[11px] font-semibold underline bg-transparent border-0 p-0 cursor-pointer" style="color:var(--ui-accent);">Clear Table</button>` : ''}
        </div>
        ${[...pinned].reverse().map((e, revIdx) => {
          const bsw = getSwatch(e.book.color || e.hall.color);
          const stackNum = pinned.length - revIdx;
          return `
            <div class="rounded-2xl p-2.5 flex items-center justify-between gap-2" style="background:var(--ui-surface-alt); border:1.5px solid ${bsw.fill};">
              <button data-study-open-hall="${e.hall.id}" data-study-open-book="${e.book.id}" class="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer flex items-center gap-2">
                <span class="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-extrabold shrink-0" style="background:${bsw.fill}; color:#fffaf2; border:1.4px solid #3c2516;">#${stackNum}</span>
                <span class="min-w-0 flex-1">
                  <span class="font-storybook font-bold text-xs block truncate" style="color:var(--ui-ink);">${esc(e.book.title)}</span>
                  <span class="text-[10.5px] block truncate" style="color:var(--ui-muted);">${esc(e.hall.title)} &middot; ${e.book.pages.length} pp</span>
                </span>
              </button>
              <button data-study-unpin="${e.book.id}" title="Remove from Study Table (keeps book on its shelf)" class="px-2 py-1 rounded-lg text-[11px] font-bold cursor-pointer storybook-btn shrink-0">Remove</button>
            </div>
          `;
        }).join('') || `<p class="text-xs italic" style="color:var(--ui-muted);">The Study Table is clear — stack up to 11 active books above or drag a book onto the lower-right table top!</p>`}
      </div>

      <!-- NAMED READING STACKS (SAVED STUDY TABLE PRESETS) -->
      <div class="pt-3 mt-2 border-t space-y-2.5" style="border-color:var(--ui-border);">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold uppercase tracking-wider" style="color:var(--ui-muted);">Saved Reading Stacks (${(state.studyPresets || []).length})</span>
        </div>
        <div class="flex items-center gap-1.5">
          <input id="study-preset-name" type="text" placeholder="Name current stack (e.g. Chapter 3)…"
                 class="storybook-input flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs" ${pinned.length === 0 ? 'disabled' : ''} />
          <button id="btn-save-study-preset" type="button" class="storybook-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer shrink-0" ${pinned.length === 0 ? 'disabled' : ''}>Save Stack</button>
        </div>
        <div class="space-y-1.5">
          ${(state.studyPresets || []).map(sp => {
            const validCount = (sp.bookIds || []).filter(id => Boolean(findBookEntry(id))).length;
            const sampleTitles = (sp.bookIds || []).map(id => findBookEntry(id)?.book?.title).filter(Boolean).slice(0, 3);
            return `
              <div class="rounded-2xl p-2.5 flex items-center justify-between gap-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
                <div class="min-w-0 flex-1">
                  <div class="font-storybook font-bold text-xs truncate" style="color:var(--ui-ink);">${esc(sp.name)}</div>
                  <div class="text-[10.5px] truncate" style="color:var(--ui-muted);">${validCount} book${validCount === 1 ? '' : 's'}${sampleTitles.length ? ` &middot; ${esc(sampleTitles.join(', '))}` : ''}</div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button data-load-preset="${sp.id}" type="button" title="Swap Study Table to this Reading Stack (librarians will return &amp; fetch books)" class="storybook-btn rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer">Load</button>
                  <button data-del-preset="${sp.id}" type="button" title="Delete saved stack" class="px-1.5 py-1 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
                </div>
              </div>
            `;
          }).join('') || `<p class="text-[11px] italic" style="color:var(--ui-muted);">Save your current table of books as a named Reading Stack to swap research sets in one click!</p>`}
        </div>
      </div>
    `;

    document.getElementById('btn-study-pin-add')?.addEventListener('click', () => {
      const bid = document.getElementById('study-pin-sel')?.value;
      if (bid) togglePinBook(bid, true);
    });
    document.getElementById('btn-study-clear-all')?.addEventListener('click', () => {
      putAllStudyTableBooksBack();
    });
    inspBody.querySelectorAll('[data-study-open-book]').forEach(btn => {
      btn.addEventListener('click', () => openBookCenter(btn.dataset.studyOpenHall, btn.dataset.studyOpenBook));
    });
    inspBody.querySelectorAll('[data-study-unpin]').forEach(btn => {
      btn.addEventListener('click', () => togglePinBook(btn.dataset.studyUnpin, false));
    });
    const doSavePreset = () => {
      const inp = document.getElementById('study-preset-name');
      saveStudyPreset(inp?.value || '');
    };
    document.getElementById('btn-save-study-preset')?.addEventListener('click', doSavePreset);
    document.getElementById('study-preset-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSavePreset(); }
    });
    inspBody.querySelectorAll('[data-load-preset]').forEach(btn => {
      btn.addEventListener('click', () => loadStudyPreset(btn.dataset.loadPreset));
    });
    inspBody.querySelectorAll('[data-del-preset]').forEach(btn => {
      btn.addEventListener('click', () => deleteStudyPreset(btn.dataset.delPreset));
    });
    return;
  }

  // ---- LOWER-RIGHT SORTING PILE (PAPERS & UNFILED BOOKS) INSPECTOR ----
  if (selection.type === 'cart') {
    const cartBooks = state.cart?.books || [];
    const cartPages = state.cart?.pages || [];
    const allBooks = getAllBooksFlat();
    const hallOpts = buildHallOptionsHTML('');

    inspBadge.textContent = `Sorting Pile (${cartBooks.length + cartPages.length})`;
    inspHeaderTitle.textContent = 'Pile of Papers & Books';
    inspBody.innerHTML = `
      <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
        Toss stray <strong>loose papers</strong> and <strong>unfiled books</strong> onto the lower-right pile. Click any loose paper to open it in the center <strong>Single-Page UI</strong>, or drag it onto any book or hall!
      </p>

      <div class="grid grid-cols-2 gap-2">
        <button id="btn-cart-new-page" class="storybook-btn-primary rounded-xl py-2 px-2.5 text-xs font-bold cursor-pointer">+ Toss Loose Paper</button>
        <button id="btn-cart-new-book" class="storybook-btn rounded-xl py-2 px-2.5 text-xs font-bold cursor-pointer">+ Toss Unfiled Book</button>
      </div>

      <!-- Unfiled Books in the Pile -->
      <div class="pt-2 border-t space-y-2" style="border-color:var(--ui-border);">
        <div class="text-xs font-semibold" style="color:var(--ui-muted);">Unfiled Books in Pile (${cartBooks.length})</div>
        ${cartBooks.map(b => {
          const bsw = getSwatch(b.color);
          return `
            <div class="rounded-2xl p-2.5 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
              <div class="flex items-center justify-between gap-2">
                <button data-cart-open-book="${b.id}" class="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer flex items-center gap-2">
                  <span class="w-3.5 h-5 rounded-sm shrink-0" style="background:${bsw.fill}; border:1.4px solid #3c2516;"></span>
                  <span class="min-w-0 flex-1">
                    <span class="font-storybook font-bold text-xs block truncate" style="color:var(--ui-ink);">${esc(b.title)}</span>
                    <span class="text-[10.5px] block truncate" style="color:var(--ui-muted);">${b.pages.length} page${b.pages.length === 1 ? '' : 's'} &middot; Click to open or drag from pile</span>
                  </span>
                </button>
                <button data-cart-del-book="${b.id}" title="Remove book from pile" class="px-1.5 py-0.5 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
              </div>
              ${state.halls.length > 0 ? `
                <div class="flex items-center gap-1.5">
                  <select data-cart-shelve-sel="${b.id}" class="storybook-input flex-1 min-w-0 rounded-lg px-2 py-1 text-[11px]">
                    ${hallOpts}
                  </select>
                  <button data-cart-shelve-btn="${b.id}" class="storybook-btn rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0">Sort to Hall</button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('') || `<p class="text-[11px] italic" style="color:var(--ui-muted);">No unfiled books in the pile.</p>`}
      </div>

      <!-- Loose Papers in the Pile -->
      <div class="pt-2 border-t space-y-2" style="border-color:var(--ui-border);">
        <div class="text-xs font-semibold" style="color:var(--ui-muted);">Loose Papers in Pile (${cartPages.length})</div>
        ${cartPages.map(p => {
          const isExp = expandedCartPageId === p.id;
          const preview = truncate((p.body || '').replace(/\s+/g, ' ').trim(), 52);
          return `
            <div class="rounded-2xl p-2.5 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
              <div class="flex items-center justify-between gap-1.5">
                <button data-cart-open-single="${p.id}" class="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer">
                  <span class="font-storybook font-bold text-xs block truncate" style="color:var(--ui-ink);">${esc(p.title || 'Untitled Paper')}</span>
                  ${!isExp && preview ? `<span class="text-[10.5px] block truncate" style="color:var(--ui-muted);">${esc(preview)}</span>` : ''}
                </button>
                <button data-cart-open-single="${p.id}" title="Open in center Single-Page UI" class="storybook-btn-primary rounded-lg px-2 py-0.5 text-[10.5px] font-bold cursor-pointer shrink-0">Open Page</button>
                <button data-cart-toggle-page="${p.id}" class="storybook-btn rounded-lg px-2 py-0.5 text-[10.5px] font-semibold cursor-pointer shrink-0">${isExp ? 'Fold' : 'Quick'}</button>
                <button data-cart-del-page="${p.id}" title="Remove loose paper from pile" class="px-1.5 py-0.5 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
              </div>
              ${isExp ? `
                <div class="space-y-1.5 pt-1 border-t" style="border-color:var(--ui-border);">
                  <input data-cart-page-title="${p.id}" type="text" value="${esc(p.title)}" placeholder="Loose paper title…" class="storybook-input w-full rounded-lg px-2.5 py-1.5 text-xs font-storybook font-bold" />
                  <textarea data-cart-page-body="${p.id}" rows="3" placeholder="Jot your quick idea on this paper…" class="storybook-input w-full rounded-lg px-2.5 py-1.5 text-xs resize-y">${esc(p.body || '')}</textarea>
                </div>
              ` : ''}
              <div class="flex items-center gap-1.5 flex-wrap">
                ${allBooks.length > 0 ? `
                  <select data-cart-file-sel="${p.id}" class="storybook-input flex-1 min-w-0 rounded-lg px-2 py-1 text-[11px]">
                    ${allBooks.map(e => `<option value="${e.book.id}">${esc(truncate(e.hall.title, 12))} &rsaquo; ${esc(truncate(e.book.title, 18))}</option>`).join('')}
                  </select>
                  <button data-cart-file-btn="${p.id}" class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer shrink-0">Sort into Book</button>
                ` : ''}
                <button data-cart-promote="${p.id}" title="Bind this loose paper into an unfiled book in the pile" class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer shrink-0">&rarr; Book</button>
              </div>
            </div>
          `;
        }).join('') || `<p class="text-[11px] italic" style="color:var(--ui-muted);">No loose papers in the pile.</p>`}
      </div>
    `;

    document.getElementById('btn-cart-new-page').addEventListener('click', () => createCartPage(false));
    document.getElementById('btn-cart-new-book').addEventListener('click', createCartBook);
    inspBody.querySelectorAll('[data-cart-open-book]').forEach(btn => {
      btn.addEventListener('click', () => openBookCenter(CART_HALL_ID, btn.dataset.cartOpenBook));
    });
    inspBody.querySelectorAll('[data-cart-open-single]').forEach(btn => {
      btn.addEventListener('click', () => openLoosePaperCenter(btn.dataset.cartOpenSingle));
    });
    inspBody.querySelectorAll('[data-cart-del-book]').forEach(btn => {
      btn.addEventListener('click', () => deleteBook(CART_HALL_ID, btn.dataset.cartDelBook));
    });
    inspBody.querySelectorAll('[data-cart-shelve-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const bid = btn.dataset.cartShelveBtn;
        const destHallId = inspBody.querySelector(`[data-cart-shelve-sel="${bid}"]`)?.value;
        if (destHallId) shelveCartBook(bid, destHallId, false);
      });
    });
    inspBody.querySelectorAll('[data-cart-toggle-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.cartTogglePage;
        expandedCartPageId = expandedCartPageId === pid ? null : pid;
        renderInspector();
      });
    });
    inspBody.querySelectorAll('[data-cart-del-page]').forEach(btn => {
      btn.addEventListener('click', () => deleteCartPage(btn.dataset.cartDelPage));
    });
    inspBody.querySelectorAll('[data-cart-page-title]').forEach(inp => {
      const pg = state.cart.pages.find(x => x.id === inp.dataset.cartPageTitle);
      inp.addEventListener('input', () => { if (pg) { pg.title = inp.value; persistState(); renderCornerTabletop(); } });
      inp.addEventListener('change', () => pushHistory());
    });
    inspBody.querySelectorAll('[data-cart-page-body]').forEach(ta => {
      const pg = state.cart.pages.find(x => x.id === ta.dataset.cartPageBody);
      ta.addEventListener('input', () => {
        if (pg) { pg.body = ta.value; pg.html = plainTextToHtml(ta.value); persistState(); }
      });
      ta.addEventListener('change', () => pushHistory());
    });
    inspBody.querySelectorAll('[data-cart-file-btn]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.cartFileBtn;
        const destBookId = inspBody.querySelector(`[data-cart-file-sel="${pid}"]`)?.value;
        if (destBookId) fileCartPageIntoBook(pid, destBookId);
      });
    });
    inspBody.querySelectorAll('[data-cart-promote]').forEach(btn => {
      btn.addEventListener('click', () => promoteCartPageToBook(btn.dataset.cartPromote));
    });
    return;
  }

  if (selection.type === 'hub') {
    const pal = getPalette();
    const stamps = getStamps();
    const allBooks = getAllBooksFlat();
    const pinnedCount = getPinnedBooks().length;
    const cartCount = (state.cart?.books?.length || 0) + (state.cart?.pages?.length || 0);
    let anyCustomAngles = false;
    forEachHall(h => { if (h.customAngle != null) anyCustomAngles = true; });

    inspBadge.textContent = 'Card Index';
    inspHeaderTitle.textContent = state.title;

    const pageTpls = state.pageTemplates || [];
    const tabsHtml = `
      <div class="grid grid-cols-5 gap-0.5 border-b pb-0" style="border-color:var(--ui-border);">
        ${[
          ['rotunda',   'Rotunda'],
          ['colors',    `Colors (${pal.length})`],
          ['stamps',    `Stamps (${stamps.length})`],
          ['ribbons',   `Ribbons (${state.ribbons.length})`],
          ['templates', `Templates (${pageTpls.length})`]
        ].map(([id, lbl]) => `
          <button data-cat-tab="${id}" class="catalog-tab ${cardIndexTab === id ? 'active-cat-tab' : ''} py-1.5 px-0.5 text-[10px] font-semibold cursor-pointer truncate">${lbl}</button>
        `).join('')}
      </div>
    `;

    let tabBody = '';

    if (cardIndexTab === 'rotunda') {
      tabBody = `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-semibold mb-1" style="color:var(--ui-muted);">Central Idea Title</label>
            <input id="edit-hub-title" type="text" value="${esc(state.title)}" class="storybook-input w-full rounded-xl px-3 py-2 text-sm font-storybook font-bold" />
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1" style="color:var(--ui-muted);">Subtitle / Theme</label>
            <input id="edit-hub-sub" type="text" value="${esc(state.subtitle)}" placeholder="e.g. Fantasy Novel, Product Plan…" class="storybook-input w-full rounded-xl px-3 py-2 text-xs" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1">
          <button id="rotunda-go-study" class="storybook-btn rounded-2xl p-2.5 text-left cursor-pointer flex flex-col gap-0.5">
            <span class="font-storybook font-bold text-xs">&#9733; Study Table</span>
            <span class="text-[10.5px]" style="color:var(--ui-muted);">${pinnedCount}/${MAX_STUDY_TABLE_BOOKS} books stacked</span>
          </button>
          <button id="rotunda-go-cart" class="storybook-btn rounded-2xl p-2.5 text-left cursor-pointer flex flex-col gap-0.5">
            <span class="font-storybook font-bold text-xs">Sorting Pile</span>
            <span class="text-[10.5px]" style="color:var(--ui-muted);">${cartCount} unfiled item${cartCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        <div class="pt-3 border-t space-y-2" style="border-color:var(--ui-border);">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold" style="color:var(--ui-muted);">Main Halls (${state.halls.length})</span>
            <div class="flex items-center gap-1.5">
              ${anyCustomAngles ? `<button id="insp-reset-all-angles" class="storybook-btn rounded-xl px-2 py-1 text-[11px] font-semibold cursor-pointer">Reset Angles</button>` : ''}
              <button id="insp-add-hall" class="storybook-btn-primary rounded-xl px-2.5 py-1 text-xs font-semibold cursor-pointer">+ New Hall</button>
            </div>
          </div>
          <div class="space-y-1.5">
            ${state.halls.map(h => {
              const sw = getSwatch(h.color);
              return `
                <button data-jump-hall="${h.id}" class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs storybook-btn cursor-pointer text-left">
                  <span class="flex items-center gap-2 font-semibold truncate">
                    <span class="w-3 h-3 rounded-full shrink-0" style="background:${sw.fill}; border:1px solid #3c2516;"></span>
                    ${esc(h.title)}${h.collapsed ? ' <span class="opacity-60 font-normal">(folded)</span>' : ''}
                  </span>
                  <span class="text-[11px] shrink-0" style="color:var(--ui-muted);">${countTotalBooks(h)} books${h.subHalls.length ? ` · ${h.subHalls.length} wing${h.subHalls.length > 1 ? 's' : ''}` : ''}</span>
                </button>
              `;
            }).join('') || `<p class="text-xs italic" style="color:var(--ui-muted);">No halls yet — add your first main idea!</p>`}
          </div>
        </div>
      `;
    } else if (cardIndexTab === 'colors') {
      tabBody = `
        <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
          Customize the gouache colors used across all <strong>Halls</strong>, <strong>Books</strong>, <strong>Chapters</strong>, and <strong>Ribbons</strong>. Edits update the library live!
        </p>

        <div class="space-y-2">
          ${pal.map(sw => `
            <div class="flex items-center gap-2 p-2 rounded-2xl" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
              <input data-pal-hex="${sw.id}" type="color" value="${sw.hex}" title="Pick swatch color" class="swatch-picker w-7 h-7 shrink-0" />
              <input data-pal-name="${sw.id}" type="text" value="${esc(sw.name)}" class="storybook-input flex-1 min-w-0 rounded-lg px-2 py-1 text-xs font-semibold" />
              ${pal.length > 1 ? `
                <button data-pal-del="${sw.id}" title="Remove color" class="px-2 py-1 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
              ` : ''}
            </div>
          `).join('')}
        </div>

        <!-- Add new color card -->
        <div class="pt-3 border-t space-y-2" style="border-color:var(--ui-border);">
          <label class="block text-xs font-semibold" style="color:var(--ui-muted);">Add New Library Color</label>
          <div class="flex items-center gap-2">
            <input id="new-pal-hex" type="color" value="#c45d74" class="swatch-picker w-8 h-8 shrink-0" />
            <input id="new-pal-name" type="text" placeholder="e.g. Crimson Rose…" class="storybook-input flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs" />
            <button id="btn-add-pal" class="storybook-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer">+ Add</button>
          </div>
        </div>
      `;
    } else if (cardIndexTab === 'stamps') {
      tabBody = `
        <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
          Manage <strong>Cross-Reference Stamps</strong> for pages. Click <strong>&#10022;</strong> to light up every book carrying that stamp on the 2D library map!
        </p>

        <div class="space-y-2">
          ${stamps.map(st => {
            const matches = findPagesWithStamp(st.id);
            const isExp = expandedIndexStampId === st.id;
            const isLens = activeStampLensId === st.id;
            return `
              <div class="rounded-2xl p-2 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid ${isLens ? st.color : 'var(--ui-border)'};">
                <div class="flex items-center gap-1.5">
                  <input data-st-color="${st.id}" type="color" value="${st.color}" title="Stamp ink color" class="swatch-picker w-6 h-6 shrink-0" />
                  <input data-st-name="${st.id}" type="text" value="${esc(st.label)}" class="storybook-input flex-1 min-w-0 rounded-lg px-2 py-1 text-xs font-storybook font-bold" />
                  <button data-st-lens="${st.id}" title="${isLens ? 'Turn off map glow' : 'Light up all books with this stamp on the library map'}"
                          class="rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer shrink-0 transition-transform hover:scale-105"
                          style="background:${isLens ? st.color : 'var(--ui-surface)'}; color:${isLens ? '#fffaf2' : st.color}; border:1.5px solid ${st.color};">&#10022;</button>
                  <button data-st-expand="${st.id}" title="View pages with this stamp" class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-bold cursor-pointer shrink-0">${matches.length} pp</button>
                  <button data-st-del="${st.id}" title="Delete stamp" class="px-1.5 py-1 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
                </div>
                ${isExp ? `
                  <div class="pl-2 pt-1 border-t space-y-1" style="border-color:var(--ui-border);">
                    ${matches.map((m, idx) => `
                      <button data-st-jump-hall="${m.hall.id}" data-st-jump-book="${m.book.id}" data-st-jump-page="${m.page.id}"
                              class="w-full text-left px-2.5 py-1.5 rounded-xl text-xs storybook-btn cursor-pointer flex flex-col">
                        <span class="font-storybook font-bold truncate">${esc(m.page.title)}</span>
                        <span class="text-[10.5px] truncate" style="color:var(--ui-muted);">${esc(m.hall.title)} &rsaquo; ${esc(m.book.title)}</span>
                      </button>
                    `).join('') || `<p class="text-[11px] italic py-1" style="color:var(--ui-muted);">No pages stamped with "${esc(st.label)}" yet.</p>`}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('') || `<p class="text-xs italic" style="color:var(--ui-muted);">No stamps yet — mint your first rubber stamp below!</p>`}
        </div>

        <!-- Mint new stamp -->
        <div class="pt-3 border-t space-y-2" style="border-color:var(--ui-border);">
          <label class="block text-xs font-semibold" style="color:var(--ui-muted);">Mint New Stamp</label>
          <div class="flex items-center gap-2">
            <input id="new-st-color" type="color" value="#9b482e" class="swatch-picker w-8 h-8 shrink-0" />
            <input id="new-st-name" type="text" placeholder="e.g. Character, Draft, Clue…" class="storybook-input flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs" />
            <button id="btn-add-st" class="storybook-btn-primary rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer">+ Mint</button>
          </div>
        </div>
      `;
    } else if (cardIndexTab === 'ribbons') {
      tabBody = `
        <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
          Tie silk <strong>Cross-Reference Ribbons</strong> connecting related books across halls and sub-halls.
        </p>

        <!-- Tie new ribbon form -->
        ${allBooks.length >= 2 ? `
          <div class="rounded-2xl p-3 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
            <div class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--ui-muted);">Tie New Book Ribbon</div>
            <select id="idx-rib-from" class="storybook-input w-full rounded-xl px-2.5 py-1.5 text-xs">
              ${allBooks.map(e => `<option value="${e.book.id}">${esc(truncate(e.hall.title, 15))} &rsaquo; ${esc(truncate(e.book.title, 22))}</option>`).join('')}
            </select>
            <select id="idx-rib-to" class="storybook-input w-full rounded-xl px-2.5 py-1.5 text-xs">
              ${allBooks.map((e, i) => `<option value="${e.book.id}" ${i === 1 ? 'selected' : ''}>${esc(truncate(e.hall.title, 15))} &rsaquo; ${esc(truncate(e.book.title, 22))}</option>`).join('')}
            </select>
            <div class="flex items-center gap-1.5">
              <input id="idx-rib-label" type="text" placeholder="Label (optional)…" class="storybook-input flex-1 min-w-0 rounded-xl px-2.5 py-1.5 text-xs" />
              <select id="idx-rib-color" class="storybook-input rounded-xl px-2 py-1.5 text-xs">
                ${pal.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <button id="btn-idx-tie-rib" class="storybook-btn-primary w-full rounded-xl py-1.5 text-xs font-bold cursor-pointer">+ Tie Silk Ribbon</button>
          </div>
        ` : `<p class="text-xs italic" style="color:var(--ui-muted);">Add at least 2 books to tie a cross-reference ribbon between them.</p>`}

        <!-- Existing Ribbons List -->
        <div class="space-y-2 pt-1">
          ${state.ribbons.map(rib => {
            const b1 = findBookEntry(rib.fromBookId);
            const b2 = findBookEntry(rib.toBookId);
            if (!b1 || !b2) return '';
            const rsw = getSwatch(rib.colorId);
            return `
              <div class="rounded-2xl p-2.5 space-y-1.5" style="background:var(--ui-surface-alt); border:1.5px solid ${rsw.fill};">
                <div class="flex items-center justify-between gap-2">
                  <span class="flex items-center gap-1.5 text-xs font-bold truncate">
                    <span class="w-3 h-3 rounded-full shrink-0" style="background:${rsw.fill}; border:1px solid #3c2516;"></span>
                    ${esc(rib.label || 'Cross-Reference')}
                  </span>
                  <button data-idx-untie="${rib.id}" title="Untie ribbon" class="px-1.5 py-0.5 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <button data-idx-open-b="${b1.book.id}" class="storybook-btn rounded-lg px-2 py-0.5 font-semibold cursor-pointer truncate max-w-[140px]">${esc(b1.book.title)}</button>
                  <span style="color:var(--ui-muted);">&harr;</span>
                  <button data-idx-open-b="${b2.book.id}" class="storybook-btn rounded-lg px-2 py-0.5 font-semibold cursor-pointer truncate max-w-[140px]">${esc(b2.book.title)}</button>
                </div>
              </div>
            `;
          }).join('') || `<p class="text-xs italic" style="color:var(--ui-muted);">No ribbons tied yet.</p>`}
        </div>
      `;
    } else if (cardIndexTab === 'templates') {
      tabBody = `
        <p class="text-xs leading-relaxed" style="color:var(--ui-muted);">
          Saved <strong>Page Templates</strong> with Obsidian-style properties. Save any page as a template from inside a book, or use <strong>+ Template</strong> in any book's Table of Contents.
        </p>

        <div class="space-y-2.5">
          ${pageTpls.map(tpl => {
            const originEntry = tpl.sourceBookId ? findBookEntry(tpl.sourceBookId) : null;
            const originLabel = originEntry
              ? `${originEntry.book.title} (${originEntry.hall.title})`
              : (tpl.sourceBookTitle ? `${tpl.sourceBookTitle}${tpl.sourceHallTitle ? ' · ' + tpl.sourceHallTitle : ''}` : 'Custom Template');
            const tplStamps = (tpl.stamps || []).map(getStamp).filter(Boolean);
            const tplProps = Array.isArray(tpl.properties) ? tpl.properties : [];
            return `
              <div class="rounded-2xl p-2.5 space-y-2" style="background:var(--ui-surface-alt); border:1.5px solid var(--ui-border);">
                <div class="flex items-center gap-1.5">
                  <input data-tpl-name="${tpl.id}" type="text" value="${esc(tpl.name)}" placeholder="Template name…"
                         class="storybook-input flex-1 min-w-0 rounded-lg px-2 py-1 text-xs font-storybook font-bold" />
                  <button data-tpl-del="${tpl.id}" type="button" title="Delete template"
                          class="px-1.5 py-1 rounded-lg text-xs font-bold cursor-pointer bg-transparent border border-red-400/40 text-red-600 hover:bg-red-500/10">&times;</button>
                </div>

                <div class="flex items-center justify-between gap-1.5 flex-wrap text-[10.5px]">
                  ${originEntry ? `
                    <button data-tpl-origin-book="${originEntry.book.id}" type="button" title="Jump to origin book '${esc(originEntry.book.title)}'"
                            class="storybook-btn rounded-lg px-2 py-0.5 text-[10px] font-semibold cursor-pointer truncate max-w-full">
                      &#128214; From: ${esc(truncate(originLabel, 30))}
                    </button>
                  ` : `
                    <span class="px-2 py-0.5 rounded-lg text-[10px] font-medium truncate max-w-full" style="background:rgba(130,96,62,0.1); color:var(--ui-muted);">
                      &#128214; From: ${esc(truncate(originLabel, 30))}
                    </span>
                  `}
                  <button data-tpl-add-prop="${tpl.id}" type="button" class="storybook-btn rounded-lg px-2 py-0.5 text-[10px] font-bold cursor-pointer shrink-0">+ Property</button>
                </div>

                ${tplStamps.length > 0 ? `
                  <div class="flex items-center gap-1 flex-wrap">
                    ${tplStamps.map(st => `<span class="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded" style="background:${st.color}18; color:${st.color}; border:1px solid ${st.color};">${esc(st.label)}</span>`).join('')}
                  </div>
                ` : ''}

                <div class="space-y-1 pt-1 border-t" style="border-color:var(--ui-border);">
                  ${tplProps.map((pr, pIdx) => {
                    const pType = pr.type || 'text';
                    return `
                      <div class="flex items-center gap-1">
                        <input data-tpl-prop-key="${tpl.id}::${pIdx}" type="text" value="${esc(pr.key || '')}" placeholder="Field…"
                               class="storybook-input w-[36%] min-w-[68px] rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold" />
                        <select data-tpl-prop-type="${tpl.id}::${pIdx}" class="storybook-input rounded-md px-1 py-0.5 text-[10px] cursor-pointer">
                          <option value="text" ${pType === 'text' ? 'selected' : ''}>Text</option>
                          <option value="date" ${pType === 'date' ? 'selected' : ''}>Date</option>
                          <option value="number" ${pType === 'number' ? 'selected' : ''}>Num</option>
                          <option value="checkbox" ${pType === 'checkbox' ? 'selected' : ''}>Check</option>
                        </select>
                        ${pType === 'checkbox'
                          ? `<input data-tpl-prop-val="${tpl.id}::${pIdx}" type="checkbox" ${pr.value ? 'checked' : ''} class="mx-1 accent-amber-700 cursor-pointer" />`
                          : `<input data-tpl-prop-val="${tpl.id}::${pIdx}" type="${pType === 'date' ? 'date' : (pType === 'number' ? 'number' : 'text')}" value="${esc(pr.value ?? '')}" placeholder="Default…"
                                    class="storybook-input flex-1 min-w-0 rounded-md px-1.5 py-0.5 text-[10.5px]" />`
                        }
                        <button data-tpl-prop-del="${tpl.id}::${pIdx}" type="button" title="Remove property" class="px-1 text-xs font-bold cursor-pointer bg-transparent border-0 text-red-600/75 hover:text-red-600">&times;</button>
                      </div>
                    `;
                  }).join('') || `<div class="text-[10.5px] italic" style="color:var(--ui-muted);">No properties yet — click "+ Property" above.</div>`}
                </div>
              </div>
            `;
          }).join('') || `<p class="text-xs italic" style="color:var(--ui-muted);">No saved templates yet — open any page and click "Save as Template", or create a blank one below!</p>`}
        </div>

        <div class="pt-2 border-t" style="border-color:var(--ui-border);">
          <button id="btn-idx-new-tpl" type="button" class="storybook-btn-primary w-full rounded-xl py-1.5 text-xs font-bold cursor-pointer">+ New Blank Template</button>
        </div>
      `;
    }

    inspBody.innerHTML = `${tabsHtml}<div class="space-y-3 pt-1">${tabBody}</div>`;

    // Wire Card Index tabs
    inspBody.querySelectorAll('[data-cat-tab]').forEach(btn => {
      btn.addEventListener('click', () => { cardIndexTab = btn.dataset.catTab; renderInspector(); });
    });

    if (cardIndexTab === 'rotunda') {
      document.getElementById('edit-hub-title').addEventListener('input', (e) => {
        state.title = e.target.value; inspHeaderTitle.textContent = state.title;
        persistState(); renderMap(); renderBreadcrumbs();
      });
      document.getElementById('edit-hub-title').addEventListener('change', () => pushHistory());
      document.getElementById('edit-hub-sub').addEventListener('input', (e) => {
        state.subtitle = e.target.value; persistState(); renderMap();
      });
      document.getElementById('edit-hub-sub').addEventListener('change', () => pushHistory());
      document.getElementById('rotunda-go-study')?.addEventListener('click', () => selectNode('study', null, true));
      document.getElementById('rotunda-go-cart')?.addEventListener('click', () => selectNode('cart', null, true));
      document.getElementById('insp-add-hall').addEventListener('click', () => createHall(null));
      document.getElementById('insp-reset-all-angles')?.addEventListener('click', () => {
        forEachHall(h => { h.customAngle = null; });
        commitChange(); showToast('Reset all hall angles to balanced layout');
      });
      inspBody.querySelectorAll('[data-jump-hall]').forEach(btn => {
        btn.addEventListener('click', () => selectNode('hall', btn.dataset.jumpHall, true));
      });
    } else if (cardIndexTab === 'colors') {
      inspBody.querySelectorAll('[data-pal-hex]').forEach(inp => {
        const entry = state.palette.find(c => c.id === inp.dataset.palHex);
        inp.addEventListener('input', () => { if (entry) { entry.hex = inp.value; persistState(); renderMap(); } });
        inp.addEventListener('change', () => commitChange());
      });
      inspBody.querySelectorAll('[data-pal-name]').forEach(inp => {
        const entry = state.palette.find(c => c.id === inp.dataset.palName);
        inp.addEventListener('input', () => { if (entry) { entry.name = inp.value; persistState(); } });
        inp.addEventListener('change', () => pushHistory());
      });
      inspBody.querySelectorAll('[data-pal-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (state.palette.length <= 1) return;
          state.palette = state.palette.filter(c => c.id !== btn.dataset.palDel);
          commitChange();
          showToast('Removed color swatch');
        });
      });
      const addColor = () => {
        const hex = document.getElementById('new-pal-hex').value || '#c45d74';
        const name = document.getElementById('new-pal-name').value.trim() || `Color ${state.palette.length + 1}`;
        state.palette.push({ id: uid('col'), name, hex });
        commitChange();
        showToast(`Added "${name}" to library palette`);
      };
      document.getElementById('btn-add-pal').addEventListener('click', addColor);
      document.getElementById('new-pal-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } });
    } else if (cardIndexTab === 'stamps') {
      inspBody.querySelectorAll('[data-st-color]').forEach(inp => {
        const st = state.stamps.find(s => s.id === inp.dataset.stColor);
        inp.addEventListener('input', () => { if (st) { st.color = inp.value; persistState(); if (activeStampLensId === st.id) renderMap(); } });
        inp.addEventListener('change', () => commitChange());
      });
      inspBody.querySelectorAll('[data-st-name]').forEach(inp => {
        const st = state.stamps.find(s => s.id === inp.dataset.stName);
        inp.addEventListener('input', () => { if (st) { st.label = inp.value; persistState(); } });
        inp.addEventListener('change', () => pushHistory());
      });
      inspBody.querySelectorAll('[data-st-lens]').forEach(btn => {
        btn.addEventListener('click', () => {
          clearSearch(false);
          setStampLens(btn.dataset.stLens);
        });
      });
      inspBody.querySelectorAll('[data-st-expand]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.stExpand;
          expandedIndexStampId = expandedIndexStampId === sid ? null : sid;
          renderInspector();
        });
      });
      inspBody.querySelectorAll('[data-st-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.stamps = state.stamps.filter(s => s.id !== btn.dataset.stDel);
          commitChange();
          showToast('Deleted stamp from Card Index');
        });
      });
      inspBody.querySelectorAll('[data-st-jump-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          openBookCenter(btn.dataset.stJumpHall, btn.dataset.stJumpBook, btn.dataset.stJumpPage);
        });
      });
      const addStamp = () => {
        const color = document.getElementById('new-st-color').value || '#9b482e';
        const label = document.getElementById('new-st-name').value.trim();
        if (!label) return;
        state.stamps.push({ id: uid('st'), label, color });
        commitChange();
        showToast(`Minted "${label}" stamp`);
      };
      document.getElementById('btn-add-st').addEventListener('click', addStamp);
      document.getElementById('new-st-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStamp(); } });
    } else if (cardIndexTab === 'ribbons') {
      document.getElementById('btn-idx-tie-rib')?.addEventListener('click', () => {
        const fromId = document.getElementById('idx-rib-from').value;
        const toId = document.getElementById('idx-rib-to').value;
        const label = document.getElementById('idx-rib-label').value.trim();
        const colorId = document.getElementById('idx-rib-color').value;
        if (fromId === toId) { showToast('Pick two different books to tie a ribbon!'); return; }
        tieBookRibbon(fromId, toId, label, colorId);
      });
      inspBody.querySelectorAll('[data-idx-untie]').forEach(btn => {
        btn.addEventListener('click', () => untieBookRibbon(btn.dataset.idxUntie));
      });
      inspBody.querySelectorAll('[data-idx-open-b]').forEach(btn => {
        btn.addEventListener('click', () => {
          const entry = findBookEntry(btn.dataset.idxOpenB);
          if (entry) openBookCenter(entry.hall.id, entry.book.id);
        });
      });
    } else if (cardIndexTab === 'templates') {
      inspBody.querySelectorAll('[data-tpl-name]').forEach(inp => {
        const tpl = (state.pageTemplates || []).find(t => t.id === inp.dataset.tplName);
        inp.addEventListener('input', () => { if (tpl) { tpl.name = inp.value; persistState(); } });
        inp.addEventListener('change', () => pushHistory());
      });
      inspBody.querySelectorAll('[data-tpl-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.pageTemplates = (state.pageTemplates || []).filter(t => t.id !== btn.dataset.tplDel);
          commitChange();
          showToast('Deleted Page Template from Card Index');
        });
      });
      inspBody.querySelectorAll('[data-tpl-origin-book]').forEach(btn => {
        btn.addEventListener('click', () => {
          const entry = findBookEntry(btn.dataset.tplOriginBook);
          if (entry) {
            if (expandAncestorsOfHall(entry.hall.id, true)) renderMap();
            openBookCenter(entry.hall.id, entry.book.id);
          }
        });
      });
      inspBody.querySelectorAll('[data-tpl-add-prop]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = (state.pageTemplates || []).find(t => t.id === btn.dataset.tplAddProp);
          if (!tpl) return;
          if (!Array.isArray(tpl.properties)) tpl.properties = [];
          tpl.properties.push({ id: uid('pr'), key: '', type: 'text', value: '' });
          commitChange();
        });
      });
      inspBody.querySelectorAll('[data-tpl-prop-key]').forEach(inp => {
        const [tid, idxStr] = inp.dataset.tplPropKey.split('::');
        const tpl = (state.pageTemplates || []).find(t => t.id === tid);
        const idx = Number(idxStr);
        inp.addEventListener('input', () => { if (tpl?.properties?.[idx]) { tpl.properties[idx].key = inp.value; persistState(); } });
        inp.addEventListener('change', () => pushHistory());
      });
      inspBody.querySelectorAll('[data-tpl-prop-type]').forEach(sel => {
        const [tid, idxStr] = sel.dataset.tplPropType.split('::');
        const tpl = (state.pageTemplates || []).find(t => t.id === tid);
        const idx = Number(idxStr);
        sel.addEventListener('change', () => {
          const pr = tpl?.properties?.[idx];
          if (!pr) return;
          pr.type = sel.value;
          if (pr.type === 'checkbox') pr.value = Boolean(pr.value && pr.value !== 'false');
          else if (typeof pr.value === 'boolean') pr.value = pr.value ? 'Yes' : '';
          commitChange();
        });
      });
      inspBody.querySelectorAll('[data-tpl-prop-val]').forEach(inp => {
        const [tid, idxStr] = inp.dataset.tplPropVal.split('::');
        const tpl = (state.pageTemplates || []).find(t => t.id === tid);
        const idx = Number(idxStr);
        if (inp.type === 'checkbox') {
          inp.addEventListener('change', () => { if (tpl?.properties?.[idx]) { tpl.properties[idx].value = inp.checked; commitChange(); } });
        } else {
          inp.addEventListener('input', () => { if (tpl?.properties?.[idx]) { tpl.properties[idx].value = inp.value; persistState(); } });
          inp.addEventListener('change', () => pushHistory());
        }
      });
      inspBody.querySelectorAll('[data-tpl-prop-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const [tid, idxStr] = btn.dataset.tplPropDel.split('::');
          const tpl = (state.pageTemplates || []).find(t => t.id === tid);
          if (tpl?.properties) {
            tpl.properties.splice(Number(idxStr), 1);
            commitChange();
          }
        });
      });
      document.getElementById('btn-idx-new-tpl')?.addEventListener('click', () => {
        if (!Array.isArray(state.pageTemplates)) state.pageTemplates = [];
        state.pageTemplates.unshift({
          id: uid('ptpl'),
          name: `New Template ${state.pageTemplates.length + 1}`,
          sourceBookId: null,
          sourceBookTitle: '',
          sourceHallTitle: '',
          stamps: [],
          properties: [
            { id: uid('pr'), key: 'Name', type: 'text', value: '' },
            { id: uid('pr'), key: 'Date', type: 'date', value: '' }
          ],
          body: '',
          html: ''
        });
        commitChange();
        showToast('Created new blank Page Template');
      });
    }
    return;
  }

  // ---- HALL / SUB-HALL INSPECTOR ----
  const info = findHallInfo(selection.hallId);
  if (!info) return;
  const { hall, ancestors } = info;
  const isSub = ancestors.length > 0;
  const parentHall = isSub ? ancestors[ancestors.length - 1] : null;
  const pal = getPalette();

  inspBadge.textContent = isSub ? 'Sub-Hall Wing' : 'Main Hall';
  inspHeaderTitle.textContent = hall.title;
  inspBody.innerHTML = `
    <div class="flex items-center justify-between gap-1.5 flex-wrap">
      ${parentHall ? `<button id="insp-back-parent" class="storybook-btn rounded-xl px-2.5 py-1 text-xs font-semibold cursor-pointer">&larr; ${esc(truncate(parentHall.title, 15))}</button>` : '<span></span>'}
      <div class="flex items-center gap-1.5">
        <button id="insp-toggle-fold" class="storybook-btn ${hall.collapsed ? 'active' : ''} rounded-xl px-2.5 py-1 text-[11px] font-semibold cursor-pointer">${hall.collapsed ? '&#9656; Expand Wing' : '&#9662; Fold Wing'}</button>
        ${hall.customAngle != null ? `<button id="insp-reset-angle" class="storybook-btn rounded-xl px-2.5 py-1 text-[11px] font-semibold cursor-pointer">Reset Angle</button>` : ''}
      </div>
    </div>
    <div class="space-y-3">
      <div>
        <label class="block text-xs font-semibold mb-1" style="color:var(--ui-muted);">${isSub ? 'Sub-Hall Name' : 'Hall Name (Main Idea)'}</label>
        <input id="edit-hall-title" type="text" value="${esc(hall.title)}" class="storybook-input w-full rounded-xl px-3 py-2 text-sm font-storybook font-bold" />
      </div>
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label class="text-xs font-semibold" style="color:var(--ui-muted);">Carpet &amp; Wing Color</label>
          <button id="hall-edit-palette" class="text-[11px] font-semibold underline bg-transparent border-0 p-0 cursor-pointer" style="color:var(--ui-accent);">Edit Colors</button>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${pal.map(sw => `
            <button data-swatch="${sw.id}" title="${esc(sw.name)}" class="w-7 h-7 rounded-full cursor-pointer transition-transform hover:scale-110"
              style="background:${sw.fill}; border: ${hall.color === sw.id ? '3px solid var(--ui-ink)' : '2px solid rgba(60,37,22,0.35)'};"></button>
          `).join('')}
        </div>
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1.5" style="color:var(--ui-muted);">Hall Emblem</label>
        <div class="grid grid-cols-4 gap-1.5">
          ${HALL_ICONS.map(ic => `
            <button data-icon="${ic.id}" class="storybook-btn ${hall.icon === ic.id ? 'active' : ''} rounded-xl py-1.5 px-2 flex flex-col items-center gap-0.5 text-[10px] cursor-pointer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${ic.path}"/></svg>
              <span>${ic.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="pt-3 border-t space-y-2" style="border-color:var(--ui-border);">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold" style="color:var(--ui-muted);">Angled Sub-Halls (${hall.subHalls.length})</span>
        <button id="insp-add-subhall" class="storybook-btn rounded-xl px-2.5 py-1 text-xs font-semibold cursor-pointer">+ Add Sub-Hall</button>
      </div>
      <div class="space-y-1.5">
        ${hall.subHalls.map(sub => {
          const ssw = getSwatch(sub.color);
          return `
            <button data-jump-sub="${sub.id}" class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs storybook-btn cursor-pointer text-left">
              <span class="flex items-center gap-2 font-semibold truncate">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:${ssw.fill}; border:1px solid #3c2516;"></span>
                ${esc(sub.title)}
              </span>
              <span class="text-[11px] shrink-0" style="color:var(--ui-muted);">${countTotalBooks(sub)} books &rarr;</span>
            </button>
          `;
        }).join('') || `<p class="text-[11px] italic" style="color:var(--ui-muted);">Drag the brass swivel knob at the end of any hall to adjust its angle.</p>`}
      </div>
    </div>

    <div class="pt-3 border-t space-y-2" style="border-color:var(--ui-border);">
      <div class="flex items-center justify-between gap-1.5 flex-wrap">
        <span class="text-xs font-semibold" style="color:var(--ui-muted);">Shelf Items (${hall.books.length})</span>
        <div class="flex items-center gap-1 flex-wrap">
          <button id="insp-add-dndchar" class="storybook-btn rounded-xl px-2 py-1 text-[11px] font-bold cursor-pointer" title="Create a 3-page D&amp;D 5e / 2024 Character Sheet Book with Session Notes">+ D&amp;D</button>
          <button id="insp-add-scroll" class="storybook-btn rounded-xl px-2 py-1 text-[11px] font-semibold cursor-pointer" title="Shelve a single-page parchment Scroll">+ Scroll</button>
          <button id="insp-add-book" class="storybook-btn-primary rounded-xl px-2.5 py-1 text-[11px] font-semibold cursor-pointer">+ Book</button>
        </div>
      </div>
      <div class="space-y-1.5">
        ${hall.books.map((b, idx) => {
          const bsw = getSwatch(b.color || hall.color);
          const isSc = isScrollItem(b);
          const isDnd = isCharacterBook(b);
          return `
            <button data-open-book="${b.id}" data-book-idx="${idx}" draggable="true" class="insp-book-row w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs storybook-btn cursor-pointer text-left">
              <span class="flex items-center gap-2 font-semibold truncate">
                <span class="drag-grip shrink-0">${GRIP_SVG}</span>
                ${isSc
                  ? `<span class="w-3 h-4 rounded-full shrink-0 flex items-center justify-center" style="background:#f8ecd2; border:1.4px solid ${bsw.fill};"><span class="w-full h-1" style="background:${bsw.fill};"></span></span>`
                  : `<span class="w-3 h-4 rounded-sm shrink-0" style="background:${bsw.fill}; border:1px solid #3c2516;"></span>`
                }
                <span class="truncate">${esc(b.title)}${b.pinned ? ' &#9733;' : ''}</span>
              </span>
              <span class="text-[11px] shrink-0" style="color:var(--ui-muted);">${isSc ? 'Scroll' : (isDnd ? `D&amp;D ${b.dndChar.edition === '5e' ? '5e' : '24'}` : `${b.pages.length} pp`)} &rarr;</span>
            </button>
          `;
        }).join('') || `<p class="text-xs italic" style="color:var(--ui-muted);">Shelf is empty — add a book, scroll, or D&amp;D sheet to begin!</p>`}
      </div>
    </div>

    <div class="pt-3 border-t flex justify-end" style="border-color:var(--ui-border);">
      <button id="insp-del-hall" class="text-xs font-semibold px-3 py-1.5 rounded-xl cursor-pointer bg-transparent border border-red-400/50 text-red-600 hover:bg-red-500/10">Delete ${isSub ? 'Sub-Hall' : 'Hall'}</button>
    </div>
  `;

  document.getElementById('insp-back-parent')?.addEventListener('click', () => selectNode('hall', parentHall.id, true));
  document.getElementById('insp-toggle-fold').addEventListener('click', () => toggleCollapseHall(hall.id));
  document.getElementById('insp-reset-angle')?.addEventListener('click', () => {
    hall.customAngle = null; commitChange(); showToast(`Reset "${hall.title}" angle`);
  });
  document.getElementById('hall-edit-palette').addEventListener('click', () => openCardIndex('colors', false));
  document.getElementById('edit-hall-title').addEventListener('input', (e) => {
    hall.title = e.target.value; inspHeaderTitle.textContent = hall.title;
    persistState(); renderMap(); renderBreadcrumbs();
  });
  document.getElementById('edit-hall-title').addEventListener('change', () => pushHistory());
  inspBody.querySelectorAll('[data-swatch]').forEach(btn => {
    btn.addEventListener('click', () => { hall.color = btn.dataset.swatch; commitChange(); });
  });
  inspBody.querySelectorAll('[data-icon]').forEach(btn => {
    btn.addEventListener('click', () => { hall.icon = btn.dataset.icon; commitChange(); });
  });
  document.getElementById('insp-add-subhall').addEventListener('click', () => createHall(hall.id));
  inspBody.querySelectorAll('[data-jump-sub]').forEach(btn => {
    btn.addEventListener('click', () => selectNode('hall', btn.dataset.jumpSub, true));
  });
  document.getElementById('insp-add-dndchar').addEventListener('click', () => createCharacterBook(hall.id, '2024'));
  document.getElementById('insp-add-scroll').addEventListener('click', () => createScroll(hall.id));
  document.getElementById('insp-add-book').addEventListener('click', () => createBook(hall.id));

  inspBody.querySelectorAll('.insp-book-row').forEach(row => {
    const bookId = row.dataset.openBook, idx = Number(row.dataset.bookIdx);
    row.addEventListener('click', () => openBookCenter(hall.id, bookId));
    row.addEventListener('dragstart', (e) => {
      listDrag = { type: 'insp-book', id: bookId, hallId: hall.id };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', bookId);
      row.classList.add('dragging-item');
    });
    row.addEventListener('dragend', () => { listDrag = null; clearDropMarkers(inspBody); });
    row.addEventListener('dragover', (e) => {
      if (!listDrag || listDrag.type !== 'insp-book' || listDrag.id === bookId) return;
      e.preventDefault(); clearDropMarkers(inspBody);
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
    });
    row.addEventListener('drop', (e) => {
      if (!listDrag || listDrag.type !== 'insp-book' || listDrag.id === bookId) return;
      e.preventDefault();
      const after = e.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      const draggedId = listDrag.id; listDrag = null; clearDropMarkers(inspBody);
      reorderOrMoveBook(hall.id, draggedId, hall.id, after ? idx + 1 : idx);
    });
  });

  document.getElementById('insp-del-hall').addEventListener('click', () => deleteHall(hall.id));
}

function renderAll() {
  renderMap();
  renderBreadcrumbs();
  renderInspector();
  if (openBookState.bookId) renderOpenBook(false);
  updateGlobalTasksMenuUI();
}
