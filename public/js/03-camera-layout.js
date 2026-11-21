// ============================================================
// 4. CAMERA & UNIFIED CANVAS POINTER STATE MACHINE
// ============================================================
const cam = { x: 0, y: 0, scale: 0.72 };
let camAnim = null;
let worldBounds = { minX: -720, maxX: 720, minY: -720, maxY: 720 };

const svgEl = document.getElementById('library-svg');
const worldEl = document.getElementById('world-layer');
const sceneEl = document.getElementById('scene-content');
const librarianLayerEl = document.getElementById('librarian-overlay-layer');
const dragOverlayEl = document.getElementById('drag-overlay-layer');
const canvasWrap = document.getElementById('canvas-wrap');

function screenToWorld(clientX, clientY) {
  const rect = canvasWrap.getBoundingClientRect();
  return {
    x: (clientX - rect.left - rect.width / 2 - cam.x) / cam.scale,
    y: (clientY - rect.top - rect.height / 2 - cam.y) / cam.scale
  };
}

let cameraRafId = null;

function applyCamera() {
  if (cameraRafId !== null) {
    cancelAnimationFrame(cameraRafId);
    cameraRafId = null;
  }
  const rect = canvasWrap.getBoundingClientRect();
  const tx = rect.width / 2 + cam.x;
  const ty = rect.height / 2 + cam.y;
  worldEl.setAttribute('transform', `translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${cam.scale.toFixed(4)})`);
  document.getElementById('zoom-readout').textContent = `${Math.round(cam.scale * 100)}%`;
  if (typeof minimapCollapsed === 'undefined' || !minimapCollapsed) {
    updateMinimapViewport();
  }
}

function scheduleApplyCamera() {
  if (cameraRafId !== null) return;
  cameraRafId = requestAnimationFrame(() => {
    cameraRafId = null;
    applyCamera();
  });
}

function flyTo(worldX, worldY, targetScale = null, duration = 420) {
  if (camAnim) cancelAnimationFrame(camAnim);
  const startX = cam.x, startY = cam.y, startS = cam.scale;
  const endS = targetScale !== null ? Math.max(0.22, Math.min(2.2, targetScale)) : cam.scale;
  const endX = -worldX * endS;
  const endY = -worldY * endS;
  const t0 = performance.now();

  function step(now) {
    const p = Math.min(1, (now - t0) / duration);
    const ease = 1 - Math.pow(1 - p, 3);
    cam.x = startX + (endX - startX) * ease;
    cam.y = startY + (endY - startY) * ease;
    cam.scale = startS + (endS - startS) * ease;
    applyCamera();
    if (p < 1) camAnim = requestAnimationFrame(step);
    else camAnim = null;
  }
  camAnim = requestAnimationFrame(step);
}

function fitToView(animate = true) {
  const rect = canvasWrap.getBoundingClientRect();
  const isNarrow = rect.width <= 768;
  const padX = isNarrow ? 36 : 110;
  const padY = isNarrow ? 120 : 120;
  const bw = Math.max(480, worldBounds.maxX - worldBounds.minX);
  const bh = Math.max(480, worldBounds.maxY - worldBounds.minY);
  const cx = (worldBounds.minX + worldBounds.maxX) / 2;
  const cy = (worldBounds.minY + worldBounds.maxY) / 2;
  const targetScale = Math.max(0.24, Math.min(1.0, Math.min((rect.width - padX) / bw, (rect.height - padY) / bh)));
  if (animate) flyTo(cx, cy, targetScale, 460);
  else { cam.scale = targetScale; cam.x = -cx * targetScale; cam.y = -cy * targetScale; applyCamera(); }
}

let pointerMode = 'idle';
let dragMoved = false;
let suppressNextClick = false;
let dragStart = { x: 0, y: 0, camX: 0, camY: 0 };
let angleDrag = null;
let bookDrag = null;
let paperDrag = null;

// Multi-pointer state for 1-finger pan & 2-finger pinch-to-zoom on touchscreens
const activePointers = new Map();
let primaryPointerId = null;
let primaryPointerType = 'mouse';
let pinchStart = null;

function beginPinchGesture() {
  const pts = Array.from(activePointers.values());
  if (pts.length < 2) return;
  dragOverlayEl.innerHTML = '';
  clearCornerDropHighlights();
  canvasWrap.classList.remove('dragging', 'dragging-angle', 'dragging-book');
  canvasWrap.classList.add('pinching');
  sceneEl.querySelectorAll('.is-dragging-source').forEach(el => el.classList.remove('is-dragging-source'));
  angleDrag = null;
  bookDrag = null;
  paperDrag = null;
  const [p1, p2] = pts;
  const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
  pinchStart = {
    dist,
    midX: (p1.x + p2.x) / 2,
    midY: (p1.y + p2.y) / 2,
    camX: cam.x,
    camY: cam.y,
    scale: cam.scale
  };
  pointerMode = 'pinch';
  dragMoved = true;
}

canvasWrap.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }

  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType || 'mouse' });

  if (activePointers.size === 2) {
    beginPinchGesture();
    return;
  }
  if (activePointers.size > 2) return;

  primaryPointerId = e.pointerId;
  primaryPointerType = e.pointerType || 'mouse';
  dragMoved = false;
  dragStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };

  const swivel = e.target.closest('[data-action="drag-hall-angle"]');
  if (swivel) {
    if (e.pointerType === 'mouse') e.preventDefault();
    const hallId = swivel.dataset.hallId;
    const hg = layoutCache.hallMap[hallId];
    if (hg) {
      const parentHg = hg.parentId ? layoutCache.hallMap[hg.parentId] : null;
      angleDrag = { hallId, originX: hg.originX, originY: hg.originY, parentAngle: parentHg ? parentHg.angle : 0, depth: hg.depth };
      pointerMode = 'drag-angle';
      canvasWrap.classList.add('dragging-angle');
      return;
    }
  }

  const spine = e.target.closest('.spine-hit');
  if (spine) {
    if (e.pointerType === 'mouse') e.preventDefault();
    const hallId = spine.dataset.hallId, bookId = spine.dataset.bookId;
    const info = findHallInfo(hallId);
    const book = info?.hall.books.find(b => b.id === bookId);
    if (book) {
      bookDrag = { sourceHallId: hallId, bookId, book, metrics: measureBookSpine(book), dropTarget: null };
      pointerMode = 'maybe-drag-book';
      return;
    }
  }

  if (e.pointerType === 'mouse') e.preventDefault();
  pointerMode = 'pan';
  canvasWrap.classList.add('dragging');
});

function clearCornerDropHighlights() {
  document.getElementById('corner-study-zone')?.classList.remove('corner-drop-active');
  document.getElementById('corner-pile-zone')?.classList.remove('corner-drop-active');
  document.getElementById('corner-recycle-zone')?.classList.remove('recycle-drop-active');
  document.querySelectorAll('.study-drop-active').forEach(el => el.classList.remove('study-drop-active'));
}

function isOverRecycleBin(clientX, clientY) {
  const recZone = document.getElementById('corner-recycle-zone');
  if (!recZone) return false;
  const r = recZone.getBoundingClientRect();
  return clientX >= r.left - 12 && clientX <= r.right + 12 && clientY >= r.top - 24 && clientY <= r.bottom + 12;
}

function findCornerTabletopDropTarget(clientX, clientY) {
  if (isOverRecycleBin(clientX, clientY)) {
    return { kind: 'recycle-bin' };
  }
  const studyZone = document.getElementById('corner-study-zone');
  if (studyZone) {
    const r = studyZone.getBoundingClientRect();
    if (clientX >= r.left - 10 && clientX <= r.right + 10 && clientY >= r.top - 36 && clientY <= r.bottom + 10) {
      return { kind: 'study-table' };
    }
  }
  const pileZone = document.getElementById('corner-pile-zone');
  if (pileZone && bookDrag?.sourceHallId !== CART_HALL_ID) {
    const r = pileZone.getBoundingClientRect();
    if (clientX >= r.left - 10 && clientX <= r.right + 10 && clientY >= r.top - 36 && clientY <= r.bottom + 10) {
      return { kind: 'sorting-pile' };
    }
  }
  return null;
}

function findCanvasBookDropTarget(wx, wy, clientX = null, clientY = null) {
  if (clientX !== null && clientY !== null) {
    const cornerHit = findCornerTabletopDropTarget(clientX, clientY);
    if (cornerHit) return cornerHit;
  }
  for (const hg of layoutCache.halls) {
    for (const bay of hg.bays) {
      const halfW = bay.outerW / 2 + 22, halfH = bay.outerH / 2 + 22;
      if (wx >= bay.x - halfW && wx <= bay.x + halfW && wy >= bay.y - halfH && wy <= bay.y + halfH) {
        const shelfFloorY = bay.y + bay.outerH / 2 - 14;
        const barTopY = shelfFloorY - bay.innerH + 4;
        const hallBooks = hg.hall.books;
        const bayFirstGlobalIdx = bay.items.length > 0 ? hallBooks.findIndex(b => b.id === bay.items[0].book.id) : hallBooks.length;

        let localIdx = bay.items.length;
        let barX = bay.x - bay.innerW / 2 + 12;
        if (bay.items.length > 0) {
          for (let i = 0; i < bay.items.length; i++) {
            const it = bay.items[i];
            const itemWorldX = bay.x + it.cx;
            if (wx < itemWorldX) {
              localIdx = i;
              barX = itemWorldX - it.metrics.w / 2 - SPINE_GAP / 2;
              break;
            }
          }
          if (localIdx === bay.items.length) {
            const last = bay.items[bay.items.length - 1];
            barX = bay.x + last.cx + last.metrics.w / 2 + SPINE_GAP / 2;
          }
        }
        return { kind: 'bay', hallId: hg.hall.id, hallTitle: hg.hall.title, insertIndex: Math.max(0, bayFirstGlobalIdx + localIdx), bay, barX, barTopY, barBottomY: shelfFloorY };
      }
    }
  }
  for (const hg of layoutCache.halls) {
    if (Math.hypot(wx - hg.bannerPt.x, wy - hg.bannerPt.y) < 76) {
      return { kind: 'hall-banner', hallId: hg.hall.id, hallTitle: hg.hall.title, insertIndex: hg.hall.books.length, bannerPt: hg.bannerPt };
    }
  }
  return null;
}

function findPaperDropTarget(wx, wy, clientX, clientY) {
  // 0. Check Wicker Recycling Basket
  if (isOverRecycleBin(clientX, clientY)) {
    return { kind: 'recycle-bin' };
  }
  // 1. Check books stacked on the lower-right Study Table
  const studyBooks = document.querySelectorAll('#corner-study-stack [data-study-stack-book]');
  for (const el of studyBooks) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left - 4 && clientX <= r.right + 4 && clientY >= r.top - 3 && clientY <= r.bottom + 3) {
      return { kind: 'study-book', bookId: el.dataset.studyStackBook, hallId: el.dataset.studyStackHall, el };
    }
  }
  // 2. Check unfiled books in the Sorting Pile
  const pileBooks = document.querySelectorAll('#corner-pile-stack [data-pile-book-id]');
  for (const el of pileBooks) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left - 4 && clientX <= r.right + 4 && clientY >= r.top - 3 && clientY <= r.bottom + 3) {
      return { kind: 'pile-book', bookId: el.dataset.pileBookId, el };
    }
  }
  // 3. If a book is open in #book-modal, check if hovering over the open book spread
  if (openBookState.bookId && openBookState.hallId !== LOOSE_PAPER_MODE_ID) {
    const shellR = bookCoverShell.getBoundingClientRect();
    if (clientX >= shellR.left && clientX <= shellR.right && clientY >= shellR.top && clientY <= shellR.bottom) {
      const elAtPt = document.elementFromPoint(clientX, clientY);
      const chCard = elAtPt?.closest('[data-toc-chapter], [data-cork-chapter], [data-tab-chapter]');
      const chId = chCard?.dataset.tocChapter || chCard?.dataset.corkChapter || chCard?.dataset.tabChapter || openBookState.chapterId;
      return { kind: 'open-book', hallId: openBookState.hallId, bookId: openBookState.bookId, chapterId: chId };
    }
  }
  // 4. Check individual book spines on the 2D map
  for (const entry of Object.values(layoutCache.books)) {
    if (entry.collapsedProxy) continue;
    if (Math.abs(wx - entry.x) <= 22 && Math.abs(wy - entry.y) <= 64) {
      return { kind: 'map-book', hallId: entry.hall.id, bookId: entry.book.id, bookTitle: entry.book.title, x: entry.x, y: entry.y };
    }
  }
  // 5. Check bookshelf bays or hall banners on the 2D map (to bind loose paper into a new book in that hall!)
  const bayOrHall = findCanvasBookDropTarget(wx, wy, null, null);
  if (bayOrHall && (bayOrHall.kind === 'bay' || bayOrHall.kind === 'hall-banner')) {
    return { kind: 'map-hall', ...bayOrHall };
  }
  return null;
}

function renderCanvasPaperDragOverlay(wx, wy) {
  if (!paperDrag) { dragOverlayEl.innerHTML = ''; clearCornerDropHighlights(); return; }
  const { page, dropTarget } = paperDrag;
  clearCornerDropHighlights();
  let targetSvg = '';

  if (dropTarget?.kind === 'recycle-bin') {
    document.getElementById('corner-recycle-zone')?.classList.add('recycle-drop-active');
  } else if (dropTarget?.kind === 'study-book' || dropTarget?.kind === 'pile-book') {
    dropTarget.el?.classList.add('study-drop-active');
  } else if (dropTarget?.kind === 'map-book') {
    targetSvg = `
      <circle cx="${dropTarget.x.toFixed(1)}" cy="${dropTarget.y.toFixed(1)}" r="46" fill="rgba(245,198,99,0.25)" stroke="#f5c663" stroke-width="3.5" stroke-dasharray="7 4" />
      <g transform="translate(${dropTarget.x.toFixed(1)}, ${(dropTarget.y - 68).toFixed(1)})">
        <rect x="-78" y="-12" width="156" height="24" rx="12" fill="#2f2017" stroke="#f5c663" stroke-width="2" />
        <text x="0" y="4" text-anchor="middle" font-size="10" font-weight="800" fill="#fffaf2">File into "${esc(truncate(dropTarget.bookTitle, 16))}"</text>
      </g>
    `;
  } else if (dropTarget?.kind === 'map-hall') {
    const gx = dropTarget.bay ? dropTarget.bay.x : dropTarget.bannerPt.x;
    const gy = dropTarget.bay ? dropTarget.bay.y : dropTarget.bannerPt.y;
    targetSvg = `
      <circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="62" fill="rgba(245,198,99,0.22)" stroke="#f5c663" stroke-width="3.5" stroke-dasharray="8 5" />
      <g transform="translate(${gx.toFixed(1)}, ${(gy - 74).toFixed(1)})">
        <rect x="-86" y="-12" width="172" height="24" rx="12" fill="#2f2017" stroke="#f5c663" stroke-width="2" />
        <text x="0" y="4" text-anchor="middle" font-size="10" font-weight="800" fill="#fffaf2">Bind as New Book in ${esc(truncate(dropTarget.hallTitle, 14))}</text>
      </g>
    `;
  }

  dragOverlayEl.innerHTML = `
    ${targetSvg}
    <g transform="translate(${wx.toFixed(1)}, ${wy.toFixed(1)}) rotate(-5)" opacity="0.95" filter="url(#shelfShadow)">
      <rect x="-46" y="-18" width="92" height="36" rx="5" fill="#fffdf6" stroke="#5a3b22" stroke-width="2.2" />
      <line x1="-36" y1="-6" x2="32" y2="-6" stroke="#c5ad8c" stroke-width="1.4" />
      <line x1="-36" y1="6" x2="22" y2="6" stroke="#c5ad8c" stroke-width="1.4" />
      <text x="0" y="2" text-anchor="middle" font-size="9.5" font-weight="700" font-family="Georgia, serif" fill="#362215">${esc(truncate(page.title || 'Loose Paper', 15))}</text>
    </g>
  `;
}

function renderCanvasBookDragOverlay(wx, wy) {
  if (!bookDrag) { dragOverlayEl.innerHTML = ''; clearCornerDropHighlights(); return; }
  const { book, metrics, dropTarget } = bookDrag;
  const bsw = getSwatch(book.color);
  const ink = isCandlelight ? '#140b06' : '#3c2516';
  let targetSvg = '';

  clearCornerDropHighlights();
  if (dropTarget?.kind === 'recycle-bin') {
    document.getElementById('corner-recycle-zone')?.classList.add('recycle-drop-active');
  } else if (dropTarget?.kind === 'study-table') {
    document.getElementById('corner-study-zone')?.classList.add('corner-drop-active');
  } else if (dropTarget?.kind === 'sorting-pile') {
    document.getElementById('corner-pile-zone')?.classList.add('corner-drop-active');
  } else if (dropTarget?.kind === 'bay') {
    const { bay, barX, barTopY, barBottomY } = dropTarget;
    targetSvg = `
      <rect x="${(bay.x - bay.outerW / 2 - 4).toFixed(1)}" y="${(bay.y - bay.outerH / 2 - 4).toFixed(1)}"
            width="${(bay.outerW + 8).toFixed(1)}" height="${(bay.outerH + 8).toFixed(1)}" rx="18"
            fill="none" stroke="#f5c663" stroke-width="3.5" stroke-dasharray="8 5" opacity="0.9" />
      <line x1="${barX.toFixed(1)}" y1="${barTopY.toFixed(1)}" x2="${barX.toFixed(1)}" y2="${barBottomY.toFixed(1)}"
            stroke="#f5c663" stroke-width="5" stroke-linecap="round" />
      <circle cx="${barX.toFixed(1)}" cy="${barTopY.toFixed(1)}" r="5" fill="#f5c663" stroke="${ink}" stroke-width="1.5" />
      <circle cx="${barX.toFixed(1)}" cy="${barBottomY.toFixed(1)}" r="5" fill="#f5c663" stroke="${ink}" stroke-width="1.5" />
    `;
  } else if (dropTarget?.kind === 'hall-banner') {
    const { bannerPt } = dropTarget;
    targetSvg = `<rect x="${(bannerPt.x - 74).toFixed(1)}" y="${(bannerPt.y - 24).toFixed(1)}" width="148" height="48" rx="16" fill="rgba(245,198,99,0.22)" stroke="#f5c663" stroke-width="3.5" stroke-dasharray="7 4" />`;
  }

  const gw = metrics.w, gh = Math.min(120, metrics.h);
  const hw = gw / 2, hh = gh / 2;
  dragOverlayEl.innerHTML = `
    ${targetSvg}
    <g transform="translate(${wx.toFixed(1)}, ${wy.toFixed(1)}) rotate(-7)" opacity="0.94" filter="url(#shelfShadow)">
      <rect x="${-hw}" y="${-hh}" width="${gw}" height="${gh}" rx="6" fill="${bsw.fill}" stroke="#f5c663" stroke-width="2.6" />
      <text x="0" y="0" transform="rotate(-90)" text-anchor="middle" dominant-baseline="central"
            font-size="10" font-weight="700" font-family="Georgia, serif" fill="#fffaf2"
            stroke="${bsw.deep}" stroke-width="2.2" paint-order="stroke">${esc(truncate(book.title, 18))}</text>
    </g>
  `;
}

window.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType || 'mouse' });
  }

  if (pointerMode === 'pinch') {
    if (activePointers.size >= 2 && pinchStart) {
      const [p1, p2] = Array.from(activePointers.values());
      const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const curMidX = (p1.x + p2.x) / 2;
      const curMidY = (p1.y + p2.y) / 2;
      const rect = canvasWrap.getBoundingClientRect();
      const startRelX = pinchStart.midX - rect.left - rect.width / 2;
      const startRelY = pinchStart.midY - rect.top - rect.height / 2;
      const curRelX = curMidX - rect.left - rect.width / 2;
      const curRelY = curMidY - rect.top - rect.height / 2;
      const newScale = Math.max(0.22, Math.min(2.2, pinchStart.scale * (curDist / pinchStart.dist)));
      const ratio = newScale / pinchStart.scale;
      cam.scale = newScale;
      cam.x = curRelX - (startRelX - pinchStart.camX) * ratio;
      cam.y = curRelY - (startRelY - pinchStart.camY) * ratio;
      scheduleApplyCamera();
    }
    return;
  }

  if (pointerMode === 'idle') return;
  if (primaryPointerId !== null && e.pointerId !== primaryPointerId) return;

  const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
  const isTouch = primaryPointerType === 'touch' || e.pointerType === 'touch';
  const panThreshold = isTouch ? 12 : 5;
  const angleThreshold = isTouch ? 8 : 3;
  const bookThreshold = isTouch ? 18 : 7;

  if (pointerMode === 'pan') {
    if (Math.hypot(dx, dy) > panThreshold) dragMoved = true;
    if (dragMoved) { cam.x = dragStart.camX + dx; cam.y = dragStart.camY + dy; scheduleApplyCamera(); }
    return;
  }

  if (pointerMode === 'drag-angle' && angleDrag) {
    if (Math.hypot(dx, dy) > angleThreshold) dragMoved = true;
    if (!dragMoved) return;
    const pt = screenToWorld(e.clientX, e.clientY);
    const absAngle = Math.atan2(pt.y - angleDrag.originY, pt.x - angleDrag.originX);
    const info = findHallInfo(angleDrag.hallId);
    if (info) {
      if (angleDrag.depth === 0) info.hall.customAngle = wrapAngle(absAngle);
      else info.hall.customAngle = Math.max(-2.15, Math.min(2.15, wrapAngle(absAngle - angleDrag.parentAngle)));
      renderMap();
      const deg = Math.round((info.hall.customAngle * 180) / Math.PI);
      const hg = layoutCache.hallMap[angleDrag.hallId];
      if (hg) {
        dragOverlayEl.innerHTML = `
          <line x1="${angleDrag.originX.toFixed(1)}" y1="${angleDrag.originY.toFixed(1)}"
                x2="${hg.endPt.x.toFixed(1)}" y2="${hg.endPt.y.toFixed(1)}"
                stroke="#f5c663" stroke-width="2.2" stroke-dasharray="6 5" opacity="0.8" />
          <g transform="translate(${(hg.endPt.x + 28).toFixed(1)}, ${(hg.endPt.y - 26).toFixed(1)})">
            <rect x="-28" y="-12" width="56" height="24" rx="12" fill="#2f2017" stroke="#f5c663" stroke-width="2" />
            <text x="0" y="4" text-anchor="middle" font-size="11" font-weight="800" fill="#fffaf2">${deg}&deg;</text>
          </g>
        `;
      }
    }
    return;
  }

  if (pointerMode === 'maybe-drag-book' && bookDrag) {
    if (Math.hypot(dx, dy) > bookThreshold) {
      pointerMode = 'drag-book';
      dragMoved = true;
      canvasWrap.classList.add('dragging-book');
      sceneEl.querySelector(`.spine-hit[data-book-id="${bookDrag.bookId}"]`)?.classList.add('is-dragging-source');
    } else return;
  }

  if (pointerMode === 'drag-book' && bookDrag) {
    bookDrag.lastClientX = e.clientX;
    bookDrag.lastClientY = e.clientY;
    if (!bookDrag.rafId) {
      bookDrag.rafId = requestAnimationFrame(() => {
        if (!bookDrag) return;
        bookDrag.rafId = null;
        const pt = screenToWorld(bookDrag.lastClientX, bookDrag.lastClientY);
        bookDrag.dropTarget = findCanvasBookDropTarget(pt.x, pt.y, bookDrag.lastClientX, bookDrag.lastClientY);
        renderCanvasBookDragOverlay(pt.x, pt.y);
      });
    }
    return;
  }

  if (pointerMode === 'maybe-drag-paper' && paperDrag) {
    if (Math.hypot(dx, dy) > bookThreshold) {
      pointerMode = 'drag-paper';
      dragMoved = true;
      canvasWrap.classList.add('dragging-book');
    } else return;
  }

  if (pointerMode === 'drag-paper' && paperDrag) {
    paperDrag.lastClientX = e.clientX;
    paperDrag.lastClientY = e.clientY;
    if (!paperDrag.rafId) {
      paperDrag.rafId = requestAnimationFrame(() => {
        if (!paperDrag) return;
        paperDrag.rafId = null;
        const pt = screenToWorld(paperDrag.lastClientX, paperDrag.lastClientY);
        paperDrag.dropTarget = findPaperDropTarget(pt.x, pt.y, paperDrag.lastClientX, paperDrag.lastClientY);
        renderCanvasPaperDragOverlay(pt.x, pt.y);
      });
    }
  }
});

window.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);

  if (pointerMode === 'pinch') {
    if (activePointers.size === 1) {
      const [remId, remPt] = Array.from(activePointers.entries())[0];
      primaryPointerId = remId;
      primaryPointerType = remPt.pointerType || 'touch';
      dragStart = { x: remPt.x, y: remPt.y, camX: cam.x, camY: cam.y };
      pinchStart = null;
      pointerMode = 'pan';
      dragMoved = true;
      canvasWrap.classList.remove('pinching');
      canvasWrap.classList.add('dragging');
    } else if (activePointers.size === 0) {
      pinchStart = null;
      primaryPointerId = null;
      pointerMode = 'idle';
      canvasWrap.classList.remove('dragging', 'pinching');
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 80);
    }
    return;
  }

  if (pointerMode === 'idle') return;
  if (primaryPointerId !== null && e.pointerId !== primaryPointerId) return;
  primaryPointerId = null;

  if (pointerMode === 'drag-angle' && angleDrag) {
    dragOverlayEl.innerHTML = '';
    canvasWrap.classList.remove('dragging-angle');
    if (dragMoved) { suppressNextClick = true; setTimeout(() => { suppressNextClick = false; }, 60); commitChange(); }
    angleDrag = null; pointerMode = 'idle'; return;
  }
  if (pointerMode === 'drag-paper' && paperDrag) {
    dragOverlayEl.innerHTML = '';
    clearCornerDropHighlights();
    canvasWrap.classList.remove('dragging-book');
    suppressNextClick = true; setTimeout(() => { suppressNextClick = false; }, 60);
    const { cartPageId, dropTarget } = paperDrag;
    if (dropTarget?.kind === 'recycle-bin') {
      recycleCartPage(cartPageId);
    } else if (dropTarget?.kind === 'open-book') {
      fileCartPageIntoBook(cartPageId, dropTarget.bookId, dropTarget.chapterId, true);
    } else if (dropTarget?.kind === 'study-book' || dropTarget?.kind === 'map-book' || dropTarget?.kind === 'pile-book') {
      fileCartPageIntoBook(cartPageId, dropTarget.bookId);
    } else if (dropTarget?.kind === 'map-hall') {
      promoteCartPageIntoHall(cartPageId, dropTarget.hallId, dropTarget.insertIndex);
    }
    paperDrag = null; pointerMode = 'idle'; return;
  }
  if (pointerMode === 'maybe-drag-paper') { paperDrag = null; pointerMode = 'idle'; return; }
  if (pointerMode === 'drag-book' && bookDrag) {
    dragOverlayEl.innerHTML = '';
    clearCornerDropHighlights();
    canvasWrap.classList.remove('dragging-book');
    suppressNextClick = true; setTimeout(() => { suppressNextClick = false; }, 60);
    const { sourceHallId, bookId, dropTarget } = bookDrag;
    if (dropTarget?.kind === 'recycle-bin') {
      recycleBook(sourceHallId, bookId);
    } else if (dropTarget?.kind === 'study-table') {
      if (sourceHallId === CART_HALL_ID) {
        const firstHall = state.halls[0];
        if (firstHall) {
          shelveCartBook(bookId, firstHall.id, true);
          togglePinBook(bookId, true);
        } else {
          showToast('Create a Hall first before stacking on the Study Table');
        }
      } else {
        togglePinBook(bookId, true);
      }
    } else if (dropTarget?.kind === 'sorting-pile') {
      moveBookToCart(sourceHallId, bookId);
    } else if (dropTarget) {
      if (sourceHallId === CART_HALL_ID) {
        shelveCartBookAt(bookId, dropTarget.hallId, dropTarget.insertIndex);
      } else {
        reorderOrMoveBook(sourceHallId, bookId, dropTarget.hallId, dropTarget.insertIndex);
      }
    } else renderMap();
    bookDrag = null; pointerMode = 'idle'; return;
  }
  if (pointerMode === 'maybe-drag-book') { bookDrag = null; pointerMode = 'idle'; return; }
  if (pointerMode === 'pan') {
    canvasWrap.classList.remove('dragging');
    if (dragMoved) { suppressNextClick = true; setTimeout(() => { suppressNextClick = false; }, 60); }
    pointerMode = 'idle';
  }
});

window.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (pointerMode === 'pinch' && activePointers.size >= 2) return;
  if (pointerMode === 'idle') return;
  dragOverlayEl.innerHTML = '';
  clearCornerDropHighlights();
  canvasWrap.classList.remove('dragging', 'pinching', 'dragging-angle', 'dragging-book');
  angleDrag = null;
  bookDrag = null;
  paperDrag = null;
  pinchStart = null;
  primaryPointerId = null;
  pointerMode = 'idle';
});

// Allow dragging a Study Table book (study-stack) or Open Book page (page) onto the 2D library map!
canvasWrap.addEventListener('dragover', (e) => {
  if (!listDrag || (listDrag.type !== 'study-stack' && listDrag.type !== 'page')) return;
  e.preventDefault();
});
canvasWrap.addEventListener('drop', (e) => {
  if (!listDrag) return;
  if (listDrag.type === 'study-stack') {
    e.preventDefault();
    const draggedBookId = listDrag.id;
    listDrag = null;
    clearDropMarkers(document);
    clearCornerDropHighlights();
    const pt = screenToWorld(e.clientX, e.clientY);
    const dropTarget = findCanvasBookDropTarget(pt.x, pt.y, null, null);
    const entry = findBookEntry(draggedBookId);
    if (entry && dropTarget && (dropTarget.kind === 'bay' || dropTarget.kind === 'hall-banner') && dropTarget.hallId !== entry.hall.id) {
      reorderOrMoveBook(entry.hall.id, draggedBookId, dropTarget.hallId, dropTarget.insertIndex);
    }
    togglePinBook(draggedBookId, false);
  } else if (listDrag.type === 'page') {
    const pt = screenToWorld(e.clientX, e.clientY);
    for (const entry of Object.values(layoutCache.books)) {
      if (entry.collapsedProxy) continue;
      if (Math.abs(pt.x - entry.x) <= 24 && Math.abs(pt.y - entry.y) <= 66 && entry.book.id !== listDrag.bookId) {
        e.preventDefault();
        const { hallId: fHallId, bookId: fBookId, id: fPageId } = listDrag;
        listDrag = null;
        clearDropMarkers(document);
        clearCornerDropHighlights();
        moveBookPageToAnotherBook(fHallId, fBookId, fPageId, entry.book.id);
        return;
      }
    }
  }
});

canvasWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
  const rect = canvasWrap.getBoundingClientRect();
  const mx = e.clientX - rect.left - rect.width / 2;
  const my = e.clientY - rect.top - rect.height / 2;
  const factor = Math.exp(-e.deltaY * 0.0014);
  const newScale = Math.max(0.22, Math.min(2.2, cam.scale * factor));
  const ratio = newScale / cam.scale;
  cam.x = mx - (mx - cam.x) * ratio;
  cam.y = my - (my - cam.y) * ratio;
  cam.scale = newScale;
  applyCamera();
}, { passive: false });
window.addEventListener('resize', applyCamera);

// ============================================================
// 5. DYNAMIC BOOK SPINE SIZING & RECURSIVE SUB-HALL LAYOUT
// ============================================================
function splitBalancedLines(text, numLines) {
  const clean = (text || 'Untitled').trim().replace(/\s+/g, ' ');
  if (numLines <= 1) return [clean];
  const words = clean.split(' ');
  if (words.length === 1) {
    const chunk = Math.ceil(clean.length / numLines);
    const out = [];
    for (let i = 0; i < clean.length; i += chunk) out.push(clean.slice(i, i + chunk));
    return out;
  }
  if (numLines === 2) {
    let bestIdx = 1, bestScore = Infinity;
    for (let i = 1; i < words.length; i++) {
      const l1 = words.slice(0, i).join(' ').length;
      const l2 = words.slice(i).join(' ').length;
      const score = Math.max(l1, l2) + Math.abs(l1 - l2) * 0.15;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }
    return [words.slice(0, bestIdx).join(' '), words.slice(bestIdx).join(' ')];
  }
  const target = Math.ceil(clean.length / numLines) + 1;
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > target && lines.length < numLines - 1) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function measureBookSpine(book) {
  const clean = (book.title || 'Untitled').trim() || 'Untitled';
  const len = clean.length;
  let numLines = 1;
  if (len > 36) numLines = 3;
  else if (len > 17) numLines = 2;

  const lines = splitBalancedLines(clean, numLines);
  const longest = Math.max(...lines.map(l => l.length));
  const pageBonus = Math.min(4, Math.max(0, (book.pages?.length || 1) - 2) * 1.2);
  const baseW = numLines === 1 ? 24 : (numLines === 2 ? 36 : 48);
  const w = Math.round(baseW + pageBonus);
  const h = Math.round(Math.max(88, longest * 6.35 + 42));
  return { lines, numLines, w, h };
}

function packBooksIntoBays(books) {
  const measured = books.map(book => ({ book, metrics: measureBookSpine(book) }));
  const bays = [];
  let curItems = [], curW = 0;

  for (const item of measured) {
    const needed = curItems.length === 0 ? item.metrics.w : SPINE_GAP + item.metrics.w;
    if (curItems.length > 0 && (curW + needed > MAX_BAY_INNER_W || curItems.length >= MAX_BOOKS_PER_BAY)) {
      bays.push(curItems); curItems = [item]; curW = item.metrics.w;
    } else { curItems.push(item); curW += needed; }
  }
  if (curItems.length > 0 || bays.length === 0) bays.push(curItems);

  return bays.map((items, bayIdx) => {
    const isLastBay = bayIdx === bays.length - 1;
    const totalBooksW = items.reduce((sum, it, idx) => sum + it.metrics.w + (idx > 0 ? SPINE_GAP : 0), 0);
    const maxBookH = items.reduce((m, it) => Math.max(m, it.metrics.h), 88);
    const ghostW = 22;
    const bookendSpace = items.length > 0 ? 11 : 0;
    const innerW = Math.max(170, totalBooksW + (isLastBay ? bookendSpace + ghostW + 14 : 18));
    const hasInlineAddSlot = isLastBay && (totalBooksW + bookendSpace + ghostW + 12 <= Math.max(MAX_BAY_INNER_W + 14, innerW));
    const innerH = Math.max(106, maxBookH + 18);

    let cursorX = -innerW / 2 + 10;
    const positioned = items.map((it) => {
      const cx = cursorX + it.metrics.w / 2;
      cursorX += it.metrics.w + SPINE_GAP;
      return { ...it, cx };
    });

    const bookendX = positioned.length > 0 ? (cursorX - SPINE_GAP + 1.5) : null;
    const addSlotX = hasInlineAddSlot ? (cursorX + (positioned.length > 0 ? 11 : 0) + ghostW / 2) : null;

    return {
      bayIdx, isLastBay, items: positioned,
      innerW, innerH, outerW: innerW + 24, outerH: innerH + 40,
      bookendX, addSlotX, totalBooksW
    };
  });
}

let layoutCache = { halls: [], hallMap: {}, books: {} };

function computeLayout() {
  const cache = { halls: [], hallMap: {}, books: {} };
  let minX = -HUB_RADIUS - 85, maxX = HUB_RADIUS + 85;
  let minY = -HUB_RADIUS - 85, maxY = HUB_RADIUS + 85;

  function includePt(x, y, padX = 110, padY = 100) {
    if (x - padX < minX) minX = x - padX;
    if (x + padX > maxX) maxX = x + padX;
    if (y - padY < minY) minY = y - padY;
    if (y + padY > maxY) maxY = y + padY;
  }

  function subtreeWeight(hall) {
    if (hall.collapsed) return 0.62;
    const bays = packBooksIntoBays(hall.books);
    let w = 1 + (bays.length - 1) * 0.25;
    for (const sub of hall.subHalls || []) w += 0.42 + subtreeWeight(sub) * 0.28;
    return w;
  }

  function registerCollapsedBookProxies(hall, anchorPt) {
    (hall.books || []).forEach(b => {
      cache.books[b.id] = {
        book: b, hall, bayGeom: { x: anchorPt.x, y: anchorPt.y },
        x: anchorPt.x, y: anchorPt.y,
        spineTopX: anchorPt.x, spineTopY: anchorPt.y,
        collapsedProxy: true
      };
    });
    (hall.subHalls || []).forEach(sub => registerCollapsedBookProxies(sub, anchorPt));
  }

  function layoutBranch(hall, originX, originY, angle, depth, branchIdx, parentId) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const perpX = -sin, perpY = cos;
    const bendDir = ((branchIdx + depth) % 2 === 0 ? 1 : -1);
    const bendAmp = hall.collapsed ? 0 : (depth === 0 ? 14 * bendDir : 9 * bendDir);

    const rStart = depth === 0 ? HUB_RADIUS - 12 : -4;
    const halfWidth = depth === 0 ? 54 : Math.max(36, 44 - (depth - 1) * 4);
    const rugHalf = depth === 0 ? 22 : Math.max(14, 18 - (depth - 1) * 2);

    if (hall.collapsed) {
      const rEnd = depth === 0 ? HUB_RADIUS + 108 : 102;
      const spineAt = (t) => {
        const r = rStart + (rEnd - rStart) * t;
        return { x: originX + cos * r, y: originY + sin * r };
      };
      const bannerPt = spineAt(0.7);
      const endPt = spineAt(1);
      const junctionPt = spineAt(0.96);
      const swivelPt = { x: endPt.x + cos * 22, y: endPt.y + sin * 22 };

      includePt(endPt.x, endPt.y, 90, 90);
      includePt(swivelPt.x, swivelPt.y, 45, 45);

      const hallGeom = {
        hall, depth, parentId, originX, originY,
        angle, cos, sin, perpX, perpY,
        rStart, rEnd, halfWidth, rugHalf,
        spineAt, bannerPt, endPt, junctionPt, swivelPt,
        addBookPt: null, addSubPt: null, bays: [], collapsed: true
      };
      cache.halls.push(hallGeom);
      cache.hallMap[hall.id] = hallGeom;
      registerCollapsedBookProxies(hall, bannerPt);
      return;
    }

    const packedBays = packBooksIntoBays(hall.books);
    const bannerDist = depth === 0 ? HUB_RADIUS + 68 : 62;

    const bayRadii = [];
    let rCursor = bannerDist + 56;
    packedBays.forEach((pb, i) => {
      const halfDiag = Math.max(pb.outerH * 0.56, pb.outerW * 0.34);
      const rBay = rCursor + halfDiag + (i === 0 ? 14 : 26);
      bayRadii.push(rBay);
      rCursor = rBay + halfDiag + 26;
    });

    const rEnd = Math.max(rCursor + 48, rStart + 220);

    function spineAt(t) {
      const r = rStart + (rEnd - rStart) * t;
      const curve = 4 * t * (1 - t) * bendAmp;
      return { x: originX + cos * r + perpX * curve, y: originY + sin * r + perpY * curve };
    }

    const tBanner = Math.min(0.45, Math.max(0.08, (bannerDist - rStart) / (rEnd - rStart)));
    const bannerPt = spineAt(tBanner);
    const endPt = spineAt(1);
    const junctionPt = spineAt(0.96);

    const hasSubs = (hall.subHalls?.length || 0) > 0;
    const swivelPt = hasSubs
      ? { x: junctionPt.x - perpX * (halfWidth + 14), y: junctionPt.y - perpY * (halfWidth + 14) }
      : { x: endPt.x + cos * 16, y: endPt.y + sin * 16 };

    const addBookPt = hasSubs ? null : { x: endPt.x + cos * 50 - perpX * 28, y: endPt.y + sin * 50 - perpY * 28 };
    const addSubPt = hasSubs ? { x: junctionPt.x, y: junctionPt.y } : { x: endPt.x + cos * 50 + perpX * 28, y: endPt.y + sin * 50 + perpY * 28 };

    includePt(endPt.x, endPt.y, 95, 95);
    includePt(swivelPt.x, swivelPt.y, 45, 45);
    if (addBookPt) includePt(addBookPt.x, addBookPt.y, 45, 45);
    includePt(addSubPt.x, addSubPt.y, 45, 45);

    const hallGeom = {
      hall, depth, parentId, originX, originY,
      angle, cos, sin, perpX, perpY,
      rStart, rEnd, halfWidth, rugHalf,
      spineAt, bannerPt, endPt, junctionPt, swivelPt,
      addBookPt, addSubPt, bays: [], collapsed: false
    };

    packedBays.forEach((pb, i) => {
      const tBay = Math.min(0.84, Math.max(0.24, (bayRadii[i] - rStart) / (rEnd - rStart)));
      const base = spineAt(tBay);
      const stagger = packedBays.length === 1 ? 0 : ((i % 2 === 0 ? -1 : 1) * 42);
      const bx = base.x + perpX * stagger, by = base.y + perpY * stagger;
      const bayGeom = { ...pb, hall, x: bx, y: by, anchorX: base.x, anchorY: base.y, stagger };

      const shelfFloorY = by + pb.outerH / 2 - 14;
      pb.items.forEach(it => {
        cache.books[it.book.id] = {
          book: it.book,
          hall,
          bayGeom,
          x: bx + it.cx,
          y: by,
          spineTopX: bx + it.cx,
          spineTopY: shelfFloorY - it.metrics.h,
          collapsedProxy: false
        };
      });

      includePt(bx, by, pb.outerW / 2 + 28, pb.outerH / 2 + 36);
      hallGeom.bays.push(bayGeom);
    });

    cache.halls.push(hallGeom);
    cache.hallMap[hall.id] = hallGeom;

    const subs = hall.subHalls || [];
    const m = subs.length;
    if (m > 0) {
      let defaultOffsets = [];
      if (m === 1) defaultOffsets = [(branchIdx % 2 === 0 ? 1 : -1) * 0.72];
      else if (m === 2) defaultOffsets = [-0.78, 0.78];
      else if (m === 3) defaultOffsets = [-1.04, 0, 1.04];
      else {
        const span = Math.min(2.35, (m - 1) * 0.62);
        for (let k = 0; k < m; k++) defaultOffsets.push(-span / 2 + (k / (m - 1)) * span);
      }
      subs.forEach((subHall, subIdx) => {
        const offset = (typeof subHall.customAngle === 'number') ? subHall.customAngle : defaultOffsets[subIdx];
        layoutBranch(subHall, junctionPt.x, junctionPt.y, angle + offset, depth + 1, subIdx, hall.id);
      });
    }
  }

  const rootHalls = state.halls;
  if (rootHalls.length > 0) {
    const weights = rootHalls.map(h => subtreeWeight(h));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const startOffset = rootHalls.length === 4 ? -Math.PI * 0.75 : -Math.PI / 2;
    let cursorAngle = startOffset;
    rootHalls.forEach((hall, hIdx) => {
      const wedge = (weights[hIdx] / totalW) * Math.PI * 2;
      const autoAngle = cursorAngle + wedge / 2;
      cursorAngle += wedge;
      const angle = (typeof hall.customAngle === 'number') ? hall.customAngle : autoAngle;
      layoutBranch(hall, 0, 0, angle, 0, hIdx, null);
    });
  }

  layoutCache = cache;
  worldBounds = { minX, maxX, minY, maxY };
  return cache;
}
