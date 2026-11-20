// ============================================================
// 6B. COZY FOLEY AUDIO & TWO-WAY LITTLE LIBRARIANS (~2s ADAPTIVE PACE + AMBIENT LIFE)
// ============================================================
let ambientLifeEnabled = true;
let soundEnabled = false; // Muted by default!
let cozyAudioCtx = null;

function playCozySound(kind = 'page') {
  if (!soundEnabled) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    if (!cozyAudioCtx) cozyAudioCtx = new AudioCtx();
    if (cozyAudioCtx.state === 'suspended') cozyAudioCtx.resume();
    const now = cozyAudioCtx.currentTime;

    if (kind === 'page') {
      // Soft filtered paper rustle
      const dur = 0.085;
      const buf = cozyAudioCtx.createBuffer(1, Math.floor(cozyAudioCtx.sampleRate * dur), cozyAudioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const env = Math.sin((i / data.length) * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env * 0.22;
      }
      const src = cozyAudioCtx.createBufferSource();
      src.buffer = buf;
      const filter = cozyAudioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1900, now);
      filter.Q.setValueAtTime(1.1, now);
      const gain = cozyAudioCtx.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      src.connect(filter).connect(gain).connect(cozyAudioCtx.destination);
      src.start(now);
    } else if (kind === 'thump') {
      // Warm wooden bookshelf thump
      const osc = cozyAudioCtx.createOscillator();
      const gain = cozyAudioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(155, now);
      osc.frequency.exponentialRampToValueAtTime(58, now + 0.11);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain).connect(cozyAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (kind === 'chime') {
      // Gentle brass bell chime
      const osc = cozyAudioCtx.createOscillator();
      const gain = cozyAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.setValueAtTime(988, now + 0.065);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain).connect(cozyAudioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.29);
    } else if (kind === 'purr') {
      // Cozy low cat purr rumble
      const osc = cozyAudioCtx.createOscillator();
      const lfo = cozyAudioCtx.createOscillator();
      const lfoGain = cozyAudioCtx.createGain();
      const gain = cozyAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(72, now);
      lfo.frequency.setValueAtTime(24, now);
      lfoGain.gain.setValueAtTime(0.05, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(gain).connect(cozyAudioCtx.destination);
      lfo.start(now); osc.start(now);
      lfo.stop(now + 0.56); osc.stop(now + 0.56);
    }
  } catch (err) {}
}

const LIBRARIAN_PERSONAS = [
  { name: 'Archivist Maren', coat: '#567d5c', coatDeep: '#335238', hair: '#6e3f25', hat: 'bun' },
  { name: 'Junior Page Pip', coat: '#d4953b', coatDeep: '#8c5b19', hair: '#4a2e1b', hat: 'cap' },
  { name: 'Head Librarian Orin', coat: '#6e476b', coatDeep: '#442642', hair: '#f3ead8', hat: 'mustache' }
];
let activeLibrarians = [];
let librarianRafId = null;
let librarianSpawnCounter = 0;

function isBookCarriedByLibrarian(bookId) {
  if (!bookId || activeLibrarians.length === 0) return false;
  return activeLibrarians.some(a => a.kind === 'book' && (a.direction === 'out' || a.direction === 'transfer') && a.bookId === bookId && !a.arrived);
}

function captureTabletopItemScreenPoint(source = 'pile', itemId = null) {
  if (itemId) {
    const sel = source === 'study'
      ? `#corner-study-stack [data-study-stack-book="${itemId}"]`
      : `#corner-pile-stack [data-pile-book-id="${itemId}"], #corner-pile-stack [data-pile-page-id="${itemId}"]`;
    const itemEl = document.querySelector(sel);
    if (itemEl) {
      const r = itemEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.left + r.width * 0.42, y: r.top + r.height * 0.5 };
      }
    }
  }
  const zoneEl = source === 'study'
    ? (document.getElementById('corner-study-zone') || document.getElementById('corner-tabletop-wrap'))
    : (document.getElementById('corner-pile-zone') || document.getElementById('corner-tabletop-wrap'));
  if (zoneEl) {
    const r = zoneEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + r.width * 0.46, y: r.top + Math.min(24, r.height * 0.25) };
    }
  }
  return { x: window.innerWidth - 210, y: window.innerHeight - 95 };
}

function resolveLibrarianTargetWorldPoint(bookId, hallId) {
  if (bookId && layoutCache.books && layoutCache.books[bookId]) {
    const bEntry = layoutCache.books[bookId];
    return {
      x: bEntry.x,
      y: bEntry.y + 18,
      spineTopX: bEntry.spineTopX,
      spineTopY: bEntry.spineTopY
    };
  }
  if (hallId && layoutCache.halls) {
    const hg = layoutCache.halls.find(h => h.hall.id === hallId);
    if (hg) {
      if (hg.bays && hg.bays.length > 0) {
        const lastBay = hg.bays[hg.bays.length - 1];
        return { x: lastBay.x, y: lastBay.y + 18, spineTopX: lastBay.x, spineTopY: lastBay.y - 24 };
      }
      return { x: hg.bannerPt.x, y: hg.bannerPt.y + 16, spineTopX: hg.bannerPt.x, spineTopY: hg.bannerPt.y - 12 };
    }
  }
  return { x: 0, y: 40, spineTopX: 0, spineTopY: 0 };
}

function buildPolylineMetrics(pts, endX, endY, spineTopX, spineTopY) {
  const clean = [];
  pts.forEach(pt => {
    const prev = clean[clean.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 2.2) clean.push(pt);
  });
  const cumLen = [0];
  let totalDist = 0;
  for (let i = 1; i < clean.length; i++) {
    totalDist += Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y);
    cumLen.push(totalDist);
  }
  return { pts: clean, cumLen, totalDist: Math.max(45, totalDist), endX, endY, spineTopX, spineTopY };
}

// Build an exact hallway-following polyline from the Center Rotunda Desk (0,-4) down each corridor & sub-hall carpet to the shelf!
function buildLibrarianHallwayRoute(bookId, hallId, laneOffset = 0) {
  const bEntry = (bookId && layoutCache.books) ? layoutCache.books[bookId] : null;
  const resolvedHallId = bEntry ? bEntry.hall.id : hallId;
  const target = resolveLibrarianTargetWorldPoint(bookId, resolvedHallId);

  const chain = [];
  let curId = resolvedHallId;
  const guard = new Set();
  while (curId && !guard.has(curId)) {
    guard.add(curId);
    const hg = layoutCache.hallMap?.[curId];
    if (!hg) break;
    chain.unshift(hg);
    curId = hg.parentId;
  }

  const pts = [{ x: 0, y: -4 }];
  if (chain.length > 0) {
    const firstHg = chain[0];
    const ent = firstHg.spineAt(0);
    pts.push({ x: ent.x * 0.45 + firstHg.perpX * laneOffset * 0.5, y: ent.y * 0.45 + firstHg.perpY * laneOffset * 0.5 });

    chain.forEach((hg, idx) => {
      const isLast = idx === chain.length - 1;
      let tEnd = 0.96;
      if (isLast) {
        if (bEntry && !bEntry.collapsedProxy && typeof bEntry.bayGeom?.tBay === 'number') {
          tEnd = bEntry.bayGeom.tBay;
        } else if (hg.bays && hg.bays.length > 0 && typeof hg.bays[hg.bays.length - 1].tBay === 'number') {
          tEnd = hg.bays[hg.bays.length - 1].tBay;
        } else {
          tEnd = 0.7;
        }
      }
      const steps = isLast ? 10 : 12;
      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * tEnd;
        const p = hg.spineAt(t);
        const taper = (isLast && s === steps) ? 0.25 : 1;
        pts.push({ x: p.x + hg.perpX * laneOffset * taper, y: p.y + hg.perpY * laneOffset * taper });
      }
    });
  }
  pts.push({ x: target.x, y: target.y });
  return buildPolylineMetrics(pts, target.x, target.y, target.spineTopX, target.spineTopY);
}

// Build full route supporting: 'out' (Rotunda->Shelf), 'in' (Shelf->Rotunda), 'transfer' (Old Hall->Rotunda->New Hall), 'stroll' (Rotunda->Hall->Rotunda)
function buildLibrarianRouteForAgent(a) {
  if (a.direction === 'in') {
    const outRoute = buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
    const revPts = [...outRoute.pts].reverse();
    return buildPolylineMetrics(revPts, 0, -4, 0, -24);
  }
  if (a.direction === 'transfer') {
    const fromOut = buildLibrarianHallwayRoute(null, a.fromHallId, a.laneOffset);
    const toOut = buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
    const combined = [...[...fromOut.pts].reverse(), ...toOut.pts.slice(1)];
    return buildPolylineMetrics(combined, toOut.endX, toOut.endY, toOut.spineTopX, toOut.spineTopY);
  }
  if (a.direction === 'stroll') {
    const outRoute = buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
    const pausePt = outRoute.pts[outRoute.pts.length - 1];
    const combined = [...outRoute.pts, pausePt, pausePt, ...[...outRoute.pts].reverse().slice(1)];
    return buildPolylineMetrics(combined, 0, -4, 0, -24);
  }
  return buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
}

function samplePolylineAt(route, frac) {
  const { pts, cumLen, totalDist } = route;
  if (pts.length === 0) return { x: 0, y: 0, tx: 1, ty: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
  const targetLen = Math.max(0, Math.min(1, frac)) * totalDist;
  let segIdx = 0;
  while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetLen) {
    segIdx++;
  }
  const segStart = cumLen[segIdx];
  const segEnd = cumLen[segIdx + 1];
  const segLen = Math.max(0.0001, segEnd - segStart);
  const localT = Math.max(0, Math.min(1, (targetLen - segStart) / segLen));
  const p0 = pts[segIdx];
  const p1 = pts[segIdx + 1];
  return {
    x: p0.x + (p1.x - p0.x) * localT,
    y: p0.y + (p1.y - p0.y) * localT,
    tx: p1.x - p0.x,
    ty: p1.y - p0.y
  };
}

function easeLibrarianWalk(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const s = t * t * (3 - 2 * t);
  return 0.36 * t + 0.64 * s;
}

function dispatchLibrarian(opts = {}) {
  const seq = librarianSpawnCounter++;
  const persona = LIBRARIAN_PERSONAS[seq % LIBRARIAN_PERSONAS.length];
  const laneOffset = ((seq % 3) - 1) * 7.5;
  const direction = opts.direction || 'out'; // 'out' | 'in' | 'transfer' | 'stroll'

  computeLayout();
  const stub = { direction, bookId: opts.bookId || null, hallId: opts.hallId || null, fromHallId: opts.fromHallId || null, laneOffset };
  const route = buildLibrarianRouteForAgent(stub);
  const dist = route.totalDist;

  // Walk duration stays right around ~2.0 seconds (1880ms - 2140ms) for deliveries/fetches/transfers,
  // so librarians automatically hustle faster down longer hallways; ambient strolls are a relaxed ~5.6s round-trip!
  const walkDuration = direction === 'stroll'
    ? Math.round(5200 + Math.min(1, dist / 2200) * 1400)
    : Math.round(1880 + Math.min(1, dist / 1800) * 260);
  const flourishDuration = direction === 'stroll' ? 220 : 390;

  activeLibrarians.push({
    id: uid('lib'),
    seq,
    persona,
    direction,
    kind: opts.kind || (direction === 'stroll' ? 'none' : 'book'), // 'book' | 'paper' | 'none'
    source: opts.source || 'pile',
    bookId: opts.bookId || null,
    hallId: opts.hallId || null,
    fromHallId: opts.fromHallId || null,
    title: opts.title || 'Book',
    colorId: opts.colorId || state.palette?.[0]?.id || 'terracotta',
    laneOffset,
    dist,
    endX: route.endX,
    endY: route.endY,
    spineTopX: route.spineTopX,
    spineTopY: route.spineTopY,
    startTime: performance.now() + (opts.delayMs || 0),
    walkDuration,
    flourishDuration,
    arrived: false
  });

  renderMap();
  if (!librarianRafId) {
    librarianRafId = requestAnimationFrame(stepLibrariansAnimation);
  }
}

// Ambient Strolling Librarian scheduler (when ambientLifeEnabled is ON)
let ambientStrollTimer = null;
function scheduleNextAmbientStroll() {
  clearTimeout(ambientStrollTimer);
  if (!ambientLifeEnabled) return;
  ambientStrollTimer = setTimeout(() => {
    if (ambientLifeEnabled && !openBookState.bookId && activeLibrarians.length === 0) {
      const visibleHalls = (layoutCache.halls || []).filter(hg => !hg.collapsed);
      if (visibleHalls.length > 0) {
        const pick = visibleHalls[Math.floor(Math.random() * visibleHalls.length)];
        dispatchLibrarian({
          direction: 'stroll',
          kind: 'none',
          hallId: pick.hall.id,
          title: 'Checking shelves…',
          colorId: pick.hall.color
        });
      }
    }
    scheduleNextAmbientStroll();
  }, 12500 + Math.random() * 6000);
}

function renderLibrariansOverlaySVG(now = performance.now()) {
  if (!librarianLayerEl) return;
  if (activeLibrarians.length === 0) {
    librarianLayerEl.innerHTML = '';
    return;
  }
  const ink = isCandlelight ? '#140b06' : '#3c2516';
  let out = '';

  activeLibrarians.forEach(a => {
    const elapsed = now - a.startTime;
    if (elapsed < 0) return;

    const route = buildLibrarianRouteForAgent(a);
    a.endX = route.endX;
    a.endY = route.endY;
    a.spineTopX = route.spineTopX;
    a.spineTopY = route.spineTopY;
    const dist = route.totalDist;

    const walkRaw = Math.min(1, Math.max(0, elapsed / a.walkDuration));
    const e = easeLibrarianWalk(walkRaw);
    const pos = samplePolylineAt(route, e);
    const wx = pos.x;
    const wy = pos.y;
    const facing = pos.tx >= -1.2 ? 1 : -1;

    const speedPxPerSec = dist / (a.walkDuration / 1000);
    const isStroll = a.direction === 'stroll';
    const isHustling = !isStroll && speedPxPerSec > 320;
    const bsw = getSwatch(a.colorId);
    const p = a.persona;

    const flourishRaw = elapsed > a.walkDuration
      ? Math.min(1, (elapsed - a.walkDuration) / a.flourishDuration)
      : 0;
    const fadeOut = flourishRaw > 0.45 ? Math.max(0, 1 - (flourishRaw - 0.45) / 0.55) : 1;

    const totalStrides = isStroll
      ? Math.max(18, Math.min(34, 14 + dist * 0.015))
      : Math.max(11, Math.min(28, 8 + dist * 0.017));
    const walkPhase = walkRaw * totalStrides * Math.PI;
    const bobY = !a.arrived ? -Math.abs(Math.sin(walkPhase)) * (isStroll ? 3.5 : 5.2) : -Math.sin(flourishRaw * Math.PI) * 6;
    const leanDeg = !a.arrived ? (isStroll ? 2.5 : Math.min(14.5, 3 + dist / 115)) : -5;
    const foot1X = !a.arrived ? Math.sin(walkPhase) * (isStroll ? 4.8 : 6.5) : -3;
    const foot2X = !a.arrived ? -Math.sin(walkPhase) * (isStroll ? 4.8 : 6.5) : 3.5;

    // Subtle dotted footstep trail right down the carpet hallway & destination beacon while walking
    let trailHtml = '';
    if (!a.arrived && !isStroll && route.pts.length >= 2) {
      const pulseR = 14 + Math.sin(walkRaw * Math.PI * 6) * 3;
      const pathD = route.pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
      trailHtml = `
        <path d="${pathD}"
              fill="none" stroke="${bsw.fill}" stroke-width="2.2" stroke-dasharray="3 7" stroke-linecap="round" stroke-linejoin="round" opacity="0.46" />
        <circle cx="${a.endX.toFixed(1)}" cy="${(a.endY - 14).toFixed(1)}" r="${pulseR.toFixed(1)}"
                fill="none" stroke="#f5c663" stroke-width="2" stroke-dasharray="4 3" opacity="0.72" />
      `;
    }

    // Hustle wind streaks & tiny dust puffs when speeding down a long hallway
    let hustleLinesHtml = '';
    if (!a.arrived && isHustling) {
      const streakLen = Math.min(24, 9 + (speedPxPerSec - 280) * 0.025);
      const dustR1 = 2.6 + Math.abs(Math.sin(walkPhase)) * 1.8;
      const dustR2 = 2.0 + Math.abs(Math.cos(walkPhase)) * 1.5;
      hustleLinesHtml = `
        <line x1="${(-13 - streakLen).toFixed(1)}" y1="-12" x2="-13" y2="-12" stroke="#fff8e8" stroke-width="1.8" stroke-linecap="round" opacity="0.65" />
        <line x1="${(-15 - streakLen * 0.8).toFixed(1)}" y1="-4" x2="-15" y2="-4" stroke="${bsw.fill}" stroke-width="1.6" stroke-linecap="round" opacity="0.55" />
        <circle cx="-13" cy="11" r="${dustR1.toFixed(1)}" fill="#efe0c6" stroke="${ink}" stroke-width="1" opacity="0.7" />
        <circle cx="-20" cy="9" r="${dustR2.toFixed(1)}" fill="#efe0c6" stroke="${ink}" stroke-width="0.9" opacity="0.5" />
      `;
    }

    let headExtraHtml = '';
    if (p.hat === 'bun') {
      headExtraHtml = `
        <path d="M -8 -19 Q 0 -26 8 -18 Q 5 -22 -7 -17 Z" fill="${p.hair}" stroke="${ink}" stroke-width="1.5" />
        <circle cx="-6.5" cy="-23.5" r="4.8" fill="${p.hair}" stroke="${ink}" stroke-width="1.6" />
        <line x1="-11" y1="-26.5" x2="-1.5" y2="-20.5" stroke="#f5c663" stroke-width="2" stroke-linecap="round" />
      `;
    } else if (p.hat === 'cap') {
      headExtraHtml = `
        <path d="M -9 -19 Q -1 -27 9 -19 L 12 -18 Q 2 -16 -9 -19 Z" fill="${p.coatDeep}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M -5 -23 Q -11 -29 -13 -24 Q -8 -23 -5 -21" fill="#fff8e8" stroke="${ink}" stroke-width="1.2" />
      `;
    } else {
      headExtraHtml = `
        <path d="M -8 -18 Q -4 -26 6 -21 Q 1 -22 -7 -16 Z" fill="${p.hair}" stroke="${ink}" stroke-width="1.4" />
        <path d="M 1 -11.5 Q 5 -13 8.5 -10.5 Q 5 -9.5 1.5 -10.5 Z" fill="${p.hair}" stroke="${ink}" stroke-width="1.1" />
      `;
    }

    // Carried Item in Arms (Miniature Book, Fluttering Paper, or Cozy Lantern when strolling!)
    let carriedItemHtml = '';
    if (isStroll) {
      carriedItemHtml = `
        <path d="M -1 -3 Q 5 0 10 -2" fill="none" stroke="${p.coat}" stroke-width="4" stroke-linecap="round" />
        <circle cx="10.5" cy="-2" r="2.4" fill="#fce2c4" stroke="${ink}" stroke-width="1.2" />
        <g transform="translate(12, 2)">
          <rect x="-3.5" y="-2" width="7" height="9" rx="2" fill="#ffe07a" stroke="${ink}" stroke-width="1.4" />
          <circle cx="0" cy="2.5" r="9" fill="url(#lanternGrad)" opacity="0.6" />
        </g>
      `;
    } else if (!a.arrived) {
      if (a.kind === 'book') {
        carriedItemHtml = `
          <g transform="translate(10.5, -5.5) rotate(-11)">
            <rect x="-7" y="-10" width="14" height="19" rx="2.5" fill="${bsw.fill}" stroke="${ink}" stroke-width="1.8" />
            <rect x="-5" y="-11.8" width="10.5" height="2.4" rx="1" fill="#fffaf0" stroke="${ink}" stroke-width="1.1" />
            <line x1="-4.5" y1="-8" x2="-4.5" y2="7" stroke="${bsw.deep}" stroke-width="2.2" stroke-linecap="round" />
            <line x1="-6" y1="-4.5" x2="6" y2="-4.5" stroke="${bsw.rugEdge}" stroke-width="1.4" />
            <line x1="-6" y1="3.5" x2="6" y2="3.5" stroke="${bsw.rugEdge}" stroke-width="1.4" />
            <circle cx="0.5" cy="-0.5" r="2.2" fill="#f5c663" stroke="${ink}" stroke-width="0.9" />
          </g>
          <path d="M -2 -3 Q 4 1 9 -1.5" fill="none" stroke="${p.coat}" stroke-width="4.2" stroke-linecap="round" />
          <path d="M -2 -3 Q 4 1 9 -1.5" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="9.8" cy="-1.5" r="2.6" fill="#fce2c4" stroke="${ink}" stroke-width="1.3" />
        `;
      } else {
        const flutter = Math.sin(walkPhase * 1.3) * 7;
        carriedItemHtml = `
          <g transform="translate(11, -5) rotate(${(-8 + flutter).toFixed(1)})">
            <rect x="-7.5" y="-9" width="15" height="18" rx="2" fill="#fffdf6" stroke="${ink}" stroke-width="1.7" />
            <line x1="-4.5" y1="-4.5" x2="4.5" y2="-4.5" stroke="#b69874" stroke-width="1.3" stroke-linecap="round" />
            <line x1="-4.5" y1="-1" x2="4.5" y2="-1" stroke="#b69874" stroke-width="1.3" stroke-linecap="round" />
            <line x1="-4.5" y1="2.5" x2="2" y2="2.5" stroke="#b69874" stroke-width="1.3" stroke-linecap="round" />
            <circle cx="3.2" cy="4.2" r="2.4" fill="${bsw.fill}" stroke="${ink}" stroke-width="0.9" />
          </g>
          <path d="M -2 -3 Q 4 0 9 -2" fill="none" stroke="${p.coat}" stroke-width="4" stroke-linecap="round" />
          <circle cx="9.5" cy="-2" r="2.5" fill="#fce2c4" stroke="${ink}" stroke-width="1.3" />
        `;
      }
    } else {
      carriedItemHtml = `
        <path d="M 1 -4 Q 7 -11 10 -17" fill="none" stroke="${p.coat}" stroke-width="4" stroke-linecap="round" />
        <circle cx="10.2" cy="-17.5" r="2.5" fill="#fce2c4" stroke="${ink}" stroke-width="1.3" />
      `;
    }

    const lbl = truncate(a.title, 16);
    const statusTxt = a.arrived
      ? (a.direction === 'in' ? '✦ Fetched!' : (a.kind === 'paper' ? '✦ Filed!' : '✦ Shelved!'))
      : lbl;
    const tagW = Math.max(66, statusTxt.length * 5.9 + 20);

    let sparkleHtml = '';
    if (a.arrived && !isStroll) {
      const spX = a.spineTopX || a.endX;
      const spY = (a.spineTopY || (a.endY - 40)) + 16;
      const ringR = 8 + flourishRaw * 24;
      const spOp = Math.max(0, 1 - flourishRaw * 0.9);
      sparkleHtml = `
        <g transform="translate(${spX.toFixed(1)}, ${spY.toFixed(1)})" opacity="${spOp.toFixed(2)}">
          <circle r="${ringR.toFixed(1)}" fill="none" stroke="#ffd85a" stroke-width="2.6" stroke-dasharray="4 3" />
          <path d="M 0 -14 L 3 -3 L 14 0 L 3 3 L 0 14 L -3 3 L -14 0 L -3 -3 Z" fill="#ffd85a" stroke="${ink}" stroke-width="1.2" transform="scale(${(0.7 + flourishRaw * 0.5).toFixed(2)})" />
        </g>
      `;
    }

    out += `
      ${trailHtml}
      ${sparkleHtml}
      <g transform="translate(${wx.toFixed(1)}, ${wy.toFixed(1)})" opacity="${fadeOut.toFixed(2)}">
        <ellipse cx="0" cy="14" rx="13" ry="4.8" fill="#1a0e06" opacity="0.3" />
        <g transform="translate(0, ${bobY.toFixed(1)}) scale(${facing}, 1) rotate(${leanDeg.toFixed(1)})">
          ${hustleLinesHtml}
          <ellipse cx="${foot1X.toFixed(1)}" cy="11.5" rx="4.2" ry="2.6" fill="#3a2212" stroke="${ink}" stroke-width="1.5" />
          <ellipse cx="${foot2X.toFixed(1)}" cy="11.5" rx="4.2" ry="2.6" fill="#4f301b" stroke="${ink}" stroke-width="1.5" />
          <path d="M -7.5 -7.5 Q 0 -10 7.5 -7.5 L 9.5 8.5 Q 0 11 -9.5 8.5 Z" fill="${p.coat}" stroke="${ink}" stroke-width="1.9" stroke-linejoin="round" />
          <path d="M -4.5 -5.5 L 5.5 -5.5 L 6.5 8 Q 0.5 9.5 -4.5 8 Z" fill="#fff6e3" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round" />
          <circle cx="-1" cy="-2" r="1.2" fill="#f5c663" />
          <circle cx="-1" cy="2.5" r="1.2" fill="#f5c663" />
          <circle cx="0" cy="-15.5" r="8" fill="#fce2c4" stroke="${ink}" stroke-width="1.9" />
          <circle cx="4.2" cy="-13.2" r="1.9" fill="#e58c76" opacity="0.75" />
          ${headExtraHtml}
          <circle cx="2.5" cy="-15.8" r="2.7" fill="rgba(255,255,255,0.45)" stroke="${ink}" stroke-width="1.4" />
          <circle cx="7.4" cy="-15.8" r="2.5" fill="rgba(255,255,255,0.45)" stroke="${ink}" stroke-width="1.4" />
          <line x1="5.1" y1="-16" x2="5.0" y2="-16" stroke="${ink}" stroke-width="1.4" />
          <circle cx="2.8" cy="-15.8" r="1" fill="${ink}" />
          <circle cx="7.5" cy="-15.8" r="0.95" fill="${ink}" />
          ${carriedItemHtml}
        </g>

        ${!isStroll ? `
          <g transform="translate(0, ${(bobY - 37).toFixed(1)})">
            <rect x="${(-tagW / 2).toFixed(1)}" y="-10" width="${tagW.toFixed(1)}" height="19" rx="9.5"
                  fill="${a.arrived ? '#ffd85a' : (isCandlelight ? '#2f2017' : '#fffaf0')}"
                  stroke="${a.arrived ? ink : bsw.fill}" stroke-width="1.8" filter="url(#bookShadow)" />
            <text x="0" y="3" text-anchor="middle" font-size="9.5" font-weight="800" font-family="Georgia, serif"
                  fill="${a.arrived ? '#352012' : (isCandlelight ? '#f8ebd4' : '#352114')}">${esc(statusTxt)}</text>
          </g>
        ` : ''}
      </g>
    `;
  });

  librarianLayerEl.innerHTML = out;
}

function stepLibrariansAnimation(now) {
  let needsMapRefresh = false;
  const remaining = [];

  for (const a of activeLibrarians) {
    const elapsed = now - a.startTime;
    if (elapsed >= a.walkDuration && !a.arrived) {
      a.arrived = true;
      if (a.direction !== 'stroll') {
        playCozySound(a.kind === 'paper' ? 'page' : 'thump');
      }
      if (a.kind === 'book' && (a.direction === 'out' || a.direction === 'transfer')) needsMapRefresh = true;
    }
    if (elapsed < a.walkDuration + a.flourishDuration) {
      remaining.push(a);
    }
  }

  activeLibrarians = remaining;
  if (needsMapRefresh) {
    renderMap();
  } else {
    renderLibrariansOverlaySVG(now);
  }

  if (activeLibrarians.length > 0) {
    librarianRafId = requestAnimationFrame(stepLibrariansAnimation);
  } else {
    librarianRafId = null;
    if (librarianLayerEl) librarianLayerEl.innerHTML = '';
  }
}

function renderMap() {
  computeLayout();

  const ink = isCandlelight ? '#140b06' : '#3c2516';
  const woodPattern = isCandlelight ? 'woodGrainNight' : 'woodGrainDay';
  const wallColor = isCandlelight ? '#432b1c' : '#845637';
  const wallHighlight = isCandlelight ? '#69452e' : '#a8724b';
  const glow = getGlowState();

  const sortedForFloors = [...layoutCache.halls].sort((a, b) => b.depth - a.depth);
  let hallFloors = '';
  sortedForFloors.forEach(hg => { hallFloors += renderHallFloorSVG(hg, ink, woodPattern, wallColor, wallHighlight, glow); });

  let hallBanners = '', shelvesLayer = '';
  layoutCache.halls.forEach(hg => {
    hallBanners += renderHallBannerSVG(hg, ink, glow);
    hg.bays.forEach(bayGeom => { shelvesLayer += renderBookshelfBaySVG(bayGeom, ink, wallColor, wallHighlight, glow); });
  });

  const ribbonsLayer = renderCrossRefRibbonsSVG(ink, glow);

  sceneEl.innerHTML = `
    <g id="layer-halls">${hallFloors}</g>
    <g id="layer-rotunda">${renderRotundaSVG(ink, woodPattern, wallColor, wallHighlight)}</g>
    <g id="layer-banners">${hallBanners}</g>
    <g id="layer-shelves">${shelvesLayer}</g>
    <g id="layer-ribbons">${ribbonsLayer}</g>
  `;
  renderLibrariansOverlaySVG();

  const rCount = state.ribbons.length;
  document.getElementById('ribbon-toggle-label').textContent = rCount ? `Ribbons (${rCount})` : 'Ribbons';
  updateSearchHopperUI();
  updateStampLensUI();
  renderMinimap();
  renderCornerTabletop();
}
