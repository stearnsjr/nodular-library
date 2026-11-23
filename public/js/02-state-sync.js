// ============================================================
// 2. STATE NORMALIZATION, TREE HELPERS & TEMPLATES
// ============================================================
function normalizeLibraryState(lib) {
  if (!Array.isArray(lib.palette) || lib.palette.length === 0) {
    lib.palette = deepClone(DEFAULT_PALETTE_SPEC);
  } else {
    lib.palette = lib.palette.map(c => ({
      id: c.id || uid('col'),
      name: c.name || 'Custom',
      hex: /^#[0-9a-f]{6}$/i.test(c.hex || c.fill || '') ? (c.hex || c.fill) : '#6c9a72'
    }));
  }
  if (!Array.isArray(lib.stamps)) {
    lib.stamps = deepClone(DEFAULT_STAMPS);
  }
  if (!Array.isArray(lib.ribbons)) {
    lib.ribbons = [];
  }
  if (!lib.cart || typeof lib.cart !== 'object') {
    lib.cart = { books: [], pages: [] };
  }
  if (!Array.isArray(lib.cart.books)) lib.cart.books = [];
  if (!Array.isArray(lib.cart.pages)) lib.cart.pages = [];

  const validPalette = new Set(lib.palette.map(c => c.id));
  const fallbackColor = lib.palette[0].id;
  const validStamps = new Set(lib.stamps.map(s => s.id));
  const allBookIds = new Set();
  const bookObjMap = new Map();

  function normProperties(rawProps) {
    if (!Array.isArray(rawProps)) return [];
    const validTypes = new Set(['text', 'date', 'number', 'checkbox']);
    return rawProps
      .filter(pr => pr && typeof pr === 'object')
      .map(pr => ({
        id: pr.id || uid('prop'),
        key: typeof pr.key === 'string' ? pr.key : '',
        type: validTypes.has(pr.type) ? pr.type : 'text',
        value: pr.type === 'checkbox' ? Boolean(pr.value) : (pr.value != null ? String(pr.value) : '')
      }));
  }

  function normPage(p, defCh = null) {
    if (!p.id) p.id = uid('p');
    if (defCh !== null && (!p.chapterId || defCh === true)) { /* handled by caller */ }
    if (typeof p.title !== 'string') p.title = 'Untitled Page';
    if (typeof p.html !== 'string') p.html = plainTextToHtml(p.body || '');
    if (typeof p.body !== 'string') p.body = '';
    p.properties = normProperties(p.properties);
    if (!Array.isArray(p.stamps)) {
      const mapped = p.tag && LEGACY_TAG_MAP[p.tag];
      p.stamps = (mapped && validStamps.has(mapped)) ? [mapped] : [];
    } else {
      p.stamps = p.stamps.filter(sid => validStamps.has(sid));
    }
    if (!['dnd-core', 'dnd-bio', 'dnd-spells'].includes(p.sheetType)) p.sheetType = null;
    return p;
  }

  function normBook(book, hallColor, registerRibbonTarget = true) {
    if (!book.id) book.id = uid('b');
    book.itemType = book.itemType === 'scroll' ? 'scroll' : 'book';
    if (book.dndChar && typeof book.dndChar === 'object') {
      book.dndChar = normalizeDndChar(book.dndChar);
    }
    if (book.marketLedger && typeof book.marketLedger === 'object') {
      book.marketLedger = normalizeMarketLedger(book.marketLedger);
    }
    if (book.recipeBook && typeof book.recipeBook === 'object') {
      book.recipeBook = normalizeRecipeBook(book.recipeBook);
    }
    if (!validPalette.has(book.color)) book.color = hallColor;
    book.pinned = Boolean(book.pinned);
    if (!Array.isArray(book.pages)) book.pages = [];
    if (!Array.isArray(book.chapters) || book.chapters.length === 0) {
      book.chapters = [{ id: uid('ch'), title: book.itemType === 'scroll' ? 'Scroll' : 'Chapter 1', color: book.color }];
    }
    if (book.itemType === 'scroll' && book.pages.length === 0) {
      book.pages.push({ id: uid('p'), chapterId: book.chapters[0].id, title: book.title || 'Untitled Scroll', stamps: [], properties: [], body: '', html: '' });
    }
    book.chapters.forEach(c => {
      if (!c.id) c.id = uid('ch');
      if (!validPalette.has(c.color)) c.color = book.color;
    });
    if (book.projectBoard && typeof book.projectBoard === 'object') {
      book.projectBoard = normalizeProjectBoard(book.projectBoard, book.chapters);
    }
    const validChIds = new Set(book.chapters.map(c => c.id));
    const defCh = book.chapters[0].id;
    book.pages.forEach(p => {
      if (!p.chapterId || !validChIds.has(p.chapterId)) p.chapterId = defCh;
      normPage(p);
    });
    if (registerRibbonTarget) {
      allBookIds.add(book.id);
      bookObjMap.set(book.id, book);
    }
  }

  function normHalls(halls) {
    if (!Array.isArray(halls)) return [];
    halls.forEach(h => {
      if (!validPalette.has(h.color)) h.color = fallbackColor;
      if (!Array.isArray(h.books)) h.books = [];
      if (!Array.isArray(h.shelves)) h.shelves = [];
      h.shelves = h.shelves
        .filter(s => s && typeof s === 'object')
        .map((s, idx) => ({
          id: s.id || uid('sh'),
          name: typeof s.name === 'string' ? s.name : `Shelf ${idx + 1}`
        }));
      const validShelfIds = new Set(h.shelves.map(s => s.id));
      const firstShelfId = h.shelves[0]?.id || null;
      h.books.forEach(b => {
        normBook(b, h.color, true);
        if (h.shelves.length > 0) {
          if (!b.shelfId || !validShelfIds.has(b.shelfId)) b.shelfId = firstShelfId;
        }
      });
      if (!Array.isArray(h.subHalls)) h.subHalls = [];
      if (typeof h.customAngle !== 'number' || !Number.isFinite(h.customAngle)) h.customAngle = null;
      h.collapsed = Boolean(h.collapsed);
      normHalls(h.subHalls);
    });
    return halls;
  }

  lib.halls = normHalls(lib.halls || []);

  // Seed starter Study Table stack & Sorting Pile on existing default Grand Idea Library if upgrading
  if (lib.title === 'Grand Idea Library' && !lib._cornerTableSeeded) {
    lib._cornerTableSeeded = true;
    const anyPinned = Array.from(bookObjMap.values()).some(b => b.pinned);
    if (!anyPinned) {
      ['b_prolog', 'b_palette', 'b_loop'].forEach(id => {
        if (bookObjMap.has(id)) bookObjMap.get(id).pinned = true;
      });
    }
    if (lib.cart.books.length === 0 && lib.cart.pages.length === 0) {
      lib.cart.books.push({
        id: 'b_cart1', title: 'Weather & Seasons Draft', color: 'seaglass', pinned: false,
        summary: 'Unsorted weather ideas waiting for a home hall.',
        chapters: [{ id: 'ch_ct1', title: 'Rough Ideas', color: 'seaglass' }],
        pages: [{ id: 'p_ct1', chapterId: 'ch_ct1', title: 'Autumn Rain Mood', stamps: ['st_visual'], body: 'Warm lantern reflections on wet cobblestones when rain starts falling.', html: 'Warm lantern reflections on wet cobblestones when rain starts falling.' }]
      });
      lib.cart.pages.push(
        { id: 'cp_1', title: 'Market Festival Note', stamps: ['st_todo'], body: 'Paper kite contest above the Greenhouse Market — file into World & Art or Side Quests!', html: 'Paper kite contest above the Greenhouse Market — file into World &amp; Art or Side Quests!' },
        { id: 'cp_2', title: 'Harbor Bell Riddle', stamps: ['st_mystery'], body: 'Three chimes at low tide reveal the sunken boathouse stairs.', html: 'Three chimes at low tide reveal the sunken boathouse stairs.' }
      );
    }
  }

  // Seed starter tasks into Grand Idea Library if none exist yet so the upper-right Tasks menu is immediately populated
  if (lib.title === 'Grand Idea Library' && !lib._starterTasksSeeded) {
    lib._starterTasksSeeded = true;
    let hasAnyTask = false;
    bookObjMap.forEach(b => {
      b.pages.forEach(p => { if ((p.html || '').includes('page-todo-item')) hasAnyTask = true; });
    });
    if (!hasAnyTask) {
      const bProlog = bookObjMap.get('b_prolog');
      const p1 = bProlog?.pages?.[0];
      if (p1) {
        p1.html = (p1.html || plainTextToHtml(p1.body || ''))
          + `<div class="page-todo-item" data-checked="true"><span class="page-todo-box" contenteditable="false" role="checkbox" aria-checked="true"></span><span class="page-todo-text">Sketch the folded paper crane letter emblem</span></div>`
          + `<div class="page-todo-item" data-checked="false"><span class="page-todo-box" contenteditable="false" role="checkbox" aria-checked="false"></span><span class="page-todo-text">Write the bookshop keeper's opening dialogue</span></div>`;
      }
      const bPalette = bookObjMap.get('b_palette');
      const p8 = bPalette?.pages?.[0];
      if (p8) {
        p8.html = (p8.html || plainTextToHtml(p8.body || ''))
          + `<div class="page-todo-item" data-checked="false"><span class="page-todo-box" contenteditable="false" role="checkbox" aria-checked="false"></span><span class="page-todo-text">Test warm candlelight shadows on harbor rooftops</span></div>`;
      }
      const bLoop = bookObjMap.get('b_loop');
      const p13 = bLoop?.pages?.[0];
      if (p13) {
        p13.html = (p13.html || plainTextToHtml(p13.body || ''))
          + `<div class="page-todo-item" data-checked="false"><span class="page-todo-box" contenteditable="false" role="checkbox" aria-checked="false"></span><span class="page-todo-text">Prototype sticker page flip transition</span></div>`;
      }
    }
  }

  // Seed starter internal scroll links between books so "Mentioned In" backlinks are immediately visible on default books
  if (lib.title === 'Grand Idea Library' && !lib._starterBacklinksSeeded) {
    lib._starterBacklinksSeeded = true;
    let hasAnyLink = false;
    bookObjMap.forEach(b => {
      b.pages.forEach(p => { if ((p.html || '').includes('lib-internal-link')) hasAnyLink = true; });
    });
    if (!hasAnyLink) {
      const bProlog = bookObjMap.get('b_prolog');
      const p1 = bProlog?.pages?.find(p => p.id === 'p_1') || bProlog?.pages?.[0];
      const bChars = bookObjMap.get('b_chars');
      const p4 = bChars?.pages?.find(p => p.id === 'p_4') || bChars?.pages?.[0];
      const bMyth = bookObjMap.get('b_myth');
      const p6 = bMyth?.pages?.find(p => p.id === 'p_6') || bMyth?.pages?.[0];
      if (p1 && p4 && p6) {
        p1.html = (p1.html || plainTextToHtml(p1.body || ''))
          + `<br>Delivered at dusk by <a class="lib-internal-link" contenteditable="false" href="#lib-b_chars-p_4" data-lib-book="b_chars" data-lib-page="p_4">Pip the Courier</a> alongside a verse from <a class="lib-internal-link" contenteditable="false" href="#lib-b_myth-p_6" data-lib-book="b_myth" data-lib-page="p_6">Song of the Moss Bridge</a>.`;
        p4.html = (p4.html || plainTextToHtml(p4.body || ''))
          + `<br>First appears carrying <a class="lib-internal-link" contenteditable="false" href="#lib-b_prolog-p_1" data-lib-book="b_prolog" data-lib-page="p_1">The Clocktower Letter</a>.`;
      }
    }
  }

  // Normalize Named Reading Stacks (Study Table Presets) & Saved Page Templates
  if (!Array.isArray(lib.studyPresets)) lib.studyPresets = [];
  lib.studyPresets = lib.studyPresets
    .filter(sp => sp && typeof sp === 'object')
    .map((sp, i) => ({
      id: sp.id || uid('sp'),
      name: String(sp.name || `Reading Stack ${i + 1}`),
      bookIds: Array.isArray(sp.bookIds)
        ? sp.bookIds.filter(id => bookObjMap.has(id)).slice(0, MAX_STUDY_TABLE_BOOKS)
        : []
    }));

  if (!Array.isArray(lib.pageTemplates)) lib.pageTemplates = [];
  lib.pageTemplates = lib.pageTemplates
    .filter(t => t && typeof t === 'object')
    .map((t, i) => ({
      id: t.id || uid('ptpl'),
      name: String(t.name || `Template ${i + 1}`),
      sourceBookId: t.sourceBookId || null,
      sourceBookTitle: String(t.sourceBookTitle || ''),
      sourceHallTitle: String(t.sourceHallTitle || ''),
      stamps: Array.isArray(t.stamps) ? t.stamps.filter(id => validStamps.has(id)) : [],
      properties: normProperties(t.properties),
      body: typeof t.body === 'string' ? t.body : '',
      html: typeof t.html === 'string' && t.html.length > 0 ? t.html : plainTextToHtml(t.body || '')
    }));

  // Seed starter Obsidian-style Page Properties, Page Templates (with origin book), & Named Reading Stacks
  if (lib.title === 'Grand Idea Library' && !lib._starterPropsTemplatesSeeded) {
    lib._starterPropsTemplatesSeeded = true;
    const bChars = bookObjMap.get('b_chars');
    const pPip = bChars?.pages?.find(p => p.id === 'p_4') || bChars?.pages?.[0];
    if (pPip && (!pPip.properties || pPip.properties.length === 0)) {
      pPip.properties = normProperties([
        { key: 'Name', type: 'text', value: 'Pip of Harbor Lane' },
        { key: 'Date of Birth', type: 'date', value: '1998-04-12' },
        { key: 'Role', type: 'text', value: 'Bicycle Courier & Mapmaker' },
        { key: 'Playable', type: 'checkbox', value: true }
      ]);
    }
    const bBiomes = bookObjMap.get('b_biomes');
    const pMarket = bBiomes?.pages?.[0];
    if (pMarket && (!pMarket.properties || pMarket.properties.length === 0)) {
      pMarket.properties = normProperties([
        { key: 'Location', type: 'text', value: 'Greenhouse Market' },
        { key: 'Atmosphere', type: 'text', value: 'Sunlit glass & terracotta' },
        { key: 'Discovered', type: 'checkbox', value: true }
      ]);
    }
    if (lib.pageTemplates.length === 0) {
      lib.pageTemplates.push(
        {
          id: 'ptpl_char',
          name: 'Character Sheet',
          sourceBookId: bookObjMap.has('b_chars') ? 'b_chars' : null,
          sourceBookTitle: bookObjMap.get('b_chars')?.title || 'Cast of Beloved Friends',
          sourceHallTitle: 'Story & Lore',
          stamps: validStamps.has('st_char') ? ['st_char'] : [],
          properties: normProperties([
            { key: 'Name', type: 'text', value: '' },
            { key: 'Date of Birth', type: 'date', value: '' },
            { key: 'Role', type: 'text', value: '' },
            { key: 'Playable', type: 'checkbox', value: false }
          ]),
          body: 'Key traits, motivations, and favorite hangout spot:',
          html: 'Key traits, motivations, and favorite hangout spot:'
        },
        {
          id: 'ptpl_loc',
          name: 'Location Card',
          sourceBookId: bookObjMap.has('b_biomes') ? 'b_biomes' : null,
          sourceBookTitle: bookObjMap.get('b_biomes')?.title || 'Cozy Biomes',
          sourceHallTitle: 'World & Art',
          stamps: validStamps.has('st_visual') ? ['st_visual'] : [],
          properties: normProperties([
            { key: 'Location', type: 'text', value: '' },
            { key: 'Atmosphere', type: 'text', value: '' },
            { key: 'Discovered', type: 'checkbox', value: false }
          ]),
          body: 'Sensory details, lighting, and secrets hidden here:',
          html: 'Sensory details, lighting, and secrets hidden here:'
        }
      );
    }
    if (lib.studyPresets.length === 0) {
      const stack1 = ['b_prolog', 'b_chars', 'b_myth'].filter(id => bookObjMap.has(id));
      const stack2 = ['b_palette', 'b_biomes', 'b_sound'].filter(id => bookObjMap.has(id));
      if (stack1.length) lib.studyPresets.push({ id: 'sp_ch1', name: 'Opening Chapter Research', bookIds: stack1 });
      if (stack2.length) lib.studyPresets.push({ id: 'sp_art', name: 'Art & Audio Moodboard', bookIds: stack2 });
    }
  }

  // Seed one starter Scroll item sitting alongside Books on the Story & Lore shelf
  if (lib.title === 'Grand Idea Library' && !lib._starterScrollSeeded) {
    lib._starterScrollSeeded = true;
    const storyHall = lib.halls?.[0];
    const hasScroll = Array.from(bookObjMap.values()).some(b => b.itemType === 'scroll');
    if (storyHall && !hasScroll) {
      const scrollObj = {
        id: 'b_scroll_prophecy',
        itemType: 'scroll',
        title: 'Harbor Bell Prophecy',
        color: 'honey',
        pinned: false,
        summary: 'A single-sheet parchment scroll shelved alongside books.',
        chapters: [{ id: 'ch_sc1', title: 'Scroll', color: 'honey' }],
        pages: [{
          id: 'p_sc1',
          chapterId: 'ch_sc1',
          title: 'Harbor Bell Prophecy',
          stamps: validStamps.has('st_mystery') ? ['st_mystery'] : [],
          properties: normProperties([
            { key: 'Origin', type: 'text', value: 'Old Lighthouse Vault' },
            { key: 'Deciphered', type: 'checkbox', value: false }
          ]),
          body: 'When three brass bells ring at low tide, the moss bridge reveals the sunken library steps.',
          html: 'When three brass bells ring at low tide, the moss bridge reveals the sunken library steps.'
        }]
      };
      normBook(scrollObj, storyHall.color, true);
      storyHall.books.push(scrollObj);
    }
  }

  lib.cart.books.forEach(b => { normBook(b, fallbackColor, false); b.pinned = false; });
  lib.cart.pages.forEach(p => normPage(p));
  if (!Array.isArray(lib.trash)) lib.trash = [];
  lib.trash = lib.trash.filter(it => it && typeof it === 'object' && it.payload).slice(0, 60);

  // Maintain ordered Study Table stack (up to MAX_STUDY_TABLE_BOOKS = 11 books, bottom-to-top)
  const rawStack = Array.isArray(lib.studyStack) ? lib.studyStack : [];
  const cleanStack = [];
  const stackSeen = new Set();
  rawStack.forEach(id => {
    if (allBookIds.has(id) && !stackSeen.has(id)) {
      stackSeen.add(id);
      cleanStack.push(id);
    }
  });
  bookObjMap.forEach((b, id) => {
    if (b.pinned && !stackSeen.has(id)) {
      stackSeen.add(id);
      cleanStack.push(id);
    }
  });
  lib.studyStack = cleanStack.slice(0, MAX_STUDY_TABLE_BOOKS);
  const finalStackSet = new Set(lib.studyStack);
  bookObjMap.forEach((b, id) => { b.pinned = finalStackSet.has(id); });

  lib.ribbons = lib.ribbons
    .filter(r => r && r.fromBookId && r.toBookId && r.fromBookId !== r.toBookId && allBookIds.has(r.fromBookId) && allBookIds.has(r.toBookId))
    .map(r => ({
      id: r.id || uid('rib'),
      fromBookId: r.fromBookId,
      toBookId: r.toBookId,
      label: r.label || '',
      colorId: validPalette.has(r.colorId) ? r.colorId : fallbackColor
    }));
  return lib;
}

const CART_HALL_ID = '__CART__';
const LOOSE_PAPER_MODE_ID = '__LOOSE_PAPER__';

function getOrderedBookPages(book) {
  const ordered = [];
  for (const ch of book.chapters) {
    for (const p of book.pages) if (p.chapterId === ch.id) ordered.push(p);
  }
  for (const p of book.pages) if (!ordered.includes(p)) ordered.push(p);
  return ordered;
}

function findHallInfo(hallId, list = state.halls, ancestors = []) {
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (h.id === hallId) return { hall: h, parentList: list, index: i, ancestors };
    const nested = findHallInfo(hallId, h.subHalls, [...ancestors, h]);
    if (nested) return nested;
  }
  return null;
}

function forEachHall(fn, list = state.halls, depth = 0, ancestors = []) {
  for (const h of list) {
    fn(h, depth, ancestors);
    if (h.subHalls?.length) forEachHall(fn, h.subHalls, depth + 1, [...ancestors, h]);
  }
}

function getAllBooksFlat() {
  const out = [];
  forEachHall((h, depth) => {
    h.books.forEach(b => out.push({ hall: h, book: b, depth }));
  });
  return out;
}

function getPinnedBooks() {
  const byId = new Map();
  forEachHall((h, depth) => {
    h.books.forEach(b => byId.set(b.id, { hall: h, book: b, depth }));
  });
  const stack = Array.isArray(state?.studyStack) ? state.studyStack : [];
  const ordered = [];
  stack.forEach(id => {
    if (byId.has(id)) ordered.push(byId.get(id));
  });
  return ordered.slice(0, MAX_STUDY_TABLE_BOOKS);
}

function findBookEntry(bookId) {
  let found = null;
  forEachHall(h => {
    if (found) return;
    const b = h.books.find(x => x.id === bookId);
    if (b) found = { hall: h, book: b };
  });
  return found;
}

function findOpenBookContainer(hallId, bookId) {
  if (hallId === LOOSE_PAPER_MODE_ID) {
    const pages = state.cart?.pages || [];
    if (pages.length === 0) return null;
    const col = state.palette?.[0]?.id || 'terracotta';
    return {
      isCart: false,
      isLoosePaper: true,
      hall: { id: LOOSE_PAPER_MODE_ID, title: 'Sorting Pile', color: col },
      book: {
        id: LOOSE_PAPER_MODE_ID,
        title: 'Sorting Pile · Loose Paper',
        color: col,
        pinned: false,
        summary: '',
        chapters: [{ id: 'ch_loose', title: 'Loose Papers', color: col }],
        pages
      }
    };
  }
  if (hallId === CART_HALL_ID) {
    const b = (state.cart?.books || []).find(x => x.id === bookId);
    return b ? { isCart: true, isLoosePaper: false, hall: { id: CART_HALL_ID, title: 'Sorting Pile', color: b.color }, book: b } : null;
  }
  const info = findHallInfo(hallId);
  const book = info?.hall.books.find(b => b.id === bookId);
  return book ? { isCart: false, isLoosePaper: false, hall: info.hall, book } : null;
}

function expandAncestorsOfHall(hallId, includeSelf = false) {
  const info = findHallInfo(hallId);
  if (!info) return false;
  let changed = false;
  info.ancestors.forEach(a => { if (a.collapsed) { a.collapsed = false; changed = true; } });
  if (includeSelf && info.hall.collapsed) { info.hall.collapsed = false; changed = true; }
  return changed;
}

function findPagesWithStamp(stampId, excludePageId = null) {
  const matches = [];
  forEachHall(h => {
    h.books.forEach(b => {
      b.pages.forEach(p => {
        if (p.id !== excludePageId && Array.isArray(p.stamps) && p.stamps.includes(stampId)) {
          matches.push({ hall: h, book: b, page: p });
        }
      });
    });
  });
  return matches;
}

function countTotalBooks(hall) {
  let n = hall.books.length;
  for (const sub of hall.subHalls || []) n += countTotalBooks(sub);
  return n;
}

function countPageTodos(html) {
  if (!html || !html.includes('page-todo-item')) return { total: 0, done: 0 };
  const total = (html.match(/class="[^"]*page-todo-item/g) || []).length;
  const done = (html.match(/data-checked="true"/g) || []).length;
  return { total, done };
}

// Aggregate every task across all books (and loose papers) in the library
function getAllLibraryTasks() {
  const tasks = [];
  const tmp = document.createElement('div');

  function extractFromPage(p, meta) {
    if (!p.html || !p.html.includes('page-todo-item')) return;
    tmp.innerHTML = p.html;
    tmp.querySelectorAll('.page-todo-item').forEach((row, idx) => {
      const isChecked = row.dataset.checked === 'true';
      const txtEl = row.querySelector('.page-todo-text');
      const rawText = (txtEl ? txtEl.textContent : row.textContent || '').replace(/\u200B/g, '').trim();
      if (!rawText) return;
      tasks.push({
        checked: isChecked,
        text: rawText,
        taskIndex: idx,
        taskIdx: idx,
        pageId: p.id,
        pageTitle: p.title || 'Untitled Page',
        ...meta
      });
    });
  }

  forEachHall(h => {
    h.books.forEach(b => {
      getOrderedBookPages(b).forEach(p => {
        extractFromPage(p, {
          isLoosePaper: false,
          hallId: h.id,
          hallTitle: h.title,
          bookId: b.id,
          bookTitle: b.title,
          bookColor: b.color || h.color
        });
      });
    });
  });

  (state.cart?.books || []).forEach(b => {
    getOrderedBookPages(b).forEach(p => {
      extractFromPage(p, {
        isLoosePaper: false,
        hallId: CART_HALL_ID,
        hallTitle: 'Sorting Pile',
        bookId: b.id,
        bookTitle: b.title,
        bookColor: b.color
      });
    });
  });

  (state.cart?.pages || []).forEach(p => {
    extractFromPage(p, {
      isLoosePaper: true,
      hallId: CART_HALL_ID,
      hallTitle: 'Sorting Pile',
      bookId: LOOSE_PAPER_MODE_ID,
      bookTitle: 'Sorting Pile (Loose Paper)',
      bookColor: state.palette?.[0]?.id || 'terracotta'
    });
  });

  return tasks;
}

// Find all pages in the library that contain an internal scroll link pointing to targetPageId (or targetBookId)
function findBacklinksForPage(targetBookId, targetPageId) {
  const results = [];
  const tmp = document.createElement('div');
  function checkPage(p, hall, book, isLoosePaper = false) {
    if (p.id === targetPageId) return;
    const html = p.html || '';
    if (!html.includes('lib-internal-link')) return;
    tmp.innerHTML = html;
    let matched = false;
    tmp.querySelectorAll('a.lib-internal-link').forEach(a => {
      if (matched) return;
      const bId = a.getAttribute('data-lib-book') || '';
      const pId = a.getAttribute('data-lib-page') || '';
      if (targetPageId && pId === targetPageId) matched = true;
      else if (targetBookId && bId === targetBookId && !pId) matched = true;
    });
    if (matched) {
      results.push({ hall, book, page: p, isLoosePaper });
    }
  }
  forEachHall(h => {
    h.books.forEach(b => {
      b.pages.forEach(p => checkPage(p, h, b, false));
    });
  });
  (state.cart?.books || []).forEach(b => {
    b.pages.forEach(p => checkPage(p, { id: CART_HALL_ID, title: 'Sorting Pile', color: b.color }, b, false));
  });
  (state.cart?.pages || []).forEach(p => {
    checkPage(p, { id: CART_HALL_ID, title: 'Sorting Pile' }, { id: LOOSE_PAPER_MODE_ID, title: 'Loose Paper', color: state.palette?.[0]?.id }, true);
  });
  return results;
}

function htmlToMarkdown(html, fallbackBody = '') {
  if (!html || !html.trim()) return (fallbackBody || '').trim();
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  function walk(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (node.classList.contains('page-img-card')) return '\n*[Embedded Image]*\n';
    if (node.classList.contains('page-todo-item')) {
      const checked = node.dataset.checked === 'true' ? 'x' : ' ';
      const textEl = node.querySelector('.page-todo-text');
      return `\n- [${checked}] ${(textEl ? walkChildren(textEl) : walkChildren(node)).trim()}\n`;
    }
    if (tag === 'a') {
      const txt = (node.textContent || '').trim();
      if (node.classList.contains('lib-internal-link')) return `[[${txt}]]`;
      const href = node.getAttribute('href') || '';
      return href ? `[${txt || href}](${href})` : txt;
    }
    if (tag === 'strong' || tag === 'b') { const t = walkChildren(node).trim(); return t ? `**${t}**` : ''; }
    if (tag === 'em' || tag === 'i') { const t = walkChildren(node).trim(); return t ? `*${t}*` : ''; }
    if (tag === 'li') return `- ${walkChildren(node).trim()}\n`;
    if (tag === 'ul' || tag === 'ol') return `\n${walkChildren(node)}\n`;
    if (tag === 'div' || tag === 'p') return `\n${walkChildren(node)}\n`;
    return walkChildren(node);
  }
  function walkChildren(el) {
    let s = '';
    el.childNodes.forEach(c => { s += walk(c); });
    return s;
  }
  return walkChildren(tmp).replace(/\n{3,}/g, '\n\n').trim();
}

function bookToMarkdown(book, hallTitle = '', baseLevel = 1) {
  const h1 = '#'.repeat(Math.min(6, baseLevel));
  const h2 = '#'.repeat(Math.min(6, baseLevel + 1));
  const h3 = '#'.repeat(Math.min(6, baseLevel + 2));
  const lines = [];
  lines.push(`${h1} ${book.title || 'Untitled Book'}`);
  if (hallTitle) lines.push(`*Hall: ${hallTitle}${book.pinned ? ' · On Study Table' : ''}*`);
  if (book.summary) lines.push(`> ${book.summary}`);
  const bookRibs = (state.ribbons || []).filter(r => r.fromBookId === book.id || r.toBookId === book.id);
  if (bookRibs.length) {
    const ribRefs = bookRibs.map(r => {
      const other = findBookEntry(r.fromBookId === book.id ? r.toBookId : r.fromBookId);
      return other ? `[[${other.book.title}]]${r.label ? ` (${r.label})` : ''}` : '';
    }).filter(Boolean);
    if (ribRefs.length) lines.push(`**Ribbons:** ${ribRefs.join(', ')}`);
  }
  lines.push('');
  book.chapters.forEach(ch => {
    lines.push(`${h2} ${ch.title || 'Chapter'}`);
    const chPages = book.pages.filter(p => p.chapterId === ch.id);
    if (!chPages.length) lines.push('*No pages yet.*\n');
    chPages.forEach(p => {
      lines.push(`${h3} ${p.title || 'Untitled Page'}`);
      if (Array.isArray(p.properties) && p.properties.length > 0) {
        lines.push('```yaml');
        p.properties.forEach(pr => {
          if (pr.key) lines.push(`${pr.key}: ${pr.type === 'checkbox' ? (pr.value ? 'true' : 'false') : (pr.value || '')}`);
        });
        lines.push('```');
      }
      const stLabels = (p.stamps || []).map(sid => getStamp(sid)?.label).filter(Boolean);
      if (stLabels.length) lines.push(`*Stamps: ${stLabels.map(l => '`' + l + '`').join(' ')}*`);
      const mdBody = htmlToMarkdown(p.html, p.body);
      if (mdBody) lines.push(mdBody);
      lines.push('');
    });
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function libraryToMarkdown() {
  const out = [];
  out.push(`# ${state.title || 'Library Mind Map'}`);
  if (state.subtitle) out.push(`*${state.subtitle}*`);
  out.push('');
  const pinned = getPinnedBooks();
  if (pinned.length) {
    out.push(`## Study Table (${pinned.length}/${MAX_STUDY_TABLE_BOOKS} Books)`);
    pinned.forEach(e => out.push(`- **${e.book.title}** *(${e.hall.title})*`));
    out.push('');
  }
  function emitHall(h, depth) {
    const lvl = Math.min(4, depth + 2);
    out.push(`${'#'.repeat(lvl)} ${h.title || 'Untitled Hall'}`);
    out.push('');
    h.books.forEach(b => out.push(bookToMarkdown(b, h.title, Math.min(5, lvl + 1))));
    (h.subHalls || []).forEach(sub => emitHall(sub, depth + 1));
  }
  state.halls.forEach(h => emitHall(h, 0));
  if ((state.cart?.books?.length || 0) + (state.cart?.pages?.length || 0) > 0) {
    out.push(`## Sorting Pile (Unfiled Books & Loose Papers)`);
    out.push('');
    (state.cart.books || []).forEach(b => out.push(bookToMarkdown(b, 'Sorting Pile', 3)));
    (state.cart.pages || []).forEach(p => {
      out.push(`### ${p.title || 'Loose Paper'}`);
      const mdBody = htmlToMarkdown(p.html, p.body);
      if (mdBody) out.push(mdBody);
      out.push('');
    });
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function makeTemplates() {
  const raw = {
    creative: {
      title: 'Grand Idea Library',
      subtitle: 'Cozy Indie Adventure',
      _cornerTableSeeded: true,
      palette: deepClone(DEFAULT_PALETTE_SPEC),
      stamps: deepClone(DEFAULT_STAMPS),
      studyStack: ['b_prolog', 'b_palette', 'b_loop'],
      ribbons: [
        { id: 'rib_1', fromBookId: 'b_prolog', toBookId: 'b_myth', label: 'Foreshadowing', colorId: 'honey' },
        { id: 'rib_2', fromBookId: 'b_biomes', toBookId: 'b_ferns', label: 'Flora Refs', colorId: 'sage' },
        { id: 'rib_3', fromBookId: 'b_prolog', toBookId: 'b_score', label: 'Opening Theme', colorId: 'plum' }
      ],
      cart: {
        books: [
          {
            id: 'b_cart1', title: 'Weather & Seasons Draft', color: 'seaglass', summary: 'Unsorted weather ideas waiting for a home hall.',
            chapters: [{ id: 'ch_ct1', title: 'Rough Ideas', color: 'seaglass' }],
            pages: [{ id: 'p_ct1', chapterId: 'ch_ct1', title: 'Autumn Rain Mood', stamps: ['st_visual'], body: 'Warm lantern reflections on wet cobblestones when rain starts falling.' }]
          }
        ],
        pages: [
          { id: 'cp_1', title: 'Market Festival Note', stamps: ['st_todo'], body: 'Paper kite contest above the Greenhouse Market — file into World & Art or Side Quests!' },
          { id: 'cp_2', title: 'Harbor Bell Riddle', stamps: ['st_mystery'], body: 'Three chimes at low tide reveal the sunken boathouse stairs.' }
        ]
      },
      halls: [
        {
          id: 'h_story', title: 'Story & Lore', color: 'terracotta', icon: 'quill',
          books: [
            {
              id: 'b_prolog', title: 'Opening Hook', color: 'terracotta', pinned: true, summary: 'How the journey begins on a rainy autumn evening.',
              chapters: [
                { id: 'ch_p1', title: 'The Arrival', color: 'terracotta' },
                { id: 'ch_p2', title: 'Dark Lanterns', color: 'plum' }
              ],
              pages: [
                { id: 'p_1', chapterId: 'ch_p1', title: 'The Clocktower Letter', stamps: ['st_key', 'st_mystery'], body: 'A mysterious folded crane slips under the bookshop door right as the town clock strikes seven.\n\nClick any vintage stamp above to see cross-referenced pages across the whole library!' },
                { id: 'p_2', chapterId: 'ch_p1', title: 'First Companion', stamps: ['st_lore'], body: 'A round tea-kettle spirit who speaks only in gentle whistles and cozy riddles.' },
                { id: 'p_3', chapterId: 'ch_p2', title: 'Inciting Mystery', stamps: ['st_mystery'], body: 'Why did the lanterns in the Harbor District go dark all at once?' }
              ]
            },
            {
              id: 'b_chars', title: 'Cast of Beloved Friends', color: 'honey', summary: 'Warm memorable townsfolk you meet along the roads.',
              chapters: [
                { id: 'ch_c1', title: 'Couriers', color: 'honey' },
                { id: 'ch_c2', title: 'Town Archivists', color: 'harbor' }
              ],
              pages: [
                { id: 'p_4', chapterId: 'ch_c1', title: 'Pip the Courier', stamps: ['st_visual', 'st_lore'], body: 'Wears an oversized satchel and rides a rickety brass penny-farthing.' },
                { id: 'p_5', chapterId: 'ch_c2', title: 'Archivist Maren', stamps: ['st_mystery'], body: 'Keeps secret maps pressed between recipes in the bakery basement.' }
              ]
            },
            {
              id: 'b_myth', title: 'Old Folktales', color: 'plum', summary: 'Bedtime legends that hint at hidden shortcuts.',
              chapters: [{ id: 'ch_m1', title: 'Fireside Legends', color: 'plum' }],
              pages: [
                { id: 'p_6', chapterId: 'ch_m1', title: 'Song of the Moss Bridge', stamps: ['st_lore'], body: 'If you hum three slow notes at twilight, the stepping stones float upward.' },
                { id: 'p_7', chapterId: 'ch_m1', title: 'Starlight Glass', stamps: ['st_mystery', 'st_key'], body: 'Bottled reflections from the northern lake can reveal invisible ink.' }
              ]
            }
          ],
          subHalls: [
            {
              id: 'sh_quests', title: 'Side Quests', color: 'honey', icon: 'lantern',
              books: [
                {
                  id: 'b_bakery', title: 'The Missing Cinnamon Recipe', color: 'terracotta', summary: 'A cozy mystery stretching across three rooftops.',
                  chapters: [{ id: 'ch_q1', title: 'Clues', color: 'terracotta' }],
                  pages: [{ id: 'p_sq1', chapterId: 'ch_q1', title: 'Clue in the Flour Mill', stamps: ['st_mystery'], body: 'Pigeons carried the recipe page up to the weathervane.' }]
                },
                {
                  id: 'b_bridge', title: 'Bridge Repair', color: 'sage', summary: 'Help the carpenters gather driftwood planks.',
                  chapters: [{ id: 'ch_q2', title: 'Rewards', color: 'sage' }],
                  pages: [{ id: 'p_sq2', chapterId: 'ch_q2', title: 'Reward Shortcut', stamps: ['st_key'], body: 'Unlocks the warm sunlit shortcut to Tidepool Pier.' }]
                }
              ],
              subHalls: []
            }
          ]
        },
        {
          id: 'h_art', title: 'World & Art', color: 'sage', icon: 'leaf',
          books: [
            {
              id: 'b_palette', title: 'Gouache Color Palette', color: 'sage', pinned: true, summary: 'Warm inked outlines, soft cel shading, zero harsh corners.',
              chapters: [
                { id: 'ch_a1', title: 'Ink & Shadow', color: 'sage' },
                { id: 'ch_a2', title: 'Lighting', color: 'honey' }
              ],
              pages: [
                { id: 'p_8', chapterId: 'ch_a1', title: 'Sunlit Oak & Moss', stamps: ['st_visual', 'st_key'], body: 'Use warm sepia ink (#3c2516) instead of pure black so shadows stay cozy and inviting.' },
                { id: 'p_9', chapterId: 'ch_a2', title: 'Golden Hour Rim', stamps: ['st_visual'], body: 'Add tiny honey-cream crescents along rooftops, foliage tufts, and round book spines.' }
              ]
            },
            {
              id: 'b_biomes', title: 'Cozy Biomes', color: 'seaglass', summary: 'Distinct neighborhoods linked by winding footbridges.',
              chapters: [
                { id: 'ch_b1', title: 'Market Quarter', color: 'seaglass' },
                { id: 'ch_b2', title: 'Harbor Coast', color: 'harbor' }
              ],
              pages: [
                { id: 'p_10', chapterId: 'ch_b1', title: 'Greenhouse Market', stamps: ['st_visual'], body: 'Curved glass arches dripping with ferns, hanging brass scales, and spiced cider stalls.' },
                { id: 'p_11', chapterId: 'ch_b2', title: 'Tidepool Pier', stamps: ['st_visual', 'st_lore'], body: 'Curved wooden docks, paper lanterns swaying in sea breeze, sleepy harbor seals.' }
              ]
            }
          ],
          subHalls: [
            {
              id: 'sh_props', title: 'Props & Flora', color: 'seaglass', icon: 'spark',
              books: [
                {
                  id: 'b_ferns', title: 'Botanical Sketchbook', color: 'sage', summary: 'Hand-inked ferns, clover tufts, and glowing mushrooms.',
                  chapters: [{ id: 'ch_f1', title: 'Foliage', color: 'sage' }],
                  pages: [{ id: 'p_fl1', chapterId: 'ch_f1', title: 'Hanging Ivy', stamps: ['st_visual'], body: 'Gently sways when wind blows through open windows.' }]
                }
              ],
              subHalls: []
            }
          ]
        },
        {
          id: 'h_craft', title: 'Craft & Flow', color: 'harbor', icon: 'compass',
          books: [
            {
              id: 'b_loop', title: 'Core Loop', color: 'harbor', summary: 'Explore, collect sketches, restore forgotten landmarks.',
              chapters: [{ id: 'ch_l1', title: 'Exploration', color: 'harbor' }],
              pages: [
                { id: 'p_13', chapterId: 'ch_l1', title: 'Sketchbook Journal', stamps: ['st_key'], body: 'Every discovery adds a hand-drawn sticker page you can rearrange freely.' },
                { id: 'p_14', chapterId: 'ch_l1', title: 'Gentle Pacing', stamps: ['st_todo'], body: 'No timers or fail states—reward curiosity with little animated surprises.' }
              ]
            },
            {
              id: 'b_puzzles', title: 'Playful Contraptions', color: 'plum', summary: 'Tactile contraptions using sound, light, and wind.',
              chapters: [{ id: 'ch_pz1', title: 'Light & Sound', color: 'plum' }],
              pages: [
                { id: 'p_15', chapterId: 'ch_pz1', title: 'Prism Mirrors', stamps: ['st_todo'], body: 'Bounce warm sunbeams into dusty alcoves to wake sleeping vine doors.' },
                { id: 'p_16', chapterId: 'ch_pz1', title: 'Bell Chimes', stamps: ['st_lore'], body: 'Match the three-tone tune whistled by the perched robins nearby.' }
              ]
            },
            {
              id: 'b_ui', title: 'Tactile UI', color: 'honey', summary: 'Menus that feel like physical postcards and ribbons.',
              chapters: [{ id: 'ch_ui1', title: 'Motion', color: 'honey' }],
              pages: [{ id: 'p_17', chapterId: 'ch_ui1', title: 'Page-Flip Motion', stamps: ['st_visual'], body: 'Soft springy overshoot on hover and gentle page-curl transitions.' }]
            }
          ],
          subHalls: []
        },
        {
          id: 'h_sound', title: 'Music & Mood', color: 'plum', icon: 'music',
          books: [
            {
              id: 'b_score', title: 'Acoustic Score', color: 'plum', summary: 'Woodwinds, nylon guitar, upright felt piano.',
              chapters: [{ id: 'ch_s1', title: 'Motifs', color: 'plum' }],
              pages: [
                { id: 'p_18', chapterId: 'ch_s1', title: 'Rotunda Waltz', stamps: ['st_key'], body: 'Gentle 3/4 harp and clarinet motif that layers extra instruments as you unlock halls.' },
                { id: 'p_19', chapterId: 'ch_s1', title: 'Rainy Afternoon', stamps: ['st_todo'], body: 'Soft felt piano chords paired with cozy windowpane rain taps.' }
              ]
            },
            {
              id: 'b_foley', title: 'Cozy Foley', color: 'terracotta', summary: 'Tiny tactile audio delights for every action.',
              chapters: [{ id: 'ch_fo1', title: 'Textures', color: 'terracotta' }],
              pages: [
                { id: 'p_20', chapterId: 'ch_fo1', title: 'Paper & Pages', stamps: ['st_todo'], body: 'Crisp page rustle when opening notes, soft wooden thump when shelving a book.' },
                { id: 'p_21', chapterId: 'ch_fo1', title: 'Tea & Footsteps', stamps: ['st_visual'], body: 'Warm creaking oak floorboards and subtle porcelain clinks.' }
              ]
            }
          ],
          subHalls: []
        }
      ]
    },
    worldbuilding: {
      title: 'Atlas of Aethel',
      subtitle: 'Fantasy Story Bible',
      palette: deepClone(DEFAULT_PALETTE_SPEC),
      stamps: deepClone(DEFAULT_STAMPS),
      ribbons: [
        { id: 'wb_r1', fromBookId: 'wb_b3', toBookId: 'wb_b10', label: 'Guild Member', colorId: 'terracotta' },
        { id: 'wb_r2', fromBookId: 'wb_b1', toBookId: 'wb_b6', label: 'Act I Setting', colorId: 'harbor' }
      ],
      halls: [
        {
          id: 'wb_h1', title: 'Realms & Cities', color: 'sage', icon: 'castle',
          books: [
            {
              id: 'wb_b1', title: 'Cloudspire', color: 'harbor', summary: 'Terraced cliffside city linked by wicker cable-cars.',
              chapters: [{ id: 'wb_ch1', title: 'Districts', color: 'harbor' }, { id: 'wb_ch2', title: 'Engineering', color: 'honey' }],
              pages: [
                { id: 'wb_p1', chapterId: 'wb_ch1', title: 'Sky Docks', stamps: ['st_key', 'st_visual'], body: 'Canvas airships tether to carved cedar spires above the morning mist.' },
                { id: 'wb_p2', chapterId: 'wb_ch2', title: 'Clockwork Wells', stamps: ['st_lore'], body: 'Rainwater cascades through musical bronze wheels to power bakeries.' }
              ]
            },
            {
              id: 'wb_b2', title: 'Bramblewood', color: 'sage', summary: 'Ancient whispering orchard where paths rearrange at dusk.',
              chapters: [{ id: 'wb_ch3', title: 'Wildlife', color: 'sage' }],
              pages: [{ id: 'wb_p3', chapterId: 'wb_ch3', title: 'Lantern Foxes', stamps: ['st_lore', 'st_visual'], body: 'Follow a fox with a glowing tail tip to safely find the hidden tea-house.' }]
            }
          ],
          subHalls: [
            {
              id: 'wb_sh1', title: 'Guilds & Factions', color: 'seaglass', icon: 'compass',
              books: [{
                id: 'wb_b10', title: 'Guild of Sky Cartographers', color: 'harbor', summary: 'Keepers of the ever-shifting wind charts.',
                chapters: [{ id: 'wb_ch4', title: 'Tenets', color: 'harbor' }],
                pages: [{ id: 'wb_p11', chapterId: 'wb_ch4', title: 'Oath of Ink', stamps: ['st_lore'], body: 'Never seal a chart while a valley remains unexplored.' }]
              }],
              subHalls: []
            }
          ]
        },
        {
          id: 'wb_h2', title: 'Heroes & Rivals', color: 'terracotta', icon: 'quill',
          books: [
            {
              id: 'wb_b3', title: 'Lyra the Cartographer', color: 'terracotta', summary: 'Draws living maps that wiggle when secrets are nearby.',
              chapters: [{ id: 'wb_ch6', title: 'Character Arc', color: 'terracotta' }, { id: 'wb_ch7', title: 'Belongings', color: 'honey' }],
              pages: [
                { id: 'wb_p4', chapterId: 'wb_ch6', title: 'Core Flaw', stamps: ['st_key'], body: 'Trusts maps more than people—must learn when to step off the charted edge.' },
                { id: 'wb_p5', chapterId: 'wb_ch7', title: 'Signature Keepsake', stamps: ['st_mystery'], body: 'A brass compass whose needle points toward unanswered questions.' }
              ]
            },
            {
              id: 'wb_b4', title: 'Captain Orin', color: 'honey', summary: 'Retired sky-sailor with a loud laugh and a secret debt.',
              chapters: [{ id: 'wb_ch8', title: 'Backstory', color: 'honey' }],
              pages: [{ id: 'wb_p6', chapterId: 'wb_ch8', title: 'Hidden Past', stamps: ['st_mystery'], body: 'Was he the one who sealed the northern archive twenty winters ago?' }]
            }
          ],
          subHalls: []
        },
        {
          id: 'wb_h3', title: 'Magic & Relics', color: 'plum', icon: 'spark',
          books: [{
            id: 'wb_b5', title: 'Botanical Inkcraft Rules', color: 'plum', summary: 'Magic powered by hand-mixed botanical pigments.',
            chapters: [{ id: 'wb_ch9', title: 'Pigments', color: 'plum' }],
            pages: [
              { id: 'wb_p7', chapterId: 'wb_ch9', title: 'The Cost of Ink', stamps: ['st_key', 'st_lore'], body: 'Every spell fades once its ink dries unless sealed with a true memory.' },
              { id: 'wb_p8', chapterId: 'wb_ch9', title: 'Forbidden Indigo', stamps: ['st_mystery'], body: 'Brewed from midnight tide-flowers; bends echoes across time.' }
            ]
          }],
          subHalls: []
        },
        {
          id: 'wb_h4', title: 'Plot Arcs', color: 'honey', icon: 'compass',
          books: [{
            id: 'wb_b6', title: 'Act I: The Torn Map', color: 'honey', summary: 'Discovery of a blank continent tearing through the atlas.',
            chapters: [{ id: 'wb_ch10', title: 'Beats', color: 'honey' }],
            pages: [{ id: 'wb_p9', chapterId: 'wb_ch10', title: 'Midpoint Twist', stamps: ['st_key'], body: 'The missing island is not lost—it is drifting toward Cloudspire.' }]
          }],
          subHalls: []
        }
      ]
    },
    study: {
      title: 'Knowledge Garden',
      subtitle: 'Personal Research Vault',
      palette: deepClone(DEFAULT_PALETTE_SPEC),
      stamps: deepClone(DEFAULT_STAMPS),
      ribbons: [
        { id: 'st_r1', fromBookId: 'st_b1', toBookId: 'st_b4', label: 'Applied In', colorId: 'sage' }
      ],
      halls: [
        {
          id: 'st_h1', title: 'Core Principles', color: 'harbor', icon: 'compass',
          books: [
            {
              id: 'st_b1', title: 'Mental Models', color: 'harbor', summary: 'Reusable lenses for tricky problems.',
              chapters: [{ id: 'st_ch1', title: 'Reasoning', color: 'harbor' }],
              pages: [
                { id: 'st_p1', chapterId: 'st_ch1', title: 'First Principles', stamps: ['st_key'], body: 'Strip assumptions down to bedrock truths, then rebuild from scratch.' },
                { id: 'st_p2', chapterId: 'st_ch1', title: 'Inversion', stamps: ['st_lore'], body: 'Ask what guarantees failure, then systematically avoid those paths.' }
              ]
            },
            {
              id: 'st_b2', title: 'Systems Thinking Guide', color: 'seaglass', summary: 'Feedback loops, bottlenecks, and delays.',
              chapters: [{ id: 'st_ch2', title: 'Dynamics', color: 'seaglass' }],
              pages: [{ id: 'st_p3', chapterId: 'st_ch2', title: 'Leverage Points', stamps: ['st_key'], body: 'Small changes to information flow often outperform massive brute-force effort.' }]
            }
          ],
          subHalls: []
        },
        {
          id: 'st_h2', title: 'Reading Shelf', color: 'honey', icon: 'quill',
          books: [{
            id: 'st_b3', title: 'Design Classics', color: 'honey', summary: 'Notes from favorite craft & design books.',
            chapters: [{ id: 'st_ch3', title: 'Highlights', color: 'honey' }],
            pages: [{ id: 'st_p4', chapterId: 'st_ch3', title: 'Affordances', stamps: ['st_visual'], body: 'Make possible actions feel effortless and self-evident through shape and warmth.' }]
          }],
          subHalls: []
        },
        {
          id: 'st_h3', title: 'Experiments', color: 'sage', icon: 'gear',
          books: [{
            id: 'st_b4', title: 'Weekly Prototypes', color: 'sage', summary: 'Tiny testable sketches to learn fast.',
            chapters: [{ id: 'st_ch4', title: 'Logs', color: 'sage' }],
            pages: [{ id: 'st_p5', chapterId: 'st_ch4', title: 'Hypothesis Log', stamps: ['st_todo'], body: 'Write down what you expect to happen BEFORE building so surprises teach you more.' }]
          }],
          subHalls: []
        },
        {
          id: 'st_h4', title: 'Open Questions', color: 'terracotta', icon: 'lantern',
          books: [{
            id: 'st_b5', title: 'Curiosity Queue', color: 'terracotta', summary: 'Threads to explore next weekend.',
            chapters: [{ id: 'st_ch5', title: 'Threads', color: 'terracotta' }],
            pages: [{ id: 'st_p6', chapterId: 'st_ch5', title: 'Spatial Memory', stamps: ['st_mystery'], body: 'Why do visual palaces and libraries help ideas stick so much better than flat lists?' }]
          }],
          subHalls: []
        }
      ]
    },
    blank: {
      title: 'My Library',
      subtitle: 'Central Idea',
      palette: deepClone(DEFAULT_PALETTE_SPEC),
      stamps: deepClone(DEFAULT_STAMPS),
      ribbons: [],
      halls: [
        {
          id: 'bl_h1', title: 'First Hall', color: 'sage', icon: 'spark',
          books: [{
            id: 'bl_b1', title: 'First Book', color: 'terracotta', summary: 'Click any book spine to open its chapters and pages.',
            chapters: [{ id: 'bl_ch1', title: 'Chapter 1', color: 'terracotta' }],
            pages: [{ id: 'bl_p1', chapterId: 'bl_ch1', title: 'Page One', stamps: ['st_key'], body: 'Write notes, paste screenshots (Ctrl+V), drop images, stamp pages, or open the Card Index in the central rotunda!' }]
          }],
          subHalls: []
        }
      ]
    }
  };
  Object.values(raw).forEach(t => normalizeLibraryState(t));
  return raw;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
const TEMPLATES = makeTemplates();

const ACTIVE_LIB_KEY = 'storytellers_active_library_id_v1';
let activeLibraryId = 'default';
try {
  activeLibraryId = localStorage.getItem(ACTIVE_LIB_KEY) || 'default';
} catch (e) {}
let savedLibraries = [];
let savedBackups = [];
const SERVER_SYNC_SUPPORTED = typeof window !== 'undefined' && /^https?:$/i.test(window.location?.protocol || '');
let hasCachedInitialState = false;

function getLibStorageKey(id = activeLibraryId) {
  return (!id || id === 'default') ? STORAGE_KEY : `${STORAGE_KEY}:${id}`;
}

function setActiveLibraryId(id) {
  activeLibraryId = id || 'default';
  try { localStorage.setItem(ACTIVE_LIB_KEY, activeLibraryId); } catch (e) {}
}

function loadInitialState() {
  try {
    const primaryRaw = localStorage.getItem(getLibStorageKey(activeLibraryId));
    const raw = primaryRaw || (activeLibraryId === 'default' ? localStorage.getItem(STORAGE_KEY) : null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.halls)) {
        hasCachedInitialState = true;
        return normalizeLibraryState(parsed);
      }
    }
  } catch (e) {}
  hasCachedInitialState = false;
  if (SERVER_SYNC_SUPPORTED) {
    return normalizeLibraryState({ title: 'Loading Library…', subtitle: '', halls: [] });
  }
  return deepClone(TEMPLATES.creative);
}

let state = loadInitialState();
let selection = { type: null, hallId: null };
let openAddRadialHallId = null;
let cardIndexTab = 'rotunda'; // 'rotunda' | 'colors' | 'stamps' | 'ribbons'
let expandedIndexStampId = null;
let expandedCartPageId = null;
let openBookState = { hallId: null, bookId: null, chapterId: null, pageId: null };
let editingChapterId = null;
let showRibbons = true;
let isCandlelight = false;
let searchMatches = { active: false, query: '', hallIds: new Set(), bookIds: new Set(), ribbonIds: new Set() };
let activeStampLensId = null;
let hopIndex = -1;
let minimapCollapsed = window.innerWidth < 640;

function computeSearchMatches(rawQuery) {
  const q = (rawQuery || '').trim().toLowerCase();
  if (!q) {
    return { active: false, query: '', hallIds: new Set(), bookIds: new Set(), ribbonIds: new Set() };
  }
  const hallIds = new Set();
  const bookIds = new Set();
  const directBookIds = new Set();
  const ribbonIds = new Set();

  forEachHall((h) => {
    if ((h.title || '').toLowerCase().includes(q)) {
      hallIds.add(h.id);
    }
    h.books.forEach((b) => {
      if ((b.title || '').toLowerCase().includes(q) || (b.summary || '').toLowerCase().includes(q)) {
        directBookIds.add(b.id);
        bookIds.add(b.id);
      }
      if ((b.chapters || []).some(c => (c.title || '').toLowerCase().includes(q))) {
        bookIds.add(b.id);
      }
      if ((b.pages || []).some(p => {
        const stampMatch = (p.stamps || []).some(sid => (getStamp(sid)?.label || '').toLowerCase().includes(q));
        return (p.title || '').toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q) || stampMatch;
      })) {
        bookIds.add(b.id);
      }
    });
  });

  (state.ribbons || []).forEach((rib) => {
    const labelMatch = (rib.label || '').toLowerCase().includes(q);
    if (labelMatch) {
      ribbonIds.add(rib.id);
      bookIds.add(rib.fromBookId);
      bookIds.add(rib.toBookId);
    } else if (directBookIds.has(rib.fromBookId) || directBookIds.has(rib.toBookId)) {
      ribbonIds.add(rib.id);
    }
  });

  return { active: true, query: q, hallIds, bookIds, ribbonIds };
}

function hallHasGlowingContent(hall, hallIds, bookIds) {
  if (hallIds.has(hall.id)) return true;
  if ((hall.books || []).some(b => bookIds.has(b.id))) return true;
  return (hall.subHalls || []).some(sub => hallHasGlowingContent(sub, hallIds, bookIds));
}

function getGlowState() {
  const empty = {
    active: false, mode: null, stamp: null,
    glowOuter: isCandlelight ? '#ffd85a' : '#f5a623',
    glowCore: isCandlelight ? '#fff0a6' : '#ffe066',
    hallIds: new Set(), collapsedGlowHallIds: new Set(), bookIds: new Set(), ribbonIds: new Set()
  };
  if (searchMatches.active) {
    const collapsedGlowHallIds = new Set();
    forEachHall(h => {
      if (h.collapsed && hallHasGlowingContent(h, searchMatches.hallIds, searchMatches.bookIds)) {
        collapsedGlowHallIds.add(h.id);
      }
    });
    return {
      active: true, mode: 'search', stamp: null,
      glowOuter: isCandlelight ? '#ffd85a' : '#f5a623',
      glowCore: isCandlelight ? '#fff0a6' : '#ffe066',
      hallIds: searchMatches.hallIds,
      collapsedGlowHallIds,
      bookIds: searchMatches.bookIds,
      ribbonIds: searchMatches.ribbonIds
    };
  }
  if (activeStampLensId) {
    const st = getStamp(activeStampLensId);
    if (!st) return empty;
    const bookIds = new Set();
    forEachHall(h => {
      h.books.forEach(b => {
        if (b.pages.some(p => (p.stamps || []).includes(st.id))) bookIds.add(b.id);
      });
    });
    const collapsedGlowHallIds = new Set();
    forEachHall(h => {
      if (h.collapsed && hallHasGlowingContent(h, new Set(), bookIds)) {
        collapsedGlowHallIds.add(h.id);
      }
    });
    return {
      active: true, mode: 'stamp', stamp: st,
      glowOuter: st.color,
      glowCore: '#fff3c4',
      hallIds: new Set(),
      collapsedGlowHallIds,
      bookIds,
      ribbonIds: new Set()
    };
  }
  return empty;
}

function doesPageMatchActiveFilter(page) {
  if (!page) return false;
  if (searchMatches.active && searchMatches.query) {
    const q = searchMatches.query;
    const stampMatch = (page.stamps || []).some(sid => (getStamp(sid)?.label || '').toLowerCase().includes(q));
    return (page.title || '').toLowerCase().includes(q) || (page.body || '').toLowerCase().includes(q) || stampMatch;
  }
  if (activeStampLensId) {
    return (page.stamps || []).includes(activeStampLensId);
  }
  return false;
}

function doesChapterMatchActiveFilter(ch, book) {
  if (!ch) return false;
  if (searchMatches.active && searchMatches.query) {
    if ((ch.title || '').toLowerCase().includes(searchMatches.query)) return true;
  }
  return (book.pages || []).some(p => p.chapterId === ch.id && doesPageMatchActiveFilter(p));
}

function getGlowHopTargets() {
  const glow = getGlowState();
  if (!glow.active) return [];
  const targets = [];
  const seen = new Set();

  layoutCache.halls.forEach(hg => {
    if (glow.hallIds.has(hg.hall.id) || glow.collapsedGlowHallIds.has(hg.hall.id)) {
      const key = 'h:' + hg.hall.id;
      if (!seen.has(key)) {
        seen.add(key);
        const pt = hg.bannerPt;
        targets.push({ kind: 'hall', id: hg.hall.id, label: hg.hall.title, x: pt.x, y: pt.y, scale: 0.9 });
      }
    }
  });
  Object.values(layoutCache.books).forEach(entry => {
    if (glow.bookIds.has(entry.book.id) && !entry.collapsedProxy) {
      const key = 'b:' + entry.book.id;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ kind: 'book', id: entry.book.id, hallId: entry.hall.id, label: entry.book.title, x: entry.x, y: entry.y, scale: 0.98 });
      }
    }
  });
  if (glow.ribbonIds.size > 0) {
    (state.ribbons || []).forEach(rib => {
      if (!glow.ribbonIds.has(rib.id)) return;
      const b1 = layoutCache.books[rib.fromBookId];
      const b2 = layoutCache.books[rib.toBookId];
      if (b1 && b2) {
        targets.push({
          kind: 'ribbon', id: rib.id, label: rib.label || 'Ribbon',
          x: (b1.spineTopX + b2.spineTopX) / 2,
          y: (b1.spineTopY + b2.spineTopY) / 2,
          scale: 0.78
        });
      }
    });
  }
  return targets;
}

function updateSearchHopperUI() {
  const hopper = document.getElementById('search-hopper');
  const countEl = document.getElementById('search-hop-count');
  if (!hopper || !countEl) return;
  const targets = searchMatches.active ? getGlowHopTargets() : [];
  if (searchMatches.active && targets.length > 0) {
    hopper.classList.remove('hidden');
    hopper.classList.add('flex');
    const shown = hopIndex >= 0 && hopIndex < targets.length ? hopIndex + 1 : 0;
    countEl.textContent = shown > 0 ? `${shown}/${targets.length}` : `${targets.length}`;
  } else {
    hopper.classList.add('hidden');
    hopper.classList.remove('flex');
  }
}

function updateStampLensUI() {
  const bar = document.getElementById('stamp-lens-bar');
  if (!bar) return;
  if (!activeStampLensId || searchMatches.active) {
    bar.classList.add('hidden');
    return;
  }
  const st = getStamp(activeStampLensId);
  if (!st) { activeStampLensId = null; bar.classList.add('hidden'); return; }
  const glow = getGlowState();
  const cnt = glow.bookIds.size;
  document.getElementById('stamp-lens-dot').style.background = st.color;
  document.getElementById('stamp-lens-text').textContent = `Stamp Lens: "${st.label}" (${cnt} book${cnt === 1 ? '' : 's'})`;
  document.getElementById('stamp-lens-hop').classList.toggle('hidden', cnt === 0);
  bar.classList.remove('hidden');
}

function setStampLens(stampId) {
  if (activeStampLensId === stampId) activeStampLensId = null;
  else activeStampLensId = stampId || null;
  hopIndex = -1;
  renderMap();
  updateStampLensUI();
  if (selection.type === 'hub' && cardIndexTab === 'stamps') renderInspector();
  if (activeStampLensId) {
    const st = getStamp(activeStampLensId);
    const targets = getGlowHopTargets();
    if (st) showToast(`Glowing books stamped "${st.label}" (${targets.length} match${targets.length === 1 ? '' : 'es'})`);
    if (targets.length > 0) hopToGlowMatch(1);
  }
}

function hopToGlowMatch(delta = 1) {
  const targets = getGlowHopTargets();
  if (!targets.length) return;
  if (hopIndex < 0) hopIndex = delta > 0 ? 0 : targets.length - 1;
  else hopIndex = (hopIndex + delta + targets.length) % targets.length;
  const t = targets[hopIndex];
  flyTo(t.x, t.y, t.scale, 400);
  updateSearchHopperUI();
  showToast(`${hopIndex + 1}/${targets.length}: ${truncate(t.label, 28)}`);
}

function syncSearchMatches() {
  if (searchMatches.active) {
    searchMatches = computeSearchMatches(searchMatches.query);
  }
  if (activeStampLensId && !getStamp(activeStampLensId)) {
    activeStampLensId = null;
  }
}

let historyStack = [];
let historyIndex = -1;

function resetHistory(snap = JSON.stringify(state)) {
  historyStack = [snap];
  historyIndex = 0;
  updateUndoButtons();
}

function pushHistory() {
  const snap = JSON.stringify(state);
  if (historyIndex >= 0 && historyStack[historyIndex] === snap) return;
  historyStack.splice(historyIndex + 1);
  historyStack.push(snap);
  if (historyStack.length > 35) historyStack.shift();
  historyIndex = historyStack.length - 1;
  updateUndoButtons();
}
function updateUndoButtons() {
  document.getElementById('btn-undo').disabled = historyIndex <= 0;
  document.getElementById('btn-redo').disabled = historyIndex >= historyStack.length - 1;
}
function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  state = normalizeLibraryState(JSON.parse(historyStack[historyIndex]));
  persistState(); reconcileViews(); syncSearchMatches(); renderAll(); updateUndoButtons();
  showToast('Undid last change');
}
function redo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  state = normalizeLibraryState(JSON.parse(historyStack[historyIndex]));
  persistState(); reconcileViews(); syncSearchMatches(); renderAll(); updateUndoButtons();
  showToast('Redid change');
}

let quotaWarned = false;
let serverSyncReady = false;
let serverRev = 0;
let serverSaveTimer = null;
let serverSaveInFlight = false;
let serverSaveQueued = false;

function upsertLocalLibraryMeta(id, st, rev) {
  const existing = savedLibraries.find(l => l.id === id);
  const hallCount = Array.isArray(st?.halls) ? st.halls.length : 0;
  let bookCount = 0;
  const walk = (hs) => {
    for (const h of hs || []) {
      bookCount += (h.books || []).length;
      if (h.subHalls) walk(h.subHalls);
    }
  };
  walk(st?.halls);
  const updatedAt = new Date().toISOString();
  if (existing) {
    existing.title = st?.title || 'Untitled Library';
    existing.subtitle = st?.subtitle || '';
    existing.rev = rev || existing.rev;
    existing.updatedAt = updatedAt;
    existing.hallCount = hallCount;
    existing.bookCount = bookCount;
  } else {
    savedLibraries.unshift({
      id,
      title: st?.title || 'Untitled Library',
      subtitle: st?.subtitle || '',
      rev: rev || 1,
      updatedAt,
      hallCount,
      bookCount
    });
  }
  if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
}

async function refreshLibraryList() {
  if (!SERVER_SYNC_SUPPORTED) return savedLibraries;
  try {
    const resp = await fetch('/api/libraries', { cache: 'no-store' });
    if (!resp.ok) return savedLibraries;
    const data = await resp.json();
    if (data && Array.isArray(data.libraries)) {
      savedLibraries = data.libraries;
      if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
    }
  } catch (err) {}
  return savedLibraries;
}

async function flushServerSave(force = false) {
  if (!SERVER_SYNC_SUPPORTED || !serverSyncReady) return;
  if (serverSaveInFlight) { serverSaveQueued = true; return; }
  serverSaveInFlight = true;
  serverSaveQueued = false;
  const saveLibId = activeLibraryId;
  try {
    const resp = await fetch(`/api/state?id=${encodeURIComponent(saveLibId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: saveLibId, baseRev: serverRev, state, force })
    });
    if (resp.status === 409) {
      const conflict = await resp.json().catch(() => null);
      if (conflict && conflict.state && saveLibId === activeLibraryId) {
        const loadNewer = confirm('Another device saved newer changes to this library.\n\nClick OK to load the latest version from the server, or Cancel to choose whether to overwrite.');
        if (loadNewer) {
          serverRev = conflict.rev || serverRev;
          state = normalizeLibraryState(conflict.state);
          try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
          resetHistory();
          upsertLocalLibraryMeta(activeLibraryId, state, serverRev);
          reconcileViews();
          syncSearchMatches();
          renderAll();
          showToast('Synced latest library from server');
        } else {
          const confirmOverwrite = confirm('Are you sure you want to OVERWRITE the newer server version with this device\'s copy?\n\n(A backup of the server version will be saved automatically.)');
          if (confirmOverwrite) {
            serverSaveInFlight = false;
            await flushServerSave(true);
            return;
          }
          showToast('Save paused — refresh or edit again to resolve sync conflict');
        }
      }
    } else if (resp.ok) {
      const data = await resp.json().catch(() => null);
      if (data && typeof data.rev === 'number' && saveLibId === activeLibraryId) {
        serverRev = data.rev;
        upsertLocalLibraryMeta(saveLibId, state, serverRev);
      }
    }
  } catch (err) {
    // Offline or standalone preview — localStorage still holds the state
  } finally {
    serverSaveInFlight = false;
    if (serverSaveQueued) scheduleServerSave(200);
  }
}

function scheduleServerSave(delayMs = 450) {
  if (!SERVER_SYNC_SUPPORTED || !serverSyncReady) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => {
    serverSaveTimer = null;
    flushServerSave(false);
  }, delayMs);
}

async function switchToLibrary(libId) {
  if (!libId) return;
  if (serverSaveTimer) {
    clearTimeout(serverSaveTimer);
    serverSaveTimer = null;
    await flushServerSave(false);
  }
  try {
    const resp = await fetch(`/api/state?id=${encodeURIComponent(libId)}&activate=1`, { cache: 'no-store' });
    if (!resp.ok) {
      showToast('Could not open that library');
      return;
    }
    const data = await resp.json();
    if (!data || !data.state) {
      showToast('Library is empty or missing');
      return;
    }
    setActiveLibraryId(data.id || libId);
    serverRev = typeof data.rev === 'number' ? data.rev : 1;
    state = normalizeLibraryState(data.state);
    try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
    activeStampLensId = null;
    if (typeof clearSearch === 'function') clearSearch(false);
    if (typeof closeOpenBook === 'function') closeOpenBook();
    if (typeof clearSelection === 'function') clearSelection();
    historyStack = [JSON.stringify(state)];
    historyIndex = 0;
    syncSearchMatches();
    renderAll();
    updateUndoButtons();
    if (typeof fitToView === 'function') fitToView(true);
    if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
    showToast(`Switched to "${state.title}"`);
  } catch (err) {
    showToast('Failed to switch library');
  }
}

async function createNewLibrary(templateKey = 'blank', customTitle = null) {
  const tpl = TEMPLATES[templateKey] || TEMPLATES.blank;
  const nextState = normalizeLibraryState(deepClone(tpl));
  if (customTitle && customTitle.trim()) {
    nextState.title = customTitle.trim();
  }
  if (serverSaveTimer) {
    clearTimeout(serverSaveTimer);
    serverSaveTimer = null;
    await flushServerSave(false);
  }
  if (SERVER_SYNC_SUPPORTED && serverSyncReady) {
    try {
      const resp = await fetch('/api/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: nextState })
      });
      if (!resp.ok) throw new Error('Create failed');
      const data = await resp.json();
      setActiveLibraryId(data.id);
      serverRev = data.rev || 1;
      state = nextState;
      try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
      await refreshLibraryList();
    } catch (err) {
      showToast('Could not create library on server');
      return;
    }
  } else {
    const localId = `lib-${Date.now().toString(36)}`;
    setActiveLibraryId(localId);
    state = nextState;
    try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
    upsertLocalLibraryMeta(activeLibraryId, state, 1);
  }
  activeStampLensId = null;
  if (typeof clearSearch === 'function') clearSearch(false);
  if (typeof closeOpenBook === 'function') closeOpenBook();
  if (typeof clearSelection === 'function') clearSelection();
  historyStack = [JSON.stringify(state)];
  historyIndex = 0;
  syncSearchMatches();
  renderAll();
  updateUndoButtons();
  if (typeof fitToView === 'function') fitToView(true);
  showToast(`Created "${state.title}"`);
}

async function deleteSavedLibrary(libId) {
  const target = savedLibraries.find(l => l.id === libId);
  const label = target ? target.title : libId;
  if (!confirm(`Delete library "${label}"?\n\nA backup copy will be kept in /data/backups on the server.`)) return;

  if (libId === activeLibraryId && serverSaveTimer) {
    clearTimeout(serverSaveTimer);
    serverSaveTimer = null;
  }

  try {
    const resp = await fetch(`/api/libraries/${encodeURIComponent(libId)}`, { method: 'DELETE' });
    if (!resp.ok) {
      showToast('Could not delete library');
      return;
    }
    const data = await resp.json();
    try { localStorage.removeItem(getLibStorageKey(libId)); } catch (e) {}
    savedLibraries = Array.isArray(data.libraries) ? data.libraries : savedLibraries.filter(l => l.id !== libId);

    if (libId === activeLibraryId) {
      if (savedLibraries.length > 0) {
        await switchToLibrary(savedLibraries[0].id);
      } else {
        await createNewLibrary('blank', 'My Library');
      }
    } else if (typeof renderLibrariesMenu === 'function') {
      renderLibrariesMenu();
    }
    await refreshBackupList();
    showToast(`Deleted "${label}"`);
  } catch (err) {
    showToast('Failed to delete library');
  }
}

async function refreshBackupList() {
  if (!SERVER_SYNC_SUPPORTED) return savedBackups;
  try {
    const resp = await fetch('/api/backups', { cache: 'no-store' });
    if (!resp.ok) return savedBackups;
    const data = await resp.json();
    if (data && Array.isArray(data.backups)) {
      savedBackups = data.backups;
      if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
    }
  } catch (err) {}
  return savedBackups;
}

async function restoreLibraryFromBackup(backupName) {
  if (!backupName) return;
  if (serverSaveTimer) {
    clearTimeout(serverSaveTimer);
    serverSaveTimer = null;
    await flushServerSave(false);
  }
  try {
    const resp = await fetch(`/api/backups/${encodeURIComponent(backupName)}/restore`, { method: 'POST' });
    if (!resp.ok) {
      showToast('Could not restore backup');
      return;
    }
    const data = await resp.json();
    if (Array.isArray(data.libraries)) savedLibraries = data.libraries;
    if (Array.isArray(data.backups)) savedBackups = data.backups;
    setActiveLibraryId(data.id);
    serverRev = data.rev || 1;
    state = normalizeLibraryState(data.state);
    try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
    activeStampLensId = null;
    if (typeof clearSearch === 'function') clearSearch(false);
    if (typeof closeOpenBook === 'function') closeOpenBook();
    if (typeof clearSelection === 'function') clearSelection();
    historyStack = [JSON.stringify(state)];
    historyIndex = 0;
    syncSearchMatches();
    renderAll();
    updateUndoButtons();
    if (typeof fitToView === 'function') fitToView(true);
    if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
    showToast(`Restored "${state.title}" from backup`);
  } catch (err) {
    showToast('Failed to restore backup');
  }
}

async function permanentlyDeleteBackup(backupName) {
  const target = savedBackups.find(b => b.name === backupName);
  const label = target ? target.title : backupName;
  const countNote = target && target.backupCount > 1 ? `all ${target.backupCount} backups of ` : 'all backups of ';
  if (!confirm(`Permanently delete ${countNote}"${label}"?\n\nThis cannot be undone.`)) return;
  try {
    const url = target && target.libId
      ? `/api/backups/library/${encodeURIComponent(target.libId)}`
      : `/api/backups/${encodeURIComponent(backupName)}`;
    const resp = await fetch(url, { method: 'DELETE' });
    if (!resp.ok) {
      showToast('Could not permanently delete backup');
      return;
    }
    const data = await resp.json();
    savedBackups = Array.isArray(data.backups) ? data.backups : savedBackups.filter(b => b.name !== backupName);
    if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
    showToast(`Permanently deleted backups for "${label}"`);
  } catch (err) {
    showToast('Failed to permanently delete backup');
  }
}

async function permanentlyDeleteSingleBackup(backupName, label = '') {
  if (!backupName) return;
  const desc = label || backupName;
  if (!confirm(`Permanently delete backup snapshot "${desc}"?\n\nOther snapshots for this library will be kept.`)) return;
  try {
    const resp = await fetch(`/api/backups/${encodeURIComponent(backupName)}?single=1`, { method: 'DELETE' });
    if (!resp.ok) {
      showToast('Could not delete backup snapshot');
      return;
    }
    const data = await resp.json();
    if (Array.isArray(data.backups)) savedBackups = data.backups;
    if (typeof renderLibrariesMenu === 'function') renderLibrariesMenu();
    showToast('Deleted backup snapshot');
  } catch (err) {
    showToast('Failed to delete backup snapshot');
  }
}

async function initServerSync() {
  if (!SERVER_SYNC_SUPPORTED) return;
  let loadedFromServer = false;
  try {
    let serverLastActiveId = null;
    try {
      const libsResp = await fetch('/api/libraries', { cache: 'no-store' });
      if (libsResp.ok) {
        const libsData = await libsResp.json();
        if (Array.isArray(libsData.libraries)) savedLibraries = libsData.libraries;
        if (libsData.lastActiveId) serverLastActiveId = libsData.lastActiveId;
      }
    } catch (e) {}

    let targetId = activeLibraryId;
    if (serverLastActiveId && savedLibraries.some(l => l.id === serverLastActiveId)) {
      targetId = serverLastActiveId;
      setActiveLibraryId(targetId);
    } else if (savedLibraries.length > 0 && !savedLibraries.some(l => l.id === targetId)) {
      targetId = savedLibraries[0].id;
      setActiveLibraryId(targetId);
    }

    const resp = await fetch(`/api/state?id=${encodeURIComponent(targetId)}`, { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.id) setActiveLibraryId(data.id);
    if (data && data.state && typeof data.state.title === 'string' && Array.isArray(data.state.halls)) {
      serverRev = typeof data.rev === 'number' ? data.rev : 1;
      state = normalizeLibraryState(data.state);
      loadedFromServer = true;
      serverSyncReady = true;
      openAddRadialHallId = null;
      try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
      resetHistory();
      reconcileViews();
      syncSearchMatches();
      renderAll();
      if (typeof fitToView === 'function') fitToView(false);
      upsertLocalLibraryMeta(activeLibraryId, state, serverRev);
    } else {
      serverSyncReady = true;
      if (!hasCachedInitialState) {
        state = normalizeLibraryState(deepClone(TEMPLATES.creative));
        resetHistory();
        syncSearchMatches();
        renderAll();
        if (typeof fitToView === 'function') fitToView(false);
      }
      serverRev = 0;
      await flushServerSave(true);
      await refreshLibraryList();
    }
  } catch (err) {
    // Only fall back to starter template if we never loaded from server or localStorage,
    // and keep serverSyncReady disabled so an offline/init error can never overwrite server data.
    if (!loadedFromServer) {
      serverSyncReady = false;
      if (!hasCachedInitialState) {
        state = normalizeLibraryState(deepClone(TEMPLATES.creative));
        resetHistory();
        syncSearchMatches();
        renderAll();
        if (typeof fitToView === 'function') fitToView(false);
      }
    }
  }
}

async function checkServerUpdates() {
  if (!SERVER_SYNC_SUPPORTED || !serverSyncReady || serverSaveTimer || serverSaveInFlight) return;
  try {
    const resp = await fetch(`/api/health?id=${encodeURIComponent(activeLibraryId)}`, { cache: 'no-store' });
    if (!resp.ok) return;
    const info = await resp.json();
    if (info && info.id === activeLibraryId && typeof info.rev === 'number' && info.rev > serverRev) {
      const stateResp = await fetch(`/api/state?id=${encodeURIComponent(activeLibraryId)}`, { cache: 'no-store' });
      if (!stateResp.ok) return;
      const data = await stateResp.json();
      if (data && data.state) {
        serverRev = data.rev;
        state = normalizeLibraryState(data.state);
        try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); } catch (e) {}
        resetHistory();
        upsertLocalLibraryMeta(activeLibraryId, state, serverRev);
        reconcileViews();
        syncSearchMatches();
        renderAll();
        showToast('Synced newer changes from another device');
      }
    }
  } catch (err) {}
}

if (SERVER_SYNC_SUPPORTED && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkServerUpdates();
  });
}

function persistState() {
  try { localStorage.setItem(getLibStorageKey(activeLibraryId), JSON.stringify(state)); }
  catch (e) {
    if (!quotaWarned) {
      quotaWarned = true;
      showToast('Browser storage full — relying on server sync / Export (.json)');
    }
  }
  upsertLocalLibraryMeta(activeLibraryId, state, serverRev);
  scheduleServerSave();
}
function commitChange(skipHistory = false) {
  normalizeLibraryState(state);
  persistState();
  if (!skipHistory) pushHistory();
  syncSearchMatches();
  renderAll();
}

function reconcileViews() {
  if (selection.type === 'hall' && !findHallInfo(selection.hallId)) clearSelection();
  if (openBookState.bookId) {
    const found = findOpenBookContainer(openBookState.hallId, openBookState.bookId);
    const book = found?.book;
    if (!book) closeOpenBook();
    else {
      if (!book.chapters.some(c => c.id === openBookState.chapterId)) openBookState.chapterId = book.chapters[0]?.id || null;
      if (openBookState.pageId && !book.pages.some(p => p.id === openBookState.pageId)) {
        const firstInCh = book.pages.find(p => p.chapterId === openBookState.chapterId);
        openBookState.pageId = firstInCh?.id || book.pages[0]?.id || null;
      }
    }
  }
}

// ============================================================
// 3. HOST THEME SYNC (DAYLIGHT / CANDLELIGHT)
// ============================================================
let manualAtmosphere = false;

function detectHostDark() {
  const html = document.documentElement;
  if (html.classList.contains('dark')) return true;
  if (html.classList.contains('light')) return false;
  const bg = getComputedStyle(html).getPropertyValue('--background').trim();
  if (bg) {
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3) return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) < 128;
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyAtmosphere(dark) {
  isCandlelight = dark;
  document.body.classList.toggle('lib-candlelight', dark);
  document.body.classList.toggle('lib-daylight', !dark);
  const icon = document.getElementById('icon-lamp');
  icon.innerHTML = dark
    ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
  renderMap();
}

window.addEventListener('themechange', () => {
  if (!manualAtmosphere) applyAtmosphere(detectHostDark());
});
