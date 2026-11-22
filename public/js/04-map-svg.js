// ============================================================
// 6. 2D STORYBOOK SVG RENDERER (INCLUDING SILK CROSS-REF RIBBONS!)
// ============================================================
function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1).trimEnd() + '…' : str;
}
function wrapLines(text, maxChars, maxLines = 2) {
  const words = (text || '').trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const joined = lines.join(' ');
    if (joined.length < (text || '').trim().length && !lines[maxLines - 1].endsWith('…')) {
      lines[maxLines - 1] = truncate(lines[maxLines - 1], maxChars);
    }
  }
  return lines;
}

function renderHallFloorSVG(hg, ink, woodPattern, wallColor, wallHighlight, glow) {
  const { spineAt, perpX, perpY, cos, sin, halfWidth, rugHalf, hall, depth, junctionPt, collapsed, endPt } = hg;
  const sw = getSwatch(hall.color);
  const isSel = selection.type === 'hall' && selection.hallId === hall.id;
  const isGlowMatch = glow.active && (glow.hallIds.has(hall.id) || glow.collapsedGlowHallIds.has(hall.id));
  const glowOuter = glow.glowOuter;
  const glowCore = glow.glowCore;
  const hasSubs = !collapsed && (hall.subHalls?.length || 0) > 0;

  const steps = collapsed ? 6 : 12;
  const leftPts = [], rightPts = [], inLeftPts = [], inRightPts = [];
  const rugLeft = [], rugRight = [];
  const wallThick = depth === 0 ? 8 : 6.5;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = spineAt(t);
    const flare = collapsed ? (t < 0.2 ? 5 * (1 - t / 0.2) : 0) : (t < 0.14 ? 7 * (1 - t / 0.14) : (t > 0.86 ? 8 * ((t - 0.86) / 0.14) : 0));
    const w = halfWidth + flare;
    const wi = w - wallThick;
    leftPts.push([p.x + perpX * w, p.y + perpY * w]);
    rightPts.push([p.x - perpX * w, p.y - perpY * w]);
    inLeftPts.push([p.x + perpX * wi, p.y + perpY * wi]);
    inRightPts.push([p.x - perpX * wi, p.y - perpY * wi]);
    if (t >= 0.03 && t <= 0.93) {
      rugLeft.push([p.x + perpX * rugHalf, p.y + perpY * rugHalf]);
      rugRight.push([p.x - perpX * rugHalf, p.y - perpY * rugHalf]);
    }
  }

  function buildCorridorPath(lPts, rPts, tipDist) {
    const end = spineAt(1);
    const tip = [end.x + cos * tipDist, end.y + sin * tipDist];
    const rEnd = rPts[rPts.length - 1];
    let d = `M ${lPts[0][0].toFixed(1)} ${lPts[0][1].toFixed(1)} `;
    for (let i = 1; i < lPts.length; i++) d += `L ${lPts[i][0].toFixed(1)} ${lPts[i][1].toFixed(1)} `;
    d += `Q ${tip[0].toFixed(1)} ${tip[1].toFixed(1)} ${rEnd[0].toFixed(1)} ${rEnd[1].toFixed(1)} `;
    for (let i = rPts.length - 2; i >= 0; i--) d += `L ${rPts[i][0].toFixed(1)} ${rPts[i][1].toFixed(1)} `;
    return d + 'Z';
  }

  const hallPath = buildCorridorPath(leftPts, rightPts, collapsed ? 18 : (hasSubs ? 22 : 36));
  const innerHallPath = buildCorridorPath(inLeftPts, inRightPts, collapsed ? 10 : (hasSubs ? 14 : 26));

  let rugPath = `M ${rugLeft[0][0].toFixed(1)} ${rugLeft[0][1].toFixed(1)} `;
  for (let i = 1; i < rugLeft.length; i++) rugPath += `L ${rugLeft[i][0].toFixed(1)} ${rugLeft[i][1].toFixed(1)} `;
  for (let i = rugRight.length - 1; i >= 0; i--) rugPath += `L ${rugRight[i][0].toFixed(1)} ${rugRight[i][1].toFixed(1)} `;
  rugPath += 'Z';

  const pMid0 = spineAt(0.06), pMidC = spineAt(0.5), pMid1 = spineAt(0.9);
  const spineCurvePath = `M ${pMid0.x.toFixed(1)} ${pMid0.y.toFixed(1)} Q ${pMidC.x.toFixed(1)} ${pMidC.y.toFixed(1)} ${pMid1.x.toFixed(1)} ${pMid1.y.toFixed(1)}`;

  const entPt = spineAt(0.05);
  const pilL = [entPt.x + perpX * (halfWidth + 4), entPt.y + perpY * (halfWidth + 4)];
  const pilR = [entPt.x - perpX * (halfWidth + 4), entPt.y - perpY * (halfWidth + 4)];
  const pilRSize = depth === 0 ? 10.5 : 8;

  const rLastL = rugLeft[rugLeft.length - 1], rLastR = rugRight[rugRight.length - 1];
  let tassels = '';
  if (!hasSubs && !collapsed) {
    for (let k = 0; k <= 4; k++) {
      const f = k / 4;
      const tx = rLastL[0] + (rLastR[0] - rLastL[0]) * f;
      const ty = rLastL[1] + (rLastR[1] - rLastL[1]) * f;
      tassels += `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(tx + cos * 7).toFixed(1)}" y2="${(ty + sin * 7).toFixed(1)}" stroke="${sw.rugEdge}" stroke-width="1.8" stroke-linecap="round" />`;
    }
  }

  const lanternGlow = isCandlelight
    ? `<circle cx="${pilL[0].toFixed(1)}" cy="${pilL[1].toFixed(1)}" r="24" fill="url(#lanternGrad)" class="lantern-halo" />
       <circle cx="${pilR[0].toFixed(1)}" cy="${pilR[1].toFixed(1)}" r="24" fill="url(#lanternGrad)" class="lantern-halo" />`
    : '';

  const closedDoorArch = collapsed
    ? `
      <g transform="translate(${endPt.x.toFixed(1)}, ${endPt.y.toFixed(1)}) rotate(${((hg.angle * 180) / Math.PI).toFixed(1)})">
        <rect x="-8" y="${-(halfWidth - 6)}" width="16" height="${(halfWidth - 6) * 2}" rx="6" fill="${sw.deep}" stroke="${ink}" stroke-width="2.2" />
        <line x1="0" y1="${-(halfWidth - 10)}" x2="0" y2="${halfWidth - 10}" stroke="${sw.rugEdge}" stroke-width="1.6" stroke-dasharray="4 3" opacity="0.85" />
        <circle cx="3" cy="-7" r="2.6" fill="#f5c663" stroke="${ink}" stroke-width="1" />
        <circle cx="3" cy="7" r="2.6" fill="#f5c663" stroke="${ink}" stroke-width="1" />
      </g>
    `
    : '';

  const junctionLanding = hasSubs
    ? `
      <g transform="translate(${junctionPt.x.toFixed(1)}, ${junctionPt.y.toFixed(1)})">
        ${isGlowMatch ? `<circle r="${halfWidth + 13}" fill="none" stroke="${glowOuter}" stroke-width="9" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
        <circle r="${halfWidth + 10}" fill="${wallColor}" stroke="${isGlowMatch ? glowCore : ink}" stroke-width="${isGlowMatch ? 3.2 : 2.6}" />
        <circle r="${halfWidth + 2}" fill="url(#${woodPattern})" stroke="${wallHighlight}" stroke-width="1.6" />
        <circle r="${rugHalf + 11}" fill="${sw.fill}" stroke="${sw.deep}" stroke-width="1.8" />
        <circle r="${rugHalf + 4}" fill="none" stroke="${sw.rugEdge}" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.85" />
      </g>
    `
    : '';

  return `
    <g class="hall-corridor">
      <path d="${hallPath}" fill="#1f1208" opacity="${isCandlelight ? 0.44 : 0.13}" transform="translate(0, 6)" />
      ${isGlowMatch ? `<path d="${hallPath}" fill="none" stroke="${glowOuter}" stroke-width="12" stroke-linejoin="round" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
      <path d="${hallPath}" fill="${wallColor}" stroke="${isGlowMatch ? glowCore : ink}" stroke-width="${isGlowMatch ? 4.2 : (isSel ? 4 : 2.8)}" stroke-linejoin="round" />
      <path d="${innerHallPath}" fill="url(#${woodPattern})" stroke="${wallHighlight}" stroke-width="1.6" stroke-linejoin="round" />
      ${isGlowMatch ? `<path d="${hallPath}" fill="none" stroke="${glowCore}" stroke-width="3.6" stroke-linejoin="round" class="search-glow-aura" />` : ''}
      ${isSel ? `<path d="${hallPath}" fill="none" stroke="${sw.accent}" stroke-width="3.2" stroke-dasharray="9 6" opacity="0.9" />` : ''}

      <path d="${rugPath}" fill="${sw.fill}" stroke="${sw.deep}" stroke-width="1.8" stroke-linejoin="round" />
      <path d="${spineCurvePath}" fill="none" stroke="${sw.rugEdge}" stroke-width="1.6" stroke-dasharray="6 5" stroke-linecap="round" opacity="0.82" />
      ${tassels}
      ${closedDoorArch}
      ${junctionLanding}

      ${lanternGlow}
      <circle cx="${pilL[0].toFixed(1)}" cy="${pilL[1].toFixed(1)}" r="${pilRSize}" fill="${wallColor}" stroke="${ink}" stroke-width="2.1" />
      <circle cx="${pilL[0].toFixed(1)}" cy="${pilL[1].toFixed(1)}" r="${pilRSize * 0.42}" fill="#f5c663" stroke="${ink}" stroke-width="1.2" />
      <circle cx="${pilR[0].toFixed(1)}" cy="${pilR[1].toFixed(1)}" r="${pilRSize}" fill="${wallColor}" stroke="${ink}" stroke-width="2.1" />
      <circle cx="${pilR[0].toFixed(1)}" cy="${pilR[1].toFixed(1)}" r="${pilRSize * 0.42}" fill="#f5c663" stroke="${ink}" stroke-width="1.2" />
    </g>
  `;
}

function renderBookshelfBaySVG(bayGeom, ink, wallColor, wallHighlight, glow) {
  const { x, y, hall, items, innerW, innerH, outerW, outerH, bookendX, addSlotX, bayIdx } = bayGeom;
  const sw = getSwatch(hall.color);
  const shelfBackGrad = isCandlelight ? 'shelfBackNight' : 'shelfBackDay';
  const ledgeFill = isCandlelight ? '#6b462d' : '#be8750';
  const ledgeHi = isCandlelight ? '#84583a' : '#d8a66e';
  const glowOuter = glow.glowOuter;
  const glowCore = glow.glowCore;
  const isHallMatched = glow.active && glow.hallIds.has(hall.id);
  const bayHasBookMatch = glow.active && items.some(({ book }) => glow.bookIds.has(book.id));

  const halfOutW = outerW / 2, halfInW = innerW / 2;
  const shelfFloorY = outerH / 2 - 14;
  const shelfTopY = shelfFloorY - innerH;
  const frameTopY = shelfTopY - 12;
  const archPeakY = frameTopY - 24;
  const framePath = `M ${-halfOutW} ${shelfFloorY + 12} L ${-halfOutW} ${frameTopY} C ${-halfOutW * 0.56} ${archPeakY} ${halfOutW * 0.56} ${archPeakY} ${halfOutW} ${frameTopY} L ${halfOutW} ${shelfFloorY + 12} Q 0 ${shelfFloorY + 17} ${-halfOutW} ${shelfFloorY + 12} Z`;

  let spinesHtml = '';

  items.forEach(({ book, metrics, cx }, idx) => {
    const { lines, numLines, w, h } = metrics;
    const bsw = getSwatch(book.color || hall.color);
    const isOpen = openBookState.bookId === book.id;
    const isBookMatch = glow.active && glow.bookIds.has(book.id);
    const isDimmed = glow.active && !isBookMatch && !isHallMatched;
    const hw = w / 2;
    const lean = (idx === items.length - 1 && addSlotX !== null) ? -1.8 : ((hashNum(book.id + 't') - 0.5) * 1.4);

    const spinePath = `
      M ${-hw} ${shelfFloorY}
      L ${-hw} ${shelfFloorY - h + 6}
      Q ${-hw} ${shelfFloorY - h} ${-hw + 5} ${shelfFloorY - h - 1}
      Q 0 ${shelfFloorY - h - 4.5} ${hw - 5} ${shelfFloorY - h - 1}
      Q ${hw} ${shelfFloorY - h} ${hw} ${shelfFloorY - h + 6}
      L ${hw} ${shelfFloorY}
      Q 0 ${shelfFloorY + 2} ${-hw} ${shelfFloorY} Z
    `;

    const isScroll = isScrollItem(book);
    const textCenterY = shelfFloorY - h / 2 - (isScroll ? 0 : 2.5);
    const lineSpacing = 11.2;
    const startXOffset = -((lines.length - 1) * lineSpacing) / 2;
    const titleLinesSvg = lines.map((ln, lIdx) => {
      const lx = startXOffset + lIdx * lineSpacing;
      return `
        <text x="${lx.toFixed(1)}" y="${textCenterY.toFixed(1)}"
              transform="rotate(-90 ${lx.toFixed(1)} ${textCenterY.toFixed(1)})"
              text-anchor="middle" dominant-baseline="central"
              font-size="${numLines >= 3 ? 9.4 : 10.0}" font-weight="700" font-family="Georgia, serif"
              fill="${isScroll ? '#3b2413' : '#fffaf2'}" stroke="${isScroll ? '#fff8e8' : bsw.deep}" stroke-width="${isScroll ? 2.2 : 2.4}" paint-order="stroke"
              letter-spacing="0.15">${esc(ln)}</text>
      `;
    }).join('');

    const isCharBook = isCharacterBook(book);
    const isMktBook = isMarketLedger(book);
    const tipText = `${isScroll ? 'Scroll · ' : (isCharBook ? 'D&D Character · ' : (isMktBook ? 'Market Ledger · ' : ''))}${truncate(book.title, 28)}${book.pinned ? ' ★ Study Table' : ''} · Click to ${isScroll ? 'unroll' : 'open'}, drag to move`;
    const tipW = Math.max(146, tipText.length * 5.6 + 20);
    const inTransit = isBookCarriedByLibrarian(book.id);

    if (inTransit) {
      spinesHtml += `
        <g class="spine-hit node-interactive"
           data-action="open-book" data-hall-id="${hall.id}" data-book-id="${book.id}"
           transform="translate(${cx.toFixed(1)}, 0)">
          <rect x="${(-hw - 2).toFixed(1)}" y="${(shelfFloorY - h - 14).toFixed(1)}" width="${(w + 4).toFixed(1)}" height="${(h + 18).toFixed(1)}" fill="transparent" />
          <g transform="rotate(${lean.toFixed(1)} 0 ${shelfFloorY})" opacity="0.82">
            <path d="${spinePath}" fill="${bsw.soft}" fill-opacity="0.28" stroke="#f5c663" stroke-width="2.4" stroke-dasharray="5 3.5" stroke-linejoin="round" />
            <path d="${spinePath}" fill="none" stroke="${bsw.fill}" stroke-width="1.4" stroke-dasharray="5 3.5" stroke-dashoffset="4" stroke-linejoin="round" />
            <circle cx="0" cy="${(shelfFloorY - h / 2).toFixed(1)}" r="5.5" fill="#fff8e8" stroke="${bsw.fill}" stroke-width="1.5" />
            <circle cx="0" cy="${(shelfFloorY - h / 2).toFixed(1)}" r="2.2" fill="#f5c663" />
          </g>
        </g>
      `;
      return;
    }

    const scrollInnerW = Math.max(15, w - 5);
    const shw = scrollInnerW / 2;
    const scrollBodyTop = shelfFloorY - h + 7;
    const scrollBodyBot = shelfFloorY - 4;
    const scrollMidY = (scrollBodyTop + scrollBodyBot) / 2;
    const itemArtSvg = isScroll
      ? `
        <!-- Rolled Parchment Scroll with Turned Wooden Dowels & Colored Silk Ribbon -->
        ${isBookMatch ? `<rect x="${(-shw - 2).toFixed(1)}" y="${(scrollBodyTop - 5).toFixed(1)}" width="${(scrollInnerW + 4).toFixed(1)}" height="${(h - 4).toFixed(1)}" rx="8" fill="none" stroke="${glowOuter}" stroke-width="8" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
        <!-- Top & Bottom Turned Wooden Scroll Dowels -->
        <rect x="-3.2" y="${(scrollBodyTop - 7).toFixed(1)}" width="6.4" height="8" rx="2.5" fill="#8d5830" stroke="${ink}" stroke-width="1.5" />
        <circle cx="0" cy="${(scrollBodyTop - 6.5).toFixed(1)}" r="3.2" fill="#d9a143" stroke="${ink}" stroke-width="1.3" />
        <rect x="-3.2" y="${(scrollBodyBot - 1).toFixed(1)}" width="6.4" height="6" rx="2.2" fill="#8d5830" stroke="${ink}" stroke-width="1.5" />
        <!-- Rolled Cream Parchment Cylinder -->
        <rect x="${(-shw).toFixed(1)}" y="${scrollBodyTop.toFixed(1)}" width="${scrollInnerW.toFixed(1)}" height="${(scrollBodyBot - scrollBodyTop).toFixed(1)}" rx="6"
              fill="#f8ecd2" stroke="${isBookMatch ? glowCore : (isOpen ? '#f5c663' : ink)}" stroke-width="${isBookMatch ? 2.8 : (isOpen ? 2.5 : 1.9)}" />
        <!-- Cylindrical Highlight & Shadow -->
        <line x1="${(-shw + 3).toFixed(1)}" y1="${(scrollBodyTop + 4).toFixed(1)}" x2="${(-shw + 3).toFixed(1)}" y2="${(scrollBodyBot - 4).toFixed(1)}" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" opacity="0.65" />
        <line x1="${(shw - 2.8).toFixed(1)}" y1="${(scrollBodyTop + 4).toFixed(1)}" x2="${(shw - 2.8).toFixed(1)}" y2="${(scrollBodyBot - 4).toFixed(1)}" stroke="#c9ad82" stroke-width="3" stroke-linecap="round" opacity="0.55" />
        <!-- Top Spiral Scroll Curl Hint -->
        <ellipse cx="0" cy="${(scrollBodyTop + 1.2).toFixed(1)}" rx="${(shw - 1.5).toFixed(1)}" ry="2.6" fill="#ead6af" stroke="${ink}" stroke-width="1.1" />
        <!-- Colored Silk Ribbon Band wrapped around center -->
        <rect x="${(-shw - 1.2).toFixed(1)}" y="${(scrollMidY - 5).toFixed(1)}" width="${(scrollInnerW + 2.4).toFixed(1)}" height="10" rx="2.5"
              fill="${bsw.fill}" stroke="${ink}" stroke-width="1.4" opacity="0.92" />
        <circle cx="${(shw - 1).toFixed(1)}" cy="${scrollMidY.toFixed(1)}" r="2.3" fill="${bsw.deep}" stroke="${ink}" stroke-width="1" />
        ${book.pinned ? `<circle cx="0" cy="${(scrollBodyTop + 6).toFixed(1)}" r="3.4" fill="#ffd85a" stroke="${ink}" stroke-width="1.1" />` : ''}
        ${titleLinesSvg}
      `
      : `
        ${isBookMatch ? `<path d="${spinePath}" fill="none" stroke="${glowOuter}" stroke-width="8" stroke-linejoin="round" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
        <path d="${spinePath}" fill="${bsw.fill}" stroke="${isBookMatch ? glowCore : (isOpen ? '#f5c663' : ink)}" stroke-width="${isBookMatch ? 2.9 : (isOpen ? 2.6 : 2)}" stroke-linejoin="round" />
        <path d="M ${(-hw + 3.4).toFixed(1)} ${shelfFloorY - 5} L ${(-hw + 3.4).toFixed(1)} ${shelfFloorY - h + 7}" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.26" />
        <path d="M ${(hw - 3.2).toFixed(1)} ${shelfFloorY - 5} L ${(hw - 3.2).toFixed(1)} ${shelfFloorY - h + 7}" stroke="${bsw.deep}" stroke-width="3.4" stroke-linecap="round" opacity="0.44" />
        <path d="M ${(-hw + 1.5).toFixed(1)} ${shelfFloorY - h + 11} Q 0 ${shelfFloorY - h + 8.5} ${(hw - 1.5).toFixed(1)} ${shelfFloorY - h + 11}" fill="none" stroke="${bsw.rugEdge}" stroke-width="2" opacity="0.82" />
        <path d="M ${(-hw + 1.5).toFixed(1)} ${shelfFloorY - 18} Q 0 ${shelfFloorY - 20.5} ${(hw - 1.5).toFixed(1)} ${shelfFloorY - 18}" fill="none" stroke="${bsw.rugEdge}" stroke-width="2" opacity="0.82" />
        ${isCharBook ? `<polygon points="0,${shelfFloorY - h + 2.5} 4.5,${shelfFloorY - h + 7.5} 0,${shelfFloorY - h + 12.5} -4.5,${shelfFloorY - h + 7.5}" fill="#f5c663" stroke="${ink}" stroke-width="1.1" />` : ''}
        ${book.pinned ? `<circle cx="${isCharBook ? (hw - 4.5).toFixed(1) : '0'}" cy="${shelfFloorY - h + 4.5}" r="3.4" fill="#ffd85a" stroke="${ink}" stroke-width="1.1" />` : ''}
        ${titleLinesSvg}
        <circle cx="0" cy="${shelfFloorY - 9}" r="6" fill="${isBookMatch ? glowCore : (isOpen ? '#f5c663' : '#fff8e8')}" stroke="${ink}" stroke-width="1.2" />
        <text x="0" y="${shelfFloorY - 6.3}" text-anchor="middle" font-size="7.6" font-weight="800" fill="#352012">${book.pages.length}</text>
      `;

    spinesHtml += `
      <g class="spine-hit node-interactive ${isOpen ? 'is-open' : ''} ${isBookMatch ? 'is-search-match' : ''} ${isDimmed ? 'is-search-dimmed' : ''}"
         data-action="open-book" data-hall-id="${hall.id}" data-book-id="${book.id}"
         transform="translate(${cx.toFixed(1)}, 0)">
        <rect x="${(-hw - 2).toFixed(1)}" y="${(shelfFloorY - h - 14).toFixed(1)}" width="${(w + 4).toFixed(1)}" height="${(h + 18).toFixed(1)}" fill="transparent" />
        <g class="spine-inner">
          <g transform="rotate(${lean.toFixed(1)} 0 ${shelfFloorY})">
            ${itemArtSvg}
          </g>
        </g>
        <g transform="translate(0, ${(shelfFloorY - h - 22).toFixed(1)})">
          <g class="spine-tooltip">
            <rect x="${(-tipW / 2).toFixed(1)}" y="-13" width="${tipW.toFixed(1)}" height="22" rx="9"
                  fill="${isCandlelight ? '#2f2017' : '#fffaf0'}" stroke="${bsw.fill}" stroke-width="1.8" filter="url(#bookShadow)" />
            <text x="0" y="1.5" text-anchor="middle" font-size="10" font-weight="700"
                  fill="${isCandlelight ? '#f8ebd4' : '#352114'}">${esc(tipText)}</text>
          </g>
        </g>
      </g>
    `;
  });

  let bookendHtml = '';
  if (bookendX !== null && addSlotX !== null) {
    bookendHtml = `
      <g transform="translate(${bookendX.toFixed(1)}, ${shelfFloorY})">
        <path d="M 0 0 L 9 0 L 9 -2.5 L 2.5 -2.5 L 2.5 -22 C 2.5 -27 8 -27 8 -21 C 8 -17 5 -16 2.5 -16"
              fill="none" stroke="#d9a143" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M 0 0 L 9 0 L 9 -2.5 L 2.5 -2.5 L 2.5 -22 C 2.5 -27 8 -27 8 -21"
              fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round" />
      </g>
    `;
  }

  let addSlotHtml = '';
  if (addSlotX !== null) {
    const shelfAttr = bayGeom.shelfId ? ` data-shelf-id="${bayGeom.shelfId}"` : '';
    const slotTitle = bayGeom.shelfName
      ? `Shelve a new book on "${esc(bayGeom.shelfName)}"`
      : `Shelve a new book in ${esc(hall.title)}`;
    addSlotHtml = `
      <g class="shelf-slot-add-hit node-interactive" data-action="add-book" data-hall-id="${hall.id}"${shelfAttr} transform="translate(${addSlotX.toFixed(1)}, 0)">
        <rect x="-13" y="${shelfFloorY - 88}" width="26" height="90" fill="transparent" />
        <g class="shelf-slot-add-inner">
          <path d="M -10 ${shelfFloorY} L -10 ${shelfFloorY - 76} Q 0 ${shelfFloorY - 82} 10 ${shelfFloorY - 76} L 10 ${shelfFloorY} Z"
                fill="${isCandlelight ? 'rgba(255,235,190,0.08)' : 'rgba(255,250,240,0.45)'}"
                stroke="${sw.accent}" stroke-width="1.9" stroke-dasharray="4 3" stroke-linejoin="round" />
          <path d="M -4.5 ${shelfFloorY - 40} H 4.5 M 0 ${shelfFloorY - 44.5} V ${shelfFloorY - 35.5}" stroke="${sw.accent}" stroke-width="2.3" stroke-linecap="round" />
          <title>${slotTitle}</title>
        </g>
      </g>
    `;
  }

  let propHtml = '';
  const rightClear = addSlotX !== null ? (halfInW - (addSlotX + 16)) : 0;
  if (rightClear >= 28) {
    const px = halfInW - 16;
    propHtml = (bayIdx % 2 === 0)
      ? `
        <g transform="translate(${px.toFixed(1)}, ${shelfFloorY})" opacity="0.78">
          <path d="M -7 -13 L 7 -13 L 5 0 L -5 0 Z" fill="#c67252" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round" />
          <path d="M 0 -13 Q -10 -24 -3 -26 Q 0 -19 0 -13 M 0 -13 Q 10 -24 3 -26 Q 0 -19 0 -13 M 0 -13 Q 0 -29 0 -29"
                fill="#6c9a72" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round" />
        </g>
      `
      : `
        <g transform="translate(${px.toFixed(1)}, ${shelfFloorY})" opacity="0.78">
          <path d="M -6 -22 H 6 L 2 -11 L 6 0 H -6 L -2 -11 Z" fill="#f7e5be" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round" />
          <line x1="-8" y1="-22" x2="8" y2="-22" stroke="#c98e3b" stroke-width="2.4" stroke-linecap="round" />
          <line x1="-8" y1="0" x2="8" y2="0" stroke="#c98e3b" stroke-width="2.4" stroke-linecap="round" />
        </g>
      `;
  }

  const tetherHtml = bayGeom.stagger !== 0
    ? `<line x1="${bayGeom.anchorX.toFixed(1)}" y1="${bayGeom.anchorY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${sw.deep}" stroke-width="3" stroke-dasharray="5 5" opacity="0.45" />`
    : '';

  let topCrestHtml = `
      <circle cx="0" cy="${(archPeakY + 14).toFixed(1)}" r="5.8" fill="${sw.fill}" stroke="${ink}" stroke-width="1.5" />
      <circle cx="-1.4" cy="${(archPeakY + 12.6).toFixed(1)}" r="1.7" fill="#fffaf0" opacity="0.65" />
  `;
  if (bayGeom.shelfName) {
    const lbl = truncate(bayGeom.shelfName, 24);
    const plateW = Math.min(outerW - 10, Math.max(72, lbl.length * 6.5 + 30));
    const plateY = archPeakY + 12;
    topCrestHtml = `
      <g class="node-interactive" data-action="select-hall" data-hall-id="${hall.id}" transform="translate(0, ${plateY.toFixed(1)})">
        <rect x="${(-plateW / 2).toFixed(1)}" y="-9.5" width="${plateW.toFixed(1)}" height="19" rx="9.5"
              fill="${isCandlelight ? '#2f1e14' : '#fff7e3'}" stroke="${sw.fill}" stroke-width="1.8" />
        <circle cx="${(-plateW / 2 + 10).toFixed(1)}" cy="0" r="3.4" fill="${sw.fill}" stroke="${ink}" stroke-width="1.1" />
        <text x="5" y="3.5" text-anchor="middle" font-size="9.5" font-weight="800" font-family="Georgia, serif"
              fill="${isCandlelight ? '#f6e7cc' : '#3a2212'}">${esc(lbl)}</text>
        <title>Shelf: ${esc(bayGeom.shelfName)} (click to manage shelves)</title>
      </g>
    `;
  }

  return `
    ${tetherHtml}
    <g class="bookshelf-bay" transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})">
      ${bayHasBookMatch ? `<path d="${framePath}" fill="none" stroke="${glowOuter}" stroke-width="9" stroke-linejoin="round" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
      <path d="${framePath}"
            fill="${wallColor}" stroke="${bayHasBookMatch ? glowCore : ink}" stroke-width="${bayHasBookMatch ? 3.2 : 2.6}" stroke-linejoin="round" filter="url(#shelfShadow)" />
      <path d="M ${(-halfOutW + 4).toFixed(1)} ${frameTopY + 2} C ${(-halfOutW * 0.52).toFixed(1)} ${archPeakY + 4} ${(halfOutW * 0.52).toFixed(1)} ${archPeakY + 4} ${(halfOutW - 4).toFixed(1)} ${frameTopY + 2}"
            fill="none" stroke="${wallHighlight}" stroke-width="3" stroke-linecap="round" />

      <path d="M ${-halfInW} ${shelfFloorY} L ${-halfInW} ${shelfTopY + 6} C ${-halfInW * 0.55} ${shelfTopY - 12} ${halfInW * 0.55} ${shelfTopY - 12} ${halfInW} ${shelfTopY + 6} L ${halfInW} ${shelfFloorY} Z"
            fill="url(#${shelfBackGrad})" stroke="${ink}" stroke-width="1.8" />

      ${bookendHtml}
      ${propHtml}
      ${spinesHtml}
      ${addSlotHtml}

      <path d="M ${(-halfInW - 6).toFixed(1)} ${shelfFloorY} Q 0 ${shelfFloorY + 3} ${(halfInW + 6).toFixed(1)} ${shelfFloorY} L ${(halfInW + 6).toFixed(1)} ${shelfFloorY + 10} Q 0 ${shelfFloorY + 14} ${(-halfInW - 6).toFixed(1)} ${shelfFloorY + 10} Z"
            fill="${ledgeFill}" stroke="${ink}" stroke-width="2" stroke-linejoin="round" />
      <path d="M ${(-halfInW - 2).toFixed(1)} ${shelfFloorY + 2} Q 0 ${shelfFloorY + 5} ${(halfInW + 2).toFixed(1)} ${shelfFloorY + 2}" fill="none" stroke="${ledgeHi}" stroke-width="1.8" stroke-linecap="round" opacity="0.85" />

      <path d="M ${(-halfOutW + 8).toFixed(1)} ${shelfFloorY + 11} L ${(-halfOutW + 20).toFixed(1)} ${shelfFloorY + 11} L ${(-halfOutW + 17).toFixed(1)} ${shelfFloorY + 19} Q ${(-halfOutW + 14).toFixed(1)} ${shelfFloorY + 21} ${(-halfOutW + 10).toFixed(1)} ${shelfFloorY + 19} Z
               M ${(halfOutW - 20).toFixed(1)} ${shelfFloorY + 11} L ${(halfOutW - 8).toFixed(1)} ${shelfFloorY + 11} L ${(halfOutW - 10).toFixed(1)} ${shelfFloorY + 19} Q ${(halfOutW - 14).toFixed(1)} ${shelfFloorY + 21} ${(halfOutW - 17).toFixed(1)} ${shelfFloorY + 19} Z"
            fill="${wallColor}" stroke="${ink}" stroke-width="1.7" stroke-linejoin="round" />
      ${topCrestHtml}
    </g>
  `;
}

// --- Graceful Silk Cross-Reference Ribbons connecting related Books across the Library! ---
function renderCrossRefRibbonsSVG(ink, glow) {
  if (!state.ribbons.length) return '';
  if (!showRibbons && (!glow.active || glow.ribbonIds.size === 0)) return '';
  const glowOuter = glow.glowOuter;
  const glowCore = glow.glowCore;
  let out = '';

  state.ribbons.forEach((rib, idx) => {
    const isRibbonMatch = glow.active && glow.ribbonIds.has(rib.id);
    if (!showRibbons && !isRibbonMatch) return;
    const isRibbonDimmed = glow.active && !isRibbonMatch;

    const b1 = layoutCache.books[rib.fromBookId];
    const b2 = layoutCache.books[rib.toBookId];
    if (!b1 || !b2) return;
    if (b1.collapsedProxy && b2.collapsedProxy && Math.hypot(b1.x - b2.x, b1.y - b2.y) < 10) return;

    const sw = getSwatch(rib.colorId);
    const x1 = b1.spineTopX, y1 = b1.spineTopY - 2;
    const x2 = b2.spineTopX, y2 = b2.spineTopY - 2;
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.max(40, Math.hypot(dx, dy));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const nx = -dy / dist, ny = dx / dist;
    const bowDir = (idx % 2 === 0 ? 1 : -1);
    const bowMag = Math.min(130, 42 + dist * 0.16) * bowDir;
    const cx = mx + nx * bowMag;
    const cy = my + ny * bowMag - 26;

    const pathD = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    const midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
    const midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;

    const label = truncate(rib.label || '', 18);
    const tagW = label ? Math.max(58, label.length * 6.2 + 20) : 0;

    out += `
      <g class="ribbon-hit node-interactive ${isRibbonDimmed ? 'is-search-dimmed' : ''}" data-action="inspect-ribbon" data-ribbon-id="${rib.id}">
        <path d="${pathD}" fill="none" stroke="#1a0d05" stroke-width="7" stroke-linecap="round" opacity="0.16" transform="translate(0, 4)" />
        ${isRibbonMatch ? `<path d="${pathD}" fill="none" stroke="${glowOuter}" stroke-width="13" stroke-linecap="round" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
        <path class="ribbon-strand" d="${pathD}" fill="none" stroke="${isRibbonMatch ? glowCore : ink}" stroke-width="${isRibbonMatch ? 7.5 : 6.5}" stroke-linecap="round" opacity="0.92" />
        <path class="ribbon-strand" d="${pathD}" fill="none" stroke="${sw.fill}" stroke-width="${isRibbonMatch ? 4.6 : 4}" stroke-linecap="round" />
        <path d="${pathD}" fill="none" stroke="${sw.rugEdge}" stroke-width="1.2" stroke-dasharray="5 5" stroke-linecap="round" opacity="0.85" />

        ${isRibbonMatch ? `
          <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="8.2" fill="none" stroke="${glowCore}" stroke-width="2.8" filter="url(#searchGlow)" class="search-glow-aura" />
          <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="8.2" fill="none" stroke="${glowCore}" stroke-width="2.8" filter="url(#searchGlow)" class="search-glow-aura" />
        ` : ''}
        <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="${isRibbonMatch ? 5.2 : 4.6}" fill="${sw.fill}" stroke="${isRibbonMatch ? glowCore : ink}" stroke-width="1.6" />
        <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="${isRibbonMatch ? 5.2 : 4.6}" fill="${sw.fill}" stroke="${isRibbonMatch ? glowCore : ink}" stroke-width="1.6" />

        ${label ? `
          <g transform="translate(${midX.toFixed(1)}, ${midY.toFixed(1)})">
            <g class="ribbon-tag-inner">
              ${isRibbonMatch ? `<rect x="${(-tagW / 2 - 2).toFixed(1)}" y="-12.5" width="${(tagW + 4).toFixed(1)}" height="25" rx="12.5" fill="none" stroke="${glowOuter}" stroke-width="5" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
              <rect x="${(-tagW / 2).toFixed(1)}" y="-10.5" width="${tagW.toFixed(1)}" height="21" rx="10.5"
                    fill="${isCandlelight ? '#2f2017' : '#fffaf0'}" stroke="${isRibbonMatch ? glowCore : sw.fill}" stroke-width="${isRibbonMatch ? 2.4 : 1.8}" filter="url(#bookShadow)" />
              <text x="0" y="3.5" text-anchor="middle" font-size="9.5" font-weight="700" font-family="Georgia, serif"
                    fill="${isCandlelight ? '#f8ebd4' : sw.deep}">${esc(label)}</text>
            </g>
          </g>
        ` : ''}
        <title>${esc(b1.book.title)} ↔ ${esc(b2.book.title)}${rib.label ? ' (' + esc(rib.label) + ')' : ''}</title>
      </g>
    `;
  });

  return out;
}

function renderHallBannerSVG(hg, ink, glow) {
  const { hall, depth, bannerPt, swivelPt, addHubPt, collapsed } = hg;
  const sw = getSwatch(hall.color);
  const icon = getHallIcon(hall.icon);
  const isSel = selection.type === 'hall' && selection.hallId === hall.id;
  const isGlowMatch = glow.active && (glow.hallIds.has(hall.id) || glow.collapsedGlowHallIds.has(hall.id));
  const glowOuter = glow.glowOuter;
  const glowCore = glow.glowCore;
  const title = truncate(hall.title, depth === 0 ? 18 : 16);
  const fontSize = depth === 0 ? 13 : 11.5;
  const w = Math.max(depth === 0 ? 124 : 106, title.length * (depth === 0 ? 7.7 : 6.9) + 46);
  const h = depth === 0 ? 38 : 33;
  const hw = w / 2, hh = h / 2;

  const plaquePath = `
    M ${-hw + 8} ${-hh}
    Q 0 ${-hh - 4} ${hw - 8} ${-hh}
    Q ${hw} ${-hh} ${hw} ${-hh + 8}
    L ${hw} ${hh - 8}
    Q ${hw} ${hh} ${hw - 8} ${hh}
    Q 0 ${hh + 4} ${-hw + 8} ${hh}
    Q ${-hw} ${hh} ${-hw} ${hh - 8}
    L ${-hw} ${-hh + 8}
    Q ${-hw} ${-hh} ${-hw + 8} ${-hh} Z
  `;
  const totalBooks = countTotalBooks(hall);
  const isRadialOpen = openAddRadialHallId === hall.id;

  return `
    <g class="hall-banner-hit node-interactive" data-action="select-hall" data-hall-id="${hall.id}" transform="translate(${bannerPt.x.toFixed(1)}, ${bannerPt.y.toFixed(1)})">
      <rect x="${(-hw - 12).toFixed(1)}" y="${(-hh - 8).toFixed(1)}" width="${(w + 24).toFixed(1)}" height="${(h + 18).toFixed(1)}" fill="transparent" />
      <g class="hall-banner-inner">
        ${isGlowMatch ? `<path d="${plaquePath}" fill="none" stroke="${glowOuter}" stroke-width="8" stroke-linejoin="round" filter="url(#searchGlow)" class="search-glow-aura" />` : ''}
        <path d="M ${-hw - 9} -7 L ${-hw + 4} -7 L ${-hw + 4} 9 L ${-hw - 9} 9 L ${-hw - 3} 1 Z" fill="${sw.deep}" stroke="${ink}" stroke-width="1.9" stroke-linejoin="round" />
        <path d="M ${hw + 9} -7 L ${hw - 4} -7 L ${hw - 4} 9 L ${hw + 9} 9 L ${hw + 3} 1 Z" fill="${sw.deep}" stroke="${ink}" stroke-width="1.9" stroke-linejoin="round" />
        <path d="${plaquePath}" fill="${isSel ? sw.fill : (isCandlelight ? '#3c291e' : '#fff9ec')}" stroke="${isGlowMatch ? glowCore : (isSel ? '#fff3d6' : ink)}" stroke-width="${isGlowMatch ? 3.2 : (isSel ? 2.8 : 2.2)}" filter="url(#bookShadow)" />

        <circle cx="${(-hw + 18).toFixed(1)}" cy="0" r="${depth === 0 ? 11.5 : 10}" fill="${isSel ? '#fff8eb' : sw.fill}" stroke="${ink}" stroke-width="1.7" />
        <g transform="translate(${(-hw + (depth === 0 ? 10 : 11)).toFixed(1)}, ${depth === 0 ? -8 : -7}) scale(${depth === 0 ? 0.67 : 0.58})">
          <path d="${icon.path}" fill="none" stroke="${isSel ? sw.deep : '#fffaf0'}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </g>

        <text x="${(-hw + (depth === 0 ? 36 : 33)).toFixed(1)}" y="${depth === 0 ? 4.5 : 4}" font-size="${fontSize}" font-weight="700" font-family="Georgia, serif"
              fill="${isSel ? '#fffaf2' : (isCandlelight ? '#f6e8cf' : '#352114')}">${esc(title)}</text>

        <g transform="translate(${(hw - 3).toFixed(1)}, ${(-hh + 2).toFixed(1)})">
          <circle r="9.5" fill="${sw.fill}" stroke="${ink}" stroke-width="1.7" />
          <text x="0" y="3.3" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fffaf0">${totalBooks}</text>
        </g>
      </g>
    </g>

    <!-- Fold / Expand Wing Pill Toggle -->
    <g class="fold-btn-hit node-interactive" data-action="toggle-collapse-hall" data-hall-id="${hall.id}" transform="translate(${(bannerPt.x - hw - 12).toFixed(1)}, ${(bannerPt.y - hh + 2).toFixed(1)})">
      <circle r="14" fill="transparent" />
      <g class="fold-btn-inner">
        <circle r="9.5" fill="${collapsed ? sw.fill : (isCandlelight ? '#3d2a1e' : '#fff8e8')}" stroke="${ink}" stroke-width="1.7" filter="url(#bookShadow)" />
        <path d="${collapsed ? 'M -2.5 -4 L 3.5 0 L -2.5 4' : 'M -4 -2 L 0 3 L 4 -2'}" fill="none" stroke="${collapsed ? '#fffaf2' : sw.deep}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
        <title>${collapsed ? `Expand "${esc(hall.title)}" wing (${totalBooks} books)` : `Fold "${esc(hall.title)}" wing`}</title>
      </g>
    </g>

    <g class="swivel-hit" data-action="drag-hall-angle" data-hall-id="${hall.id}" transform="translate(${swivelPt.x.toFixed(1)}, ${swivelPt.y.toFixed(1)})">
      <circle r="21" fill="transparent" />
      <g class="swivel-inner">
        <circle r="13.5" fill="${hall.customAngle != null ? '#f0be5b' : '#e0a94d'}" stroke="${ink}" stroke-width="2.1" filter="url(#bookShadow)" />
        <circle r="9.5" fill="${isCandlelight ? '#3d2a1e' : '#fff7e0'}" stroke="${ink}" stroke-width="1.2" />
        <path d="M -5 -2 A 5.5 5.5 0 0 1 5 -2 M 5 2 A 5.5 5.5 0 0 1 -5 2" fill="none" stroke="${sw.deep}" stroke-width="1.7" stroke-linecap="round" />
        <path d="M 3.2 -4.2 L 5.6 -1.8 L 2.8 -0.8 M -3.2 4.2 L -5.6 1.8 L -2.8 0.8" fill="none" stroke="${sw.deep}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        <title>Drag to swing "${esc(hall.title)}" angle (double-click to reset)</title>
      </g>
    </g>

    ${addHubPt && !isRadialOpen ? `
    <g class="quick-add-hit node-interactive" data-action="toggle-add-radial" data-hall-id="${hall.id}" transform="translate(${addHubPt.x.toFixed(1)}, ${addHubPt.y.toFixed(1)})">
      <circle r="24" fill="transparent" />
      <g class="quick-add-inner">
        <rect x="-25" y="-12.5" width="50" height="25" rx="12.5" fill="${isCandlelight ? '#3d2a1e' : '#fff8e8'}" stroke="${sw.fill}" stroke-width="2.1" filter="url(#bookShadow)" />
        <text x="0" y="3.8" text-anchor="middle" font-size="10.5" font-weight="800" fill="${isCandlelight ? '#f8ebd4' : sw.deep}">Add +</text>
        <title>Add a Book, Scroll, D&amp;D Sheet, or Wing to ${esc(hall.title)}</title>
      </g>
    </g>
    ` : ''}
  `;
}

function renderAddRadialMenuSVG(ink) {
  if (!openAddRadialHallId) return '';
  const hg = layoutCache.hallMap[openAddRadialHallId];
  if (!hg || hg.collapsed || !hg.addHubPt) return '';

  const { hall, addHubPt, angle, hasSubs } = hg;
  const sw = getSwatch(hall.color);
  const cx = addHubPt.x;
  const cy = addHubPt.y;

  const deg = Math.PI / 180;
  const radius = hasSubs ? 60 : 74;
  const angleOffsets = hasSubs
    ? [-135 * deg, -45 * deg, 45 * deg, 135 * deg]
    : [-72 * deg, -24 * deg, 24 * deg, 72 * deg];

  const options = [
    {
      action: 'add-book',
      label: '+ Book',
      w: 50,
      fill: isCandlelight ? '#3d2a1e' : '#fff8e8',
      stroke: sw.fill,
      text: isCandlelight ? '#f8ebd4' : sw.fill,
      title: `Shelve a new book in ${hall.title}`
    },
    {
      action: 'add-scroll',
      label: '+ Scroll',
      w: 54,
      fill: isCandlelight ? '#3d2a1e' : '#fbf0d9',
      stroke: '#b07b3b',
      text: isCandlelight ? '#f5d493' : '#7a4b1e',
      title: `Shelve a new single-page scroll in ${hall.title}`
    },
    {
      action: 'add-dndchar',
      label: '+ D&D',
      w: 48,
      fill: isCandlelight ? '#3d241b' : '#fdf2f0',
      stroke: '#b54434',
      text: isCandlelight ? '#f5b3a6' : '#9b3324',
      title: `Shelve a new D&D Character Book in ${hall.title}`
    },
    {
      action: 'add-subhall',
      label: '+ Wing',
      w: 52,
      fill: sw.fill,
      stroke: ink,
      text: '#fffaf2',
      title: `Branch an angled sub-hall off ${hall.title}`
    }
  ];

  let spokes = '';
  let items = '';
  options.forEach((opt, i) => {
    const a = angle + angleOffsets[i];
    const ox = cx + Math.cos(a) * radius;
    const oy = cy + Math.sin(a) * radius;
    const hw = opt.w / 2;
    spokes += `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="${isCandlelight ? '#e0a94d' : sw.deep}" stroke-width="2" stroke-dasharray="3.5 3" opacity="0.68" />`;
    items += `
      <g class="quick-add-hit radial-option-item node-interactive" data-action="${opt.action}" data-hall-id="${hall.id}" transform="translate(${ox.toFixed(1)}, ${oy.toFixed(1)})" style="--radial-delay:${i * 28}ms;">
        <rect x="${(-hw - 5).toFixed(1)}" y="-16" width="${(opt.w + 10).toFixed(1)}" height="32" fill="transparent" />
        <g class="quick-add-inner">
          <rect x="${(-hw).toFixed(1)}" y="-12.5" width="${opt.w}" height="25" rx="12.5" fill="${opt.fill}" stroke="${opt.stroke}" stroke-width="2.1" filter="url(#bookShadow)" />
          <text x="0" y="3.8" text-anchor="middle" font-size="10" font-weight="800" fill="${opt.text}">${opt.label}</text>
          <title>${esc(opt.title)}</title>
        </g>
      </g>
    `;
  });

  return `
    <g class="add-radial-menu" data-radial-hall="${hall.id}">
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(radius * 0.72).toFixed(1)}" fill="${isCandlelight ? 'rgba(24,15,9,0.28)' : 'rgba(255,248,232,0.34)'}" stroke="${isCandlelight ? '#e0a94d' : sw.fill}" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.65" pointer-events="none" />
      ${spokes}
      ${items}
      <g class="quick-add-hit node-interactive" data-action="toggle-add-radial" data-hall-id="${hall.id}" transform="translate(${cx.toFixed(1)}, ${cy.toFixed(1)})">
        <circle r="22" fill="transparent" />
        <g class="quick-add-inner">
          <circle r="15" fill="${sw.fill}" stroke="${isCandlelight ? '#fff3d6' : ink}" stroke-width="2.2" filter="url(#bookShadow)" />
          <path d="M -4.5 -4.5 L 4.5 4.5 M 4.5 -4.5 L -4.5 4.5" stroke="#fffaf2" stroke-width="2.3" stroke-linecap="round" />
          <title>Close add options</title>
        </g>
      </g>
    </g>
  `;
}

function renderRotundaSVG(ink, woodPattern, wallColor, wallHighlight) {
  const R = HUB_RADIUS;
  const isSel = selection.type === 'hub';
  const titleLines = wrapLines(state.title, 15, 2);
  const subtitle = truncate(state.subtitle, 22);

  let parquet = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parquet += `<line x1="${(Math.cos(a) * 32).toFixed(1)}" y1="${(Math.sin(a) * 32).toFixed(1)}" x2="${(Math.cos(a) * (R - 14)).toFixed(1)}" y2="${(Math.sin(a) * (R - 14)).toFixed(1)}" stroke="${isCandlelight ? '#3d2515' : '#b78146'}" stroke-width="1.3" opacity="0.4" />`;
  }

  let props = '';
  const rootAngles = layoutCache.halls.filter(h => h.depth === 0).map(h => h.angle);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    const nearHall = rootAngles.some(ha => Math.abs(((a - ha + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.44);
    if (nearHall) continue;
    const px = Math.cos(a) * (R - 26), py = Math.sin(a) * (R - 26);
    if (i % 2 === 0) {
      props += `
        <g transform="translate(${px.toFixed(1)}, ${py.toFixed(1)})">
          <circle r="11" fill="#b86b4b" stroke="${ink}" stroke-width="1.8" />
          <path d="M0 0 Q-12 -10 -4 -14 Q0 -6 0 0 M0 0 Q12 -10 10 -2 Q4 0 0 0 M0 0 Q-10 10 -12 2 Q-5 0 0 0 M0 0 Q8 12 12 5 Q4 2 0 0"
                fill="#6c9a72" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round" />
          <circle r="3" fill="#9bc49e" />
        </g>
      `;
    } else {
      props += `
        <g transform="translate(${px.toFixed(1)}, ${py.toFixed(1)})">
          <circle r="11.5" fill="#d17152" stroke="${ink}" stroke-width="1.8" />
          <circle r="6" fill="#e58c6d" opacity="0.7" />
          <circle r="2.2" fill="#f7e5be" stroke="${ink}" stroke-width="1" />
        </g>
      `;
    }
  }

  const motes = [
    [-55, -62, 2.5, 0], [64, -44, 2, 1.3], [-74, 34, 2.2, 2.6],
    [48, 66, 2.6, 0.8], [16, -86, 1.8, 3.1], [-24, 78, 2, 1.9]
  ].map(([mx, my, mr, delay]) =>
    `<circle cx="${mx}" cy="${my}" r="${mr}" fill="#ffe8a3" class="mote" style="animation-delay:${delay}s;" />`
  ).join('');

  return `
    <g class="rotunda-hub node-interactive" data-action="select-hub">
      <circle cx="0" cy="8" r="${R + 6}" fill="#1f1208" opacity="${isCandlelight ? 0.5 : 0.16}" />
      <circle cx="0" cy="0" r="${R}" fill="${wallColor}" stroke="${ink}" stroke-width="${isSel ? 4.5 : 3.2}" />
      <circle cx="0" cy="0" r="${R - 11}" fill="url(#${woodPattern})" stroke="${wallHighlight}" stroke-width="2.2" />
      ${isSel ? `<circle cx="0" cy="0" r="${R + 7}" fill="none" stroke="#e09545" stroke-width="3.2" stroke-dasharray="10 6" />` : ''}

      ${parquet}
      <circle cx="0" cy="0" r="${R - 36}" fill="none" stroke="${isCandlelight ? '#7b5539' : '#c99358'}" stroke-width="2" stroke-dasharray="7 5" opacity="0.7" />

      <circle cx="0" cy="0" r="84" fill="${isCandlelight ? '#6b3b2d' : '#d68260'}" stroke="${ink}" stroke-width="2.3" />
      <circle cx="0" cy="0" r="74" fill="none" stroke="#f7e5be" stroke-width="2" stroke-dasharray="6 4" opacity="0.8" />
      <circle cx="0" cy="0" r="64" fill="${isCandlelight ? '#4d2b22' : '#c26948'}" opacity="0.65" />

      ${props}

      <g class="rotunda-desk-inner">
        <ellipse cx="0" cy="4" rx="68" ry="46" fill="#211208" opacity="0.22" />
        <ellipse cx="0" cy="0" rx="68" ry="46" fill="${isCandlelight ? '#784e32' : '#b77943'}" stroke="${ink}" stroke-width="2.6" />
        <ellipse cx="0" cy="-2" rx="60" ry="38" fill="${isCandlelight ? '#8b5c3c' : '#cb8d54'}" stroke="${wallHighlight}" stroke-width="1.5" />

        <!-- Miniature Oak Card Catalog Box on the left of the desk -->
        <g transform="translate(-44, -14)">
          <rect x="-12" y="-10" width="24" height="20" rx="3.5" fill="#9a6338" stroke="${ink}" stroke-width="1.6" />
          <line x1="-12" y1="0" x2="12" y2="0" stroke="${ink}" stroke-width="1.2" />
          <line x1="0" y1="-10" x2="0" y2="10" stroke="${ink}" stroke-width="1.2" />
          <circle cx="-6" cy="-5" r="1.4" fill="#f5c663" />
          <circle cx="6" cy="-5" r="1.4" fill="#f5c663" />
          <circle cx="-6" cy="5" r="1.4" fill="#f5c663" />
          <circle cx="6" cy="5" r="1.4" fill="#f5c663" />
        </g>

        <g transform="translate(4, -16)">
          <path d="M -34 -14 Q -16 -20 0 -13 Q 16 -20 34 -14 L 31 15 Q 15 10 0 16 Q -15 10 -31 15 Z"
                fill="#6d3e57" stroke="${ink}" stroke-width="2.1" stroke-linejoin="round" />
          <path d="M -30 -12 Q -15 -18 0 -10 L 0 13 Q -15 7 -28 12 Z" fill="#fffaf0" stroke="${ink}" stroke-width="1.7" stroke-linejoin="round" />
          <path d="M 30 -12 Q 15 -18 0 -10 L 0 13 Q 15 7 28 12 Z" fill="#fdf3df" stroke="${ink}" stroke-width="1.7" stroke-linejoin="round" />
          <path d="M 0 12 L -3 23 L 0 20 L 3 23 Z" fill="#e09545" stroke="${ink}" stroke-width="1.2" />
          <path d="M -22 -6 H -7 M -22 -1 H -9 M -22 4 H -11 M 7 -6 H 22 M 7 -1 H 20 M 7 4 H 18" stroke="#c5ad8c" stroke-width="1.4" stroke-linecap="round" />
        </g>

        <g transform="translate(48, -16)">
          <circle r="5.5" fill="#3a4c60" stroke="${ink}" stroke-width="1.5" />
          <path d="M 1 -3 Q 10 -17 17 -18 Q 13 -8 3 -1 Z" fill="#fffaf0" stroke="${ink}" stroke-width="1.4" />
        </g>

        <g transform="translate(0, 22)">
          <rect x="-78" y="-18" width="156" height="${titleLines.length > 1 ? 48 : 38}" rx="16"
                fill="${isCandlelight ? '#2f2017' : '#fffaf0'}" stroke="${ink}" stroke-width="2.4" filter="url(#bookShadow)" />
          ${titleLines.map((ln, i) => `
            <text x="0" y="${(titleLines.length > 1 ? -1 + i * 16 : 2).toFixed(1)}" text-anchor="middle" font-size="14.5" font-weight="800" font-family="Georgia, serif"
                  fill="${isCandlelight ? '#f8ebd4' : '#352114'}">${esc(ln)}</text>
          `).join('')}
          ${subtitle ? `<text x="0" y="${(titleLines.length > 1 ? 26 : 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${isCandlelight ? '#c8ae8d' : '#856549'}">${esc(subtitle)}</text>` : ''}
        </g>
      </g>

      ${ambientLifeEnabled ? `
        <!-- Sleeping Library Cat ("Mochi") curled up on a cozy rug cushion above the Rotunda desk -->
        <g class="node-interactive" data-action="pet-cat" transform="translate(0, -68)" style="cursor:pointer;">
          <title>Mochi the Library Cat — click to pet!</title>
          <ellipse cx="0" cy="4" rx="18" ry="12" fill="#211208" opacity="0.22" />
          <ellipse cx="0" cy="1" rx="16.5" ry="11" fill="#8b4d5a" stroke="${ink}" stroke-width="1.8" />
          <ellipse cx="0" cy="0.5" rx="13" ry="8" fill="#b46b77" stroke="#f6dfc4" stroke-width="1" stroke-dasharray="3 2.5" opacity="0.8" />
          <g class="library-cat-body">
            <!-- Curled tabby body -->
            <ellipse cx="-1" cy="0" rx="10.5" ry="7.2" fill="#e6a65a" stroke="${ink}" stroke-width="1.7" />
            <path d="M -5 -5 Q -2 -1 -5 4 M 0 -6 Q 3 -1 0 5" fill="none" stroke="#b96d2b" stroke-width="1.4" stroke-linecap="round" opacity="0.75" />
            <!-- Head & ears -->
            <circle cx="7.5" cy="-1.5" r="5.4" fill="#f0b66c" stroke="${ink}" stroke-width="1.6" />
            <path d="M 4 -5.5 L 5.2 -9.2 L 8 -6.4 Z M 9 -6.2 L 11.8 -9 L 12.2 -4.8 Z" fill="#e6a65a" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round" />
            <!-- Sleepy closed eyes & pink nose -->
            <path d="M 5.6 -1.4 Q 6.8 -0.2 8 -1.4 M 9.2 -1.2 Q 10.3 0 11.4 -1.2" fill="none" stroke="${ink}" stroke-width="1.15" stroke-linecap="round" />
            <circle cx="8.8" cy="0.3" r="0.9" fill="#d97272" />
          </g>
          <!-- Gently wagging tail -->
          <path class="library-cat-tail" d="M -10 2 Q -16 6 -13 10 Q -9 11 -6 8" fill="none" stroke="#e6a65a" stroke-width="3.2" stroke-linecap="round" />
          <path class="library-cat-tail" d="M -10 2 Q -16 6 -13 10 Q -9 11 -6 8" fill="none" stroke="${ink}" stroke-width="1.2" stroke-linecap="round" opacity="0.65" />
          <!-- Soft floating Zzz -->
          <text class="library-cat-z1" x="12" y="-8" font-size="7.5" font-weight="800" font-family="Georgia, serif" fill="${isCandlelight ? '#f7dfa8' : '#7b5434'}">z</text>
          <text class="library-cat-z2" x="16" y="-13" font-size="9" font-weight="800" font-family="Georgia, serif" fill="${isCandlelight ? '#f7dfa8' : '#7b5434'}">z</text>
        </g>
      ` : ''}

      <circle cx="-12" cy="-14" r="${R - 6}" fill="url(#${isCandlelight ? 'lanternGrad' : 'sunbeamGrad'})" pointer-events="none" />
      <g pointer-events="none">${motes}</g>

      <!-- "+ Hall" and "Card Index" pills along bottom rim of the Rotunda -->
      <g class="quick-add-hit node-interactive" data-action="open-card-index" transform="translate(-44, ${R - 4})">
        <rect x="-44" y="-15" width="88" height="30" fill="transparent" />
        <g class="quick-add-inner">
          <rect x="-42" y="-13" width="84" height="26" rx="13" fill="${isCandlelight ? '#3d2a1e' : '#fff8e8'}" stroke="#c98e3b" stroke-width="2" filter="url(#bookShadow)" />
          <text x="0" y="4" text-anchor="middle" font-size="10.5" font-weight="800" fill="${isCandlelight ? '#f5c663' : '#7c4e18'}">Card Index</text>
        </g>
      </g>
      <g class="quick-add-hit node-interactive" data-action="add-hall" transform="translate(42, ${R - 4})">
        <rect x="-36" y="-15" width="72" height="30" fill="transparent" />
        <g class="quick-add-inner">
          <rect x="-34" y="-13" width="68" height="26" rx="13" fill="#c96843" stroke="${ink}" stroke-width="2" filter="url(#bookShadow)" />
          <text x="0" y="4" text-anchor="middle" font-size="11" font-weight="700" fill="#fffaf2">+ Hall</text>
        </g>
      </g>
    </g>
  `;
}

let tabletopCollapsed = false;

function doesBookMatchActiveFilter(book) {
  if (!book) return false;
  const glow = getGlowState();
  if (glow.active && glow.bookIds.has(book.id)) return true;
  if (searchMatches.active && searchMatches.query) {
    const q = searchMatches.query;
    if ((book.title || '').toLowerCase().includes(q) || (book.summary || '').toLowerCase().includes(q)) return true;
    if ((book.chapters || []).some(c => (c.title || '').toLowerCase().includes(q))) return true;
    if ((book.pages || []).some(p => doesPageMatchActiveFilter(p))) return true;
  }
  if (activeStampLensId) {
    return (book.pages || []).some(p => (p.stamps || []).includes(activeStampLensId));
  }
  return false;
}

function renderCornerTabletop() {
  const pileStackEl = document.getElementById('corner-pile-stack');
  const pileBadgeEl = document.getElementById('corner-pile-badge');
  const studyStackEl = document.getElementById('corner-study-stack');
  const studyCountEl = document.getElementById('corner-study-count');
  const toggleBtn = document.getElementById('btn-toggle-tabletop');
  if (!pileStackEl || !studyStackEl) return;

  const cartBooks = state.cart?.books || [];
  const cartPages = state.cart?.pages || [];
  const totalPile = cartBooks.length + cartPages.length;
  const pinned = getPinnedBooks();
  const glow = getGlowState();

  if (pileBadgeEl) {
    pileBadgeEl.textContent = String(totalPile);
    pileBadgeEl.style.background = totalPile > 0 ? '#c96843' : '#7a6248';
  }
  if (studyCountEl) {
    studyCountEl.textContent = `${pinned.length}/${MAX_STUDY_TABLE_BOOKS}`;
  }
  const putBackBtn = document.getElementById('btn-corner-study-putback');
  if (putBackBtn) {
    putBackBtn.classList.toggle('hidden', pinned.length === 0);
  }
  if (toggleBtn) {
    toggleBtn.innerHTML = tabletopCollapsed ? '&#9652;' : '&#9662;';
  }

  const trashCount = (state.trash || []).length;
  const recycleBadgeEl = document.getElementById('corner-recycle-badge');
  const recyclePapersEl = document.getElementById('recycle-bin-papers');
  if (recycleBadgeEl) {
    recycleBadgeEl.textContent = String(trashCount);
    recycleBadgeEl.classList.toggle('hidden', trashCount === 0);
  }
  if (recyclePapersEl) {
    recyclePapersEl.style.display = trashCount > 0 ? '' : 'none';
  }

  pileStackEl.classList.toggle('hidden', tabletopCollapsed);
  studyStackEl.classList.toggle('hidden', tabletopCollapsed);
  if (tabletopCollapsed) return;

  // ---- 1. LOWER-RIGHT SORTING PILE (PAPERS & UNFILED BOOKS) ----
  if (totalPile === 0) {
    pileStackEl.innerHTML = `
      <div id="pile-empty-pad" class="w-[172px] rounded-xl px-2.5 py-2 mb-0.5 text-center cursor-pointer transition-transform hover:-translate-y-0.5"
           style="background:${isCandlelight ? 'rgba(56,38,26,0.92)' : 'rgba(255,250,240,0.92)'}; border:1.8px dashed ${isCandlelight ? '#b88652' : '#7b5235'}; color:${isCandlelight ? '#f3dfc1' : '#5a3b22'}; box-shadow:0 3px 10px rgba(24,13,6,0.2);">
        <div class="text-[10.5px] font-storybook font-bold">Pile is All Sorted!</div>
        <div class="text-[9.5px] opacity-80">Drop books here or +Paper / +Book</div>
      </div>
    `;
    pileStackEl.querySelector('#pile-empty-pad')?.addEventListener('click', () => selectNode('cart', null, false));
  } else {
    // Interleave unfiled books and loose papers into a realistic desk pile
    const pileItems = [];
    const maxLen = Math.max(cartBooks.length, cartPages.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < cartBooks.length) pileItems.push({ kind: 'book', book: cartBooks[i] });
      if (i < cartPages.length) pileItems.push({ kind: 'paper', page: cartPages[i] });
    }

    pileStackEl.innerHTML = pileItems.map((item, idx) => {
      if (item.kind === 'book') {
        const b = item.book;
        const isSc = isScrollItem(b);
        const bsw = getSwatch(b.color);
        const isOpen = openBookState.bookId === b.id;
        const isGlow = doesBookMatchActiveFilter(b);
        const shiftX = ((hashNum(b.id) - 0.5) * 11).toFixed(1);
        const rot = ((hashNum(b.id + 'r') - 0.5) * 2.4).toFixed(1);
        return `
          <div class="pile-book-card ${isGlow ? 'is-glow-match' : ''}"
               data-pile-book-id="${b.id}"
               title="Unfiled ${isSc ? 'Scroll' : 'Book'}: &quot;${esc(b.title)}&quot; · Click to ${isSc ? 'unroll' : 'open'}, or drag onto any shelf, Study Table, or Recycle!"
               style="background:${isSc ? '#f6e6c4' : bsw.fill}; transform:translateX(${shiftX}px) rotate(${rot}deg); z-index:${idx + 1}; --glow-ring:${glow.glowOuter}; ${isOpen ? 'border-color:#ffd85a;' : ''}">
            <span class="w-1 h-3.5 rounded-full shrink-0" style="background:${isSc ? bsw.fill : bsw.rugEdge}; opacity:0.95;"></span>
            <span class="font-storybook font-bold text-[10.8px] leading-tight flex-1 min-w-0 break-words"
                  style="color:${isSc ? '#352012' : '#fffaf2'}; ${isSc ? '' : `text-shadow:0 1px 2px ${bsw.deep}, 0 0 3px ${bsw.deep};`}">${esc(b.title)}</span>
            <span class="text-[9.5px] font-extrabold px-1 rounded shrink-0"
                  style="background:${isSc ? bsw.fill : 'rgba(28,14,6,0.34)'}; color:#fff8e8;">${isSc ? 'Scroll' : `${b.pages.length}p`}</span>
            <span class="study-book-pages-trim"></span>
          </div>
        `;
      } else {
        const p = item.page;
        const isGlow = doesPageMatchActiveFilter(p);
        const shiftX = ((hashNum(p.id) - 0.5) * 13).toFixed(1);
        const rot = ((hashNum(p.id + 'r') - 0.5) * 3.6).toFixed(1);
        const stampDots = (p.stamps || []).slice(0, 3).map(sid => {
          const st = getStamp(sid);
          return st ? `<span class="w-2 h-2 rounded-full shrink-0" style="background:${st.color}; border:1px solid #3c2516;"></span>` : '';
        }).join('');
        return `
          <div class="pile-paper-card ${isGlow ? 'is-glow-match' : ''}"
               data-pile-page-id="${p.id}"
               title="Loose Paper: &quot;${esc(p.title)}&quot; · Click to open Single-Page editor, or drag onto any Book / Hall!"
               style="cursor:grab; transform:translateX(${shiftX}px) rotate(${rot}deg); z-index:${idx + 1}; --glow-ring:${glow.glowOuter};">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c4e29" stroke-width="2.2" stroke-linecap="round" class="shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>
            </svg>
            <span class="font-storybook font-bold text-[10.6px] leading-tight flex-1 min-w-0 break-words" style="color:#362215;">${esc(p.title || 'Loose Paper')}</span>
            ${stampDots}
            <button type="button" data-pile-page-sort="${p.id}" title="Sort or file in Sorting Pile panel" class="text-[9px] font-bold px-1 py-0.2 rounded shrink-0 cursor-pointer border-0 hover:brightness-95" style="background:rgba(168,110,60,0.2); color:#6b4222;">Sort</button>
          </div>
        `;
      }
    }).join('');

    // Wire unfiled books in the Sorting Pile: click to open, OR drag directly onto any map shelf or Study Table!
    pileStackEl.querySelectorAll('[data-pile-book-id]').forEach(el => {
      const bookId = el.dataset.pileBookId;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
        const book = (state.cart?.books || []).find(b => b.id === bookId);
        if (!book) return;
        dragMoved = false;
        dragStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
        bookDrag = { sourceHallId: CART_HALL_ID, bookId: book.id, book, metrics: measureBookSpine(book), dropTarget: null };
        pointerMode = 'maybe-drag-book';
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (suppressNextClick || dragMoved) return;
        openBookCenter(CART_HALL_ID, bookId);
      });
    });

    // Wire loose papers in the Sorting Pile: click to open Single-Page Center-Screen UI, or drag onto any Book / Hall!
    pileStackEl.querySelectorAll('[data-pile-page-id]').forEach(el => {
      const pageId = el.dataset.pilePageId;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('[data-pile-page-sort]')) return;
        e.preventDefault();
        e.stopPropagation();
        if (camAnim) { cancelAnimationFrame(camAnim); camAnim = null; }
        const page = (state.cart?.pages || []).find(p => p.id === pageId);
        if (!page) return;
        dragMoved = false;
        dragStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
        paperDrag = { cartPageId: page.id, page, dropTarget: null };
        pointerMode = 'maybe-drag-paper';
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (suppressNextClick || dragMoved) return;
        if (e.target.closest('[data-pile-page-sort]')) {
          expandedCartPageId = pageId;
          selectNode('cart', null, false);
          return;
        }
        openLoosePaperCenter(pageId);
      });
    });
  }

  // ---- 2. LOWER-RIGHT STUDY TABLE TOP (UP TO 11 STACKED BOOKS WITH LEGIBLE UNCOVERED TITLES) ----
  if (pinned.length === 0) {
    studyStackEl.innerHTML = `
      <div id="study-empty-pad" class="w-[232px] rounded-xl px-3 py-2 mb-0.5 text-center cursor-pointer transition-transform hover:-translate-y-0.5"
           style="background:${isCandlelight ? 'rgba(56,38,26,0.92)' : 'rgba(255,250,240,0.92)'}; border:1.8px dashed ${isCandlelight ? '#b88652' : '#7b5235'}; color:${isCandlelight ? '#f3dfc1' : '#5a3b22'}; box-shadow:0 3px 10px rgba(24,13,6,0.2);">
        <div class="text-[10.5px] font-storybook font-bold">Study Table is Clear (0/${MAX_STUDY_TABLE_BOOKS})</div>
        <div class="text-[9.5px] opacity-80">Drag up to 11 books here or click &#9733; inside any book</div>
      </div>
    `;
    studyStackEl.querySelector('#study-empty-pad')?.addEventListener('click', () => selectNode('study', null, false));
  } else {
    const hasAnyModalOpen = Boolean(openBookState.bookId);
    studyStackEl.innerHTML = pinned.map((entry, idx) => {
      const b = entry.book;
      const isSc = isScrollItem(b);
      const bsw = getSwatch(b.color || entry.hall.color);
      const isOpen = openBookState.bookId === b.id;
      const isGlow = doesBookMatchActiveFilter(b);
      const staggerX = ((idx % 2 === 0 ? -1 : 1) * ((idx % 3) * 2.2)).toFixed(1);
      const pagesOnLeft = idx % 2 === 1;
      return `
        <div class="study-stack-book ${isOpen ? 'is-open-book' : ''} ${isGlow ? 'is-glow-match' : ''}"
             draggable="true"
             data-study-stack-idx="${idx}"
             data-study-stack-hall="${entry.hall.id}"
             data-study-stack-book="${b.id}"
             title="Open ${isSc ? 'Scroll' : 'Book'} &quot;${esc(b.title)}&quot; (${esc(entry.hall.title)}) · Drag to reorder stack, or drag to Recycle!"
             style="background:${isSc ? '#f6e6c4' : bsw.fill}; transform:translateX(${staggerX}px); z-index:${idx + 1}; --glow-ring:${glow.glowOuter};">
          ${pagesOnLeft ? `<span class="study-book-pages-trim" style="border-left:0; border-right:1.5px solid #3c2516; border-radius:4px 2px 2px 4px;"></span>` : ''}
          <span class="w-1 self-stretch rounded-full shrink-0" style="background:${isSc ? bsw.fill : bsw.rugEdge}; opacity:0.92;"></span>
          <span class="font-storybook font-bold text-[11.2px] leading-[1.18] flex-1 min-w-0 break-words py-0.5"
                style="color:${isSc ? '#352012' : '#fffaf2'}; ${isSc ? '' : `text-shadow:0 1px 2px ${bsw.deep}, 0 0 3px ${bsw.deep};`}">${esc(b.title)}</span>
          <span class="text-[9.5px] font-extrabold px-1.5 py-0.2 rounded-full shrink-0"
                style="background:${isSc ? bsw.fill : 'rgba(28,14,6,0.32)'}; color:#fff8e8;">${isSc ? 'Scroll' : `${b.pages.length}p`}</span>
          ${hasAnyModalOpen && !isOpen ? `
            <button type="button" data-study-stack-peek="${b.id}" title="Peek / Compare side-by-side next to your open page"
                    class="px-1.5 py-0.2 rounded-full text-[9.5px] font-extrabold cursor-pointer bg-amber-100/90 hover:bg-amber-200 border border-amber-950/40 shrink-0"
                    style="color:#352012;">Peek</button>
          ` : ''}
          <button type="button" data-study-stack-unpin="${b.id}" title="Remove from Study Table"
                  class="w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-extrabold cursor-pointer bg-black/25 hover:bg-black/50 border-0 shrink-0"
                  style="color:#fffaf0; line-height:1;">&times;</button>
          ${!pagesOnLeft ? `<span class="study-book-pages-trim"></span>` : ''}
        </div>
      `;
    }).join('');

    studyStackEl.querySelectorAll('[data-study-stack-book]').forEach(el => {
      const bookId = el.dataset.studyStackBook;
      const hallId = el.dataset.studyStackHall;

      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-study-stack-unpin]') || e.target.closest('[data-study-stack-peek]')) return;
        if (e.shiftKey && openBookState.bookId && openBookState.bookId !== bookId) {
          openReferencePeek(bookId);
          return;
        }
        openBookCenter(hallId, bookId);
      });

      // Drag to reorder books within the 11-book Study Table stack, recycle them, OR drop an open-book page onto this Study Table book!
      el.addEventListener('dragstart', (e) => {
        listDrag = { type: 'study-stack', id: bookId, hallId };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', bookId);
        el.classList.add('dragging-item');
      });
      el.addEventListener('dragend', () => {
        listDrag = null;
        clearDropMarkers(studyStackEl);
        clearCornerDropHighlights();
      });
      el.addEventListener('dragover', (e) => {
        if (!listDrag) return;
        if (listDrag.type === 'study-stack' && listDrag.id !== bookId) {
          e.preventDefault();
          clearDropMarkers(studyStackEl);
          const rect = el.getBoundingClientRect();
          // Note: flex-col-reverse means top half visually is higher index in studyStack
          el.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
        } else if (listDrag.type === 'page' && listDrag.bookId !== bookId) {
          e.preventDefault();
          clearCornerDropHighlights();
          el.classList.add('study-drop-active');
        }
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('study-drop-active');
      });
      el.addEventListener('drop', (e) => {
        if (!listDrag) return;
        if (listDrag.type === 'study-stack' && listDrag.id !== bookId) {
          e.preventDefault();
          const rect = el.getBoundingClientRect();
          const placeAboveVisually = e.clientY < rect.top + rect.height / 2;
          const draggedId = listDrag.id;
          listDrag = null;
          clearDropMarkers(studyStackEl);
          reorderStudyTableStack(draggedId, bookId, placeAboveVisually);
        } else if (listDrag.type === 'page' && listDrag.bookId !== bookId) {
          e.preventDefault();
          const { hallId: fromHallId, bookId: fromBookId, id: pageId } = listDrag;
          listDrag = null;
          clearCornerDropHighlights();
          clearDropMarkers(document);
          moveBookPageToAnotherBook(fromHallId, fromBookId, pageId, bookId);
        }
      });
    });

    studyStackEl.querySelectorAll('[data-study-stack-peek]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openReferencePeek(btn.dataset.studyStackPeek);
      });
    });

    studyStackEl.querySelectorAll('[data-study-stack-unpin]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePinBook(btn.dataset.studyStackUnpin, false);
      });
    });
  }
}

// --- Collapsible Corner Floorplan Minimap ---
let minimapTransform = { minX: -500, minY: -500, scale: 0.1, padX: 0, padY: 0, w: 188, h: 118 };

function renderMinimap() {
  const mmSvg = document.getElementById('minimap-svg');
  if (!mmSvg || minimapCollapsed) return;
  const W = 188, H = 118, pad = 10;
  const bw = Math.max(420, worldBounds.maxX - worldBounds.minX);
  const bh = Math.max(320, worldBounds.maxY - worldBounds.minY);
  const sc = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
  const offX = (W - bw * sc) / 2 - worldBounds.minX * sc;
  const offY = (H - bh * sc) / 2 - worldBounds.minY * sc;
  minimapTransform = { minX: worldBounds.minX, minY: worldBounds.minY, scale: sc, offX, offY, w: W, h: H };

  const tx = (x) => (x * sc + offX).toFixed(1);
  const ty = (y) => (y * sc + offY).toFixed(1);
  const glow = getGlowState();
  let html = '';

  // Hall corridors
  layoutCache.halls.forEach(hg => {
    const sw = getSwatch(hg.hall.color);
    const p0 = hg.spineAt(0), p1 = hg.spineAt(1);
    const isGlow = glow.active && (glow.hallIds.has(hg.hall.id) || glow.collapsedGlowHallIds.has(hg.hall.id));
    html += `<line x1="${tx(p0.x)}" y1="${ty(p0.y)}" x2="${tx(p1.x)}" y2="${ty(p1.y)}" stroke="${isGlow ? glow.glowOuter : sw.fill}" stroke-width="${hg.depth === 0 ? 5.5 : 3.5}" stroke-linecap="round" opacity="${hg.collapsed ? 0.65 : 0.85}" />`;
    hg.bays.forEach(bay => {
      const hasGlow = glow.active && bay.items.some(it => glow.bookIds.has(it.book.id));
      const rw = Math.max(4.5, bay.outerW * sc);
      const rh = Math.max(3.5, bay.outerH * sc);
      html += `<rect x="${(bay.x * sc + offX - rw / 2).toFixed(1)}" y="${(bay.y * sc + offY - rh / 2).toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="1.5" fill="${hasGlow ? glow.glowOuter : (isCandlelight ? '#9c7150' : '#7b5235')}" stroke="${hasGlow ? '#fff3c4' : 'none'}" stroke-width="1.2" />`;
    });
  });

  // Central Rotunda
  html += `<circle cx="${tx(0)}" cy="${ty(0)}" r="${Math.max(7, HUB_RADIUS * sc).toFixed(1)}" fill="${isCandlelight ? '#a66b43' : '#d68260'}" stroke="${isCandlelight ? '#f7e5be' : '#3c2516'}" stroke-width="1.2" />`;

  // Glowing search / stamp beacons on top
  if (glow.active) {
    getGlowHopTargets().forEach(t => {
      html += `<circle cx="${tx(t.x)}" cy="${ty(t.y)}" r="4.2" fill="${glow.glowOuter}" stroke="#ffffff" stroke-width="1.1" />`;
    });
  }

  // Live Camera Viewport rectangle
  html += `<rect id="minimap-vp" x="0" y="0" width="20" height="20" rx="2.5" fill="rgba(201,104,67,0.14)" stroke="#c96843" stroke-width="1.6" pointer-events="none" />`;
  mmSvg.innerHTML = html;
  updateMinimapViewport();
}

function updateMinimapViewport() {
  const vp = document.getElementById('minimap-vp');
  if (!vp || minimapCollapsed) return;
  const rect = canvasWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const tl = screenToWorld(rect.left, rect.top);
  const br = screenToWorld(rect.right, rect.bottom);
  const { scale, offX, offY } = minimapTransform;
  const x = tl.x * scale + offX;
  const y = tl.y * scale + offY;
  const w = Math.max(8, (br.x - tl.x) * scale);
  const h = Math.max(8, (br.y - tl.y) * scale);
  vp.setAttribute('x', x.toFixed(1));
  vp.setAttribute('y', y.toFixed(1));
  vp.setAttribute('width', w.toFixed(1));
  vp.setAttribute('height', h.toFixed(1));
}
