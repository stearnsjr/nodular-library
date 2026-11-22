/* ============================================================================
   10-almanac-calendar.js
   Upper-Left Date / Time / Weather Pill + Full-Size Library Almanac & Calendar
   - Scans Birthdays & Date properties across all libraries (server + live state)
   - Persistent custom Events, Reminders & Multi-Day Blocks (/api/almanac)
   - Cached Open-Meteo weather with city/ZIP lookup, GPS & °F/°C toggle
   - Cross-library jump straight to Library > Hall > Book > Page
   ============================================================================ */
(function () {
  'use strict';

  const triggerBtn = document.getElementById('btn-almanac-trigger');
  const modalEl = document.getElementById('almanac-modal');
  if (!triggerBtn || !modalEl) return;

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTH_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const BIRTHDAY_KEY_RE = /\b(birth\s*day|bday|dob|birth\s*date|anniversary)\b/i;
  const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toYMD(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
  function parseYMD(str) {
    const [y, m, d] = String(str || '').split('-').map(Number);
    return { y, m: (m || 1) - 1, d: d || 1 };
  }
  function getTodayParts() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    return { y, m, d, ymd: toYMD(y, m, d), now };
  }
  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function normalizeYmd(val) {
    if (!val || typeof val !== 'string') return '';
    const trimmed = val.trim();
    if (YMD_RE.test(trimmed)) return trimmed;
    const m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(trimmed)) {
      return toYMD(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
    return '';
  }
  function formatTime12(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
    return `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function diffYMD(ymdA, ymdB) {
    const a = parseYMD(ymdA), b = parseYMD(ymdB);
    return Math.round((new Date(b.y, b.m, b.d) - new Date(a.y, a.m, a.d)) / 86400000);
  }
  function isMultiDay(ev) {
    return Boolean(ev.endDate && ev.endDate > ev.date);
  }
  function getSpanInfo(ev, ymd) {
    if (!isMultiDay(ev)) return null;
    const total = diffYMD(ev.date, ev.endDate) + 1;
    const dayNum = diffYMD(ev.date, ymd) + 1;
    return {
      total,
      dayNum,
      isStart: ymd === ev.date,
      isEnd: ymd === ev.endDate,
      isMiddle: ymd > ev.date && ymd < ev.endDate
    };
  }
  function formatShortRange(startYmd, endYmd) {
    const s = parseYMD(startYmd), e = parseYMD(endYmd);
    const sMon = MONTH_NAMES[s.m].slice(0, 3);
    const eMon = MONTH_NAMES[e.m].slice(0, 3);
    return s.m === e.m ? `${sMon} ${s.d}–${e.d}` : `${sMon} ${s.d} – ${eMon} ${e.d}`;
  }

  // Almanac state
  const initToday = getTodayParts();
  let viewYear = initToday.y;
  let viewMonth = initToday.m;
  let jumpYear = initToday.y;
  let selectedDate = initToday.ymd;
  let selectedEventId = null;
  let editingEventId = null;
  let activeFilter = 'all';
  let activeScope = 'all';
  let modalOpen = false;
  let mobilePane = 'month';

  let customEvents = [];
  let serverBookDates = [];
  let serverLinkTargets = [];
  let serverLibraries = [];
  let weatherData = { configured: false, unit: 'F', locationName: '' };

  function fmtTemp(f) {
    if (typeof f !== 'number' || Number.isNaN(f)) return '--';
    const u = weatherData.unit === 'C' ? 'C' : 'F';
    const val = u === 'C' ? Math.round((f - 32) * 5 / 9) : Math.round(f);
    return `${val}°${u}`;
  }
  function fmtTempShort(f) {
    if (typeof f !== 'number' || Number.isNaN(f)) return '--';
    const u = weatherData.unit === 'C' ? 'C' : 'F';
    const val = u === 'C' ? Math.round((f - 32) * 5 / 9) : Math.round(f);
    return `${val}°`;
  }

  // Extract live in-memory book dates & link targets from currently open library state
  function extractLiveStateDates() {
    const liveDates = [];
    const liveTargets = [];
    if (typeof state === 'undefined' || !state || !Array.isArray(state.halls)) {
      return { liveDates, liveTargets };
    }
    const curLibId = (typeof activeLibraryId !== 'undefined' && activeLibraryId) ? activeLibraryId : 'default';
    const curLibTitle = state.title || 'My Library';

    const walk = (halls) => {
      for (const hall of halls || []) {
        const hallTitle = hall.title || 'Untitled Hall';
        for (const book of hall.books || []) {
          const bookTitle = book.title || 'Untitled Book';
          for (const page of book.pages || []) {
            const pageTitle = page.title || 'Untitled Page';
            const lineage = {
              libraryId: curLibId,
              library: curLibTitle,
              hallId: hall.id || '',
              hall: hallTitle,
              bookId: book.id || '',
              book: bookTitle,
              pageId: page.id || '',
              page: pageTitle
            };
            liveTargets.push(lineage);

            for (const prop of page.properties || []) {
              if (!prop || typeof prop !== 'object') continue;
              const key = String(prop.key || '').trim();
              const isBirthdayKey = BIRTHDAY_KEY_RE.test(key);
              if (prop.type !== 'date' && !isBirthdayKey) continue;
              const ymd = normalizeYmd(prop.value);
              if (!ymd) continue;

              const isGenericPage = /^(profile|bio|overview|details|info|contact|notes?|page\s*1|untitled.*)$/i.test(pageTitle.trim());
              const subjectName = (isGenericPage || pageTitle.trim().toLowerCase() === bookTitle.trim().toLowerCase())
                ? bookTitle
                : pageTitle;
              const title = isBirthdayKey
                ? `${subjectName}'s ${/anniversary/i.test(key) ? 'Anniversary' : 'Birthday'}`
                : (key ? `${subjectName} — ${key}` : subjectName);

              liveDates.push({
                id: `bd-${curLibId}-${book.id}-${page.id}-${prop.id || key}`,
                source: isBirthdayKey ? 'birthday' : 'book-date',
                kind: isBirthdayKey ? 'birthday' : 'book-date',
                title,
                date: ymd,
                endDate: '',
                time: '',
                recur: isBirthdayKey ? 'yearly' : 'none',
                propertyKey: key || 'Date',
                done: false,
                notes: '',
                lineage
              });
            }
          }
        }
        if (Array.isArray(hall.subHalls) && hall.subHalls.length > 0) walk(hall.subHalls);
      }
    };
    walk(state.halls);
    return { liveDates, liveTargets };
  }

  function getAllEvents() {
    const curLibId = (typeof activeLibraryId !== 'undefined' && activeLibraryId) ? activeLibraryId : 'default';
    const { liveDates } = extractLiveStateDates();
    const otherLibDates = serverBookDates.filter(d => d.lineage?.libraryId !== curLibId);
    return [...customEvents, ...liveDates, ...otherLibDates];
  }

  function getAllLinkTargets() {
    const curLibId = (typeof activeLibraryId !== 'undefined' && activeLibraryId) ? activeLibraryId : 'default';
    const { liveTargets } = extractLiveStateDates();
    const otherTargets = serverLinkTargets.filter(t => t.libraryId !== curLibId);
    return [...liveTargets, ...otherTargets];
  }

  function eventOccursOn(ev, ymd) {
    if (isMultiDay(ev)) return ymd >= ev.date && ymd <= ev.endDate;
    const target = parseYMD(ymd);
    const orig = parseYMD(ev.date);
    if (ev.recur === 'yearly' || ev.source === 'birthday') return orig.m === target.m && orig.d === target.d;
    if (ev.recur === 'monthly') return orig.d === target.d && ymd >= ev.date;
    if (ev.recur === 'weekly') {
      const diff = Math.round((new Date(target.y, target.m, target.d) - new Date(orig.y, orig.m, orig.d)) / 86400000);
      return diff >= 0 && diff % 7 === 0;
    }
    return ev.date === ymd;
  }

  function matchesFilters(ev) {
    if (activeFilter !== 'all') {
      if (activeFilter === 'reminder' && ev.source !== 'reminder') return false;
      if (activeFilter !== 'reminder' && ev.source !== activeFilter) return false;
    }
    if (activeScope !== 'all') {
      if (!ev.lineage || ev.lineage.libraryId !== activeScope) return false;
    }
    return true;
  }

  function getEventsForDate(ymd, ignoreFilters = false) {
    const list = getAllEvents().filter(ev => (ignoreFilters || matchesFilters(ev)) && eventOccursOn(ev, ymd));
    list.sort((a, b) => (isMultiDay(b) ? 1 : 0) - (isMultiDay(a) ? 1 : 0));
    return list;
  }

  function getTurningAge(ev, targetYear) {
    if (ev.source !== 'birthday') return null;
    const age = targetYear - parseYMD(ev.date).y;
    return age > 0 && age < 130 ? age : null;
  }

  function sourceStyle(ev) {
    if (ev.source === 'birthday') return { icon: '🎂', label: ev.propertyKey || 'Birthday', bg: 'var(--ev-bday-bg)', border: 'var(--ev-bday-border)', dot: 'var(--ev-bday-dot)' };
    if (ev.source === 'book-date') return { icon: '📖', label: ev.propertyKey || 'Book Date', bg: 'var(--ev-book-bg)', border: 'var(--ev-book-border)', dot: 'var(--ev-book-dot)' };
    if (ev.kind === 'vacation' || isMultiDay(ev)) {
      return { icon: ev.kind === 'vacation' ? '🏕️' : '🗓️', label: ev.kind === 'vacation' ? 'Trip / Block' : 'Multi-Day', bg: 'var(--ev-span-bg)', border: 'var(--ev-span-border)', dot: 'var(--ev-span-dot)' };
    }
    return { icon: ev.kind === 'event' ? '📌' : '🔔', label: ev.kind === 'event' ? 'Event' : 'Reminder', bg: 'var(--ev-rem-bg)', border: 'var(--ev-rem-border)', dot: 'var(--ev-rem-dot)' };
  }

  // ---- Clock & Pill Badges ----
  function updateClock() {
    const t = getTodayParts();
    const h = t.now.getHours(), m = t.now.getMinutes();
    document.getElementById('alm-pill-time').textContent = `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
    document.getElementById('alm-pill-month').textContent = MONTH_SHORT[t.m];
    document.getElementById('alm-pill-daynum').textContent = t.d;
    const dow = t.now.getDay();
    document.getElementById('alm-pill-date').textContent = `${DAY_SHORT[dow]}, ${MONTH_NAMES[t.m].slice(0, 3)} ${t.d}`;
  }

  function updatePillBadges() {
    const t = getTodayParts();
    const todays = getEventsForDate(t.ymd, true).filter(e => !e.done);
    const badge = document.getElementById('alm-pill-today-badge');
    if (todays.length === 0) {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
      document.getElementById('alm-pill-today-count').textContent = `${todays.length} today`;
    }

    let soonBday = null;
    for (let offset = 1; offset <= 7; offset++) {
      const d = new Date(t.y, t.m, t.d + offset);
      const ymd = toYMD(d.getFullYear(), d.getMonth(), d.getDate());
      const b = getEventsForDate(ymd, true).find(ev => ev.source === 'birthday');
      if (b) { soonBday = { ev: b, offset }; break; }
    }
    const pip = document.getElementById('alm-pill-bday-soon');
    if (soonBday) {
      pip.classList.remove('hidden');
      pip.title = `${soonBday.ev.title} in ${soonBday.offset} ${soonBday.offset === 1 ? 'day' : 'days'}`;
      document.getElementById('alm-pill-bday-text').textContent = `${soonBday.offset}d`;
    } else {
      pip.classList.add('hidden');
    }
  }

  // ---- Weather UI ----
  function renderWeather() {
    const pillIcon = document.getElementById('alm-pill-wx-icon');
    const pillTemp = document.getElementById('alm-pill-wx-temp');
    const pillCond = document.getElementById('alm-pill-wx-cond');
    const hdrIcon = document.getElementById('alm-hdr-wx-icon');
    const hdrTemp = document.getElementById('alm-hdr-wx-temp');
    const hdrHl = document.getElementById('alm-hdr-wx-hl');
    const hdrLoc = document.getElementById('alm-hdr-wx-loc');
    const hdrFc = document.getElementById('alm-hdr-wx-forecast');

    if (weatherData && weatherData.configured) {
      pillIcon.textContent = weatherData.icon || '🌤️';
      pillTemp.textContent = fmtTemp(weatherData.tempF);
      pillCond.textContent = weatherData.cond || '';
      hdrIcon.textContent = weatherData.icon || '🌤️';
      hdrTemp.textContent = fmtTemp(weatherData.tempF);
      hdrHl.textContent = `H ${fmtTempShort(weatherData.hiF)} · L ${fmtTempShort(weatherData.loF)}`;
      hdrLoc.textContent = weatherData.locationName || 'Local';
      hdrFc.innerHTML = (weatherData.forecast || [])
        .map(f => `<span>${escHtml(f.day)} ${f.icon || ''} ${fmtTempShort(f.hiF)}</span>`).join('');
      const locInp = document.getElementById('alm-loc-input');
      if (locInp && !locInp.value) locInp.value = weatherData.locationName || '';
    } else {
      pillIcon.textContent = '🌤️';
      pillTemp.textContent = 'Weather';
      pillCond.textContent = 'Set city';
      hdrIcon.textContent = '🌤️';
      hdrTemp.textContent = '--';
      hdrHl.textContent = '';
      hdrLoc.textContent = 'Set location';
      hdrFc.innerHTML = '';
    }

    const uF = document.getElementById('alm-unit-f');
    const uC = document.getElementById('alm-unit-c');
    const isF = (weatherData.unit || 'F') === 'F';
    uF.style.background = isF ? 'var(--ui-accent)' : 'transparent';
    uF.style.color = isF ? '#fffaf2' : 'var(--ui-muted)';
    uC.style.background = !isF ? 'var(--ui-accent)' : 'transparent';
    uC.style.color = !isF ? '#fffaf2' : 'var(--ui-muted)';
  }

  async function loadWeather() {
    try {
      const resp = await fetch('/api/almanac/weather', { cache: 'no-store' });
      if (!resp.ok) return;
      weatherData = await resp.json();
      renderWeather();
    } catch (e) {}
  }

  async function saveWeatherConfig(payload) {
    const btn = document.getElementById('alm-btn-save-loc');
    if (btn) btn.disabled = true;
    try {
      const resp = await fetch('/api/almanac/weather/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not update weather');
      weatherData = data.weather || weatherData;
      renderWeather();
      if (payload.query || typeof payload.lat === 'number') {
        document.getElementById('alm-loc-bar').classList.add('hidden');
        if (typeof showToast === 'function') showToast(`Weather updated: ${weatherData.locationName}`);
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Weather update failed');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---- Scope & Link Selectors ----
  function populateScopeAndLinks() {
    const scopeSel = document.getElementById('alm-scope-select');
    const curLibId = (typeof activeLibraryId !== 'undefined' && activeLibraryId) ? activeLibraryId : 'default';
    const curLibTitle = (typeof state !== 'undefined' && state?.title) ? state.title : 'My Library';

    const libsMap = new Map();
    libsMap.set(curLibId, curLibTitle);
    serverLibraries.forEach(l => {
      if (l.id && !libsMap.has(l.id)) libsMap.set(l.id, l.title || l.id);
    });

    const prevScope = activeScope;
    scopeSel.innerHTML = `<option value="all">All Libraries (Unified)</option>` +
      Array.from(libsMap.entries()).map(([id, title]) =>
        `<option value="${escHtml(id)}">${escHtml(title)}${id === curLibId ? ' (Current)' : ''}</option>`
      ).join('');
    scopeSel.value = libsMap.has(prevScope) ? prevScope : 'all';
    activeScope = scopeSel.value;

    const linkSel = document.getElementById('alm-f-link');
    const prevLink = linkSel.value;
    const targets = getAllLinkTargets();
    linkSel.innerHTML = `<option value="">Standalone (Personal Calendar)</option>` +
      targets.map(t => {
        const val = JSON.stringify(t);
        const label = `${t.library} › ${t.hall} › ${t.book} › ${t.page}`;
        return `<option value="${escHtml(val)}">${escHtml(label)}</option>`;
      }).join('');
    if (prevLink) linkSel.value = prevLink;
  }

  // ---- Data Sync ----
  async function loadAlmanac() {
    try {
      const resp = await fetch('/api/almanac', { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      customEvents = Array.isArray(data.events) ? data.events : [];
      serverBookDates = Array.isArray(data.bookDates) ? data.bookDates : [];
      serverLinkTargets = Array.isArray(data.linkTargets) ? data.linkTargets : [];
      serverLibraries = Array.isArray(data.libraries) ? data.libraries : [];
      if (data.weatherConfig && !weatherData.configured) {
        weatherData.unit = data.weatherConfig.unit || 'F';
      }
      populateScopeAndLinks();
      updatePillBadges();
      if (modalOpen) renderAll();
    } catch (e) {}
  }

  // ---- Calendar Rendering (6 Week Rows + Continuous Multi-Day Spanning Bars) ----
  function renderMonthJump() {
    document.getElementById('alm-jump-yr-label').textContent = jumpYear;
    const grid = document.getElementById('alm-jump-months-grid');
    grid.innerHTML = MONTH_SHORT.map((m, idx) => {
      const active = (jumpYear === viewYear && idx === viewMonth);
      return `<button type="button" data-alm-jm="${idx}" class="storybook-btn ${active ? 'active' : ''} rounded-lg py-1 text-xs font-bold cursor-pointer">${m.charAt(0) + m.slice(1).toLowerCase()}</button>`;
    }).join('');
    grid.querySelectorAll('[data-alm-jm]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewYear = jumpYear;
        viewMonth = Number(btn.dataset.almJm);
        document.getElementById('alm-month-jump-pop').classList.add('hidden');
        renderCalendar();
      });
    });
  }

  function syncMobilePanes() {
    const mPane = document.getElementById('alm-pane-month');
    const aPane = document.getElementById('alm-pane-agenda');
    const btnM = document.getElementById('alm-mob-month');
    const btnA = document.getElementById('alm-mob-agenda');
    if (mobilePane === 'month') {
      mPane.classList.remove('hidden'); mPane.classList.add('flex');
      aPane.classList.add('hidden'); aPane.classList.remove('flex');
    } else {
      mPane.classList.add('hidden'); mPane.classList.remove('flex');
      aPane.classList.remove('hidden'); aPane.classList.add('flex');
    }
    btnM.style.background = mobilePane === 'month' ? 'var(--ui-accent)' : 'transparent';
    btnM.style.color = mobilePane === 'month' ? '#fffaf2' : 'var(--ui-muted)';
    btnA.style.background = mobilePane === 'agenda' ? 'var(--ui-accent)' : 'transparent';
    btnA.style.color = mobilePane === 'agenda' ? '#fffaf2' : 'var(--ui-muted)';
  }

  function renderCalendar() {
    const todayStr = getTodayParts().ymd;
    document.getElementById('alm-month-label').textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    const grid = document.getElementById('alm-cal-grid');
    grid.innerHTML = '';

    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    const seenInMonth = new Set();
    const allEvs = getAllEvents();

    const cells = [];
    for (let i = 0; i < 42; i++) {
      let y = viewYear, m = viewMonth, d, isOther = false;
      if (i < firstDow) {
        isOther = true; m = viewMonth - 1; if (m < 0) { m = 11; y--; }
        d = prevMonthDays - (firstDow - 1 - i);
      } else if (i >= firstDow + daysInMonth) {
        isOther = true; m = viewMonth + 1; if (m > 11) { m = 0; y++; }
        d = i - (firstDow + daysInMonth) + 1;
      } else {
        d = i - firstDow + 1;
      }
      const ymd = toYMD(y, m, d);
      const dayEvs = getEventsForDate(ymd);
      if (!isOther) dayEvs.forEach(ev => seenInMonth.add(ev.id));
      cells.push({ y, m, d, ymd, isOther, dayEvs });
    }

    const MAX_LANES = 3;

    for (let w = 0; w < 6; w++) {
      const weekDays = cells.slice(w * 7, w * 7 + 7);
      const weekStart = weekDays[0].ymd;
      const weekEnd = weekDays[6].ymd;

      const segments = [];
      const addedMulti = new Set();

      allEvs.filter(ev => matchesFilters(ev) && isMultiDay(ev)).forEach(ev => {
        if (ev.endDate < weekStart || ev.date > weekEnd) return;
        if (addedMulti.has(ev.id)) return;
        addedMulti.add(ev.id);

        const startCol = ev.date <= weekStart ? 0 : Math.max(0, diffYMD(weekStart, ev.date));
        const endCol = ev.endDate >= weekEnd ? 6 : Math.min(6, diffYMD(weekStart, ev.endDate));
        segments.push({
          ev,
          startCol,
          endCol,
          spanLen: endCol - startCol + 1,
          isMulti: true,
          continuesLeft: ev.date < weekStart,
          continuesRight: ev.endDate > weekEnd,
          clickYmd: weekDays[startCol].ymd
        });
      });

      segments.sort((a, b) => b.spanLen - a.spanLen || a.startCol - b.startCol);

      weekDays.forEach((day, col) => {
        day.dayEvs.filter(ev => !isMultiDay(ev)).forEach(ev => {
          segments.push({
            ev,
            startCol: col,
            endCol: col,
            spanLen: 1,
            isMulti: false,
            continuesLeft: false,
            continuesRight: false,
            clickYmd: day.ymd
          });
        });
      });

      const lanes = [];
      const overflowCount = [0, 0, 0, 0, 0, 0, 0];

      segments.forEach(seg => {
        let placed = false;
        for (let l = 0; l < MAX_LANES; l++) {
          if (!lanes[l]) lanes[l] = [];
          const collides = lanes[l].some(other => !(seg.endCol < other.startCol || seg.startCol > other.endCol));
          if (!collides) {
            lanes[l].push(seg);
            placed = true;
            break;
          }
        }
        if (!placed) {
          for (let c = seg.startCol; c <= seg.endCol; c++) overflowCount[c]++;
        }
      });

      const weekEl = document.createElement('div');
      weekEl.className = 'relative min-h-0';

      const bgRow = document.createElement('div');
      bgRow.className = 'grid grid-cols-7 gap-1 h-full';

      weekDays.forEach((day, col) => {
        const isToday = day.ymd === todayStr;
        const isSel = day.ymd === selectedDate;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `cal-cell rounded-xl p-1.5 flex flex-col items-stretch text-left border cursor-pointer overflow-hidden ${day.isOther ? 'is-other-month' : ''} ${isSel ? 'is-selected' : ''}`;
        cell.style.borderColor = isSel ? 'var(--ui-accent)' : 'var(--ui-paper-line)';

        cell.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold tabular-nums w-5 h-5 rounded-full flex items-center justify-center"
              style="${isToday ? 'background: var(--ui-accent); color: #fffaf2;' : 'color: var(--ui-ink);'}">${day.d}</span>
            <span class="flex items-center gap-1">
              ${overflowCount[col] > 0 ? `<span class="text-[9.5px] font-bold" style="color:var(--ui-accent);">+${overflowCount[col]}</span>` : ''}
              ${day.dayEvs.length > 0 ? `<span class="flex gap-0.5">${day.dayEvs.slice(0, 3).map(ev => `<span class="w-1.5 h-1.5 rounded-full" style="background:${sourceStyle(ev).dot}"></span>`).join('')}</span>` : ''}
            </span>
          </div>
        `;

        cell.addEventListener('click', () => {
          selectedDate = day.ymd;
          if (day.isOther) { viewYear = day.y; viewMonth = day.m; }
          const firstEv = getEventsForDate(day.ymd)[0];
          selectedEventId = firstEv ? firstEv.id : null;
          if (window.innerWidth < 1024) { mobilePane = 'agenda'; syncMobilePanes(); }
          renderAll();
        });

        cell.addEventListener('dblclick', () => {
          selectedDate = day.ymd;
          if (window.innerWidth < 1024) { mobilePane = 'agenda'; syncMobilePanes(); }
          openEventForm(null, day.ymd);
        });

        bgRow.appendChild(cell);
      });

      weekEl.appendChild(bgRow);

      const lanesWrap = document.createElement('div');
      lanesWrap.className = 'pointer-events-none absolute inset-x-0 top-[28px] bottom-1 flex flex-col gap-[3px] overflow-hidden';

      for (let l = 0; l < lanes.length; l++) {
        const laneRow = document.createElement('div');
        laneRow.className = 'grid grid-cols-7 gap-1 px-[3px] shrink-0';
        laneRow.style.gridTemplateRows = '19px';

        lanes[l].sort((a, b) => a.startCol - b.startCol).forEach(seg => {
          const st = sourceStyle(seg.ev);
          const isSelEv = seg.ev.id === selectedEventId;
          const pill = document.createElement('button');
          pill.type = 'button';

          const radL = seg.continuesLeft ? 'rounded-l-none -ml-[3px] pl-2' : 'rounded-l-md';
          const radR = seg.continuesRight ? 'rounded-r-none -mr-[3px] pr-2' : 'rounded-r-md';
          const borderLeft = seg.continuesLeft ? 'border-left: none;' : `border-left: 3px solid ${st.dot};`;
          const borderRight = seg.continuesRight ? 'border-right: none;' : `border-right: 1px solid ${st.border};`;

          pill.className = `pointer-events-auto truncate text-left text-[10.5px] leading-[17px] h-[19px] px-1.5 font-semibold cursor-pointer transition-all hover:brightness-110 ${radL} ${radR} ${seg.ev.done ? 'line-through opacity-55' : ''}`;
          pill.style.cssText = `grid-row: 1; grid-column: ${seg.startCol + 1} / ${seg.endCol + 2}; background:${st.bg}; ${borderLeft} ${borderRight} border-top: 1px solid ${st.border}; border-bottom: 1px solid ${st.border}; color: var(--ui-ink); ${isSelEv ? 'box-shadow: 0 0 0 1.5px var(--ui-accent);' : ''}`;

          const prefix = seg.continuesLeft ? '◂ ' : '';
          const suffix = seg.continuesRight ? ' ▸' : '';
          pill.innerHTML = `${prefix}${st.icon} ${escHtml(seg.ev.title)}${suffix}`;
          pill.title = seg.isMulti
            ? `${seg.ev.title} (${formatShortRange(seg.ev.date, seg.ev.endDate)})`
            : seg.ev.title;

          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedDate = seg.clickYmd;
            selectedEventId = seg.ev.id;
            const p2 = parseYMD(seg.clickYmd);
            if (p2.m !== viewMonth || p2.y !== viewYear) { viewYear = p2.y; viewMonth = p2.m; }
            if (window.innerWidth < 1024) { mobilePane = 'agenda'; syncMobilePanes(); }
            renderAll();
          });

          laneRow.appendChild(pill);
        });

        lanesWrap.appendChild(laneRow);
      }

      weekEl.appendChild(lanesWrap);
      grid.appendChild(weekEl);
    }

    const monthItemCount = seenInMonth.size;
    document.getElementById('alm-month-count').textContent = `${monthItemCount} ${monthItemCount === 1 ? 'item' : 'items'}`;
  }

  // ---- Right Pane: Agenda, Event Detail Card & Coming Up ----
  function renderRightPane() {
    const t = getTodayParts();
    const p = parseYMD(selectedDate);
    const dt = new Date(p.y, p.m, p.d);
    document.getElementById('alm-agenda-title').textContent = `${DAY_NAMES[dt.getDay()]}, ${MONTH_NAMES[p.m].slice(0, 3)} ${p.d}`;
    const diffDays = Math.round((dt - new Date(t.y, t.m, t.d)) / 86400000);
    document.getElementById('alm-agenda-sub').textContent =
      diffDays === 0 ? 'Today' : (diffDays === 1 ? 'Tomorrow' : (diffDays === -1 ? 'Yesterday' : `${Math.abs(diffDays)} days ${diffDays > 0 ? 'from now' : 'ago'}`));

    const dayEvs = getEventsForDate(selectedDate);
    const listEl = document.getElementById('alm-day-events');

    if (dayEvs.length === 0) {
      listEl.innerHTML = `
        <div class="rounded-2xl p-4 text-center text-xs" style="border: 1.5px dashed var(--ui-border); color: var(--ui-muted);">
          No events or birthdays on this day. Click <strong>+ Add</strong> or double-click any date to create one.
        </div>
      `;
    } else {
      listEl.innerHTML = dayEvs.map(ev => {
        const st = sourceStyle(ev);
        const isSel = ev.id === selectedEventId;
        const age = getTurningAge(ev, p.y);
        const span = getSpanInfo(ev, selectedDate);
        return `
          <div data-alm-select="${escHtml(ev.id)}" class="rounded-2xl p-2.5 cursor-pointer transition-all flex items-start gap-2.5"
            style="background: ${isSel ? 'var(--ui-accent-soft)' : 'var(--ui-surface-solid)'}; border: 1.5px solid ${isSel ? 'var(--ui-accent)' : 'var(--ui-border)'};">
            ${ev.source === 'reminder' && !span ? `
              <input type="checkbox" data-alm-done="${escHtml(ev.id)}" ${ev.done ? 'checked' : ''}
                class="mt-1 accent-amber-500 cursor-pointer shrink-0" title="Mark done" />
            ` : `<span class="text-base leading-none mt-0.5 shrink-0">${st.icon}</span>`}
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-xs truncate ${ev.done ? 'line-through opacity-60' : ''}" style="color: var(--ui-ink);">${escHtml(ev.title)}</span>
                ${span ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style="background:${st.bg}; border: 1px solid ${st.border}; color: var(--ui-ink);">Day ${span.dayNum}/${span.total}</span>` : ''}
                ${!span && ev.time ? `<span class="text-[10.5px] font-mono shrink-0" style="color: var(--ui-muted);">${formatTime12(ev.time)}</span>` : ''}
                ${age ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style="background:${st.bg}; border: 1px solid ${st.border}; color: var(--ui-ink);">Turns ${age}</span>` : ''}
              </div>
              <div class="text-[10.5px] truncate mt-0.5" style="color: var(--ui-muted);">
                ${span ? `${formatShortRange(ev.date, ev.endDate)} · ` : ''}${ev.lineage ? `${escHtml(ev.lineage.library)} › ${escHtml(ev.lineage.book)}` : 'Personal Calendar'}
              </div>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('[data-alm-select]').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.matches('[data-alm-done]')) return;
          selectedEventId = el.dataset.almSelect;
          renderRightPane();
          renderCalendar();
        });
      });

      listEl.querySelectorAll('[data-alm-done]').forEach(cb => {
        cb.addEventListener('change', async () => {
          const id = cb.dataset.almDone;
          const ev = customEvents.find(x => x.id === id);
          if (!ev) return;
          ev.done = cb.checked;
          renderAll();
          try {
            const resp = await fetch(`/api/almanac/events/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ done: ev.done })
            });
            if (resp.ok) {
              const data = await resp.json();
              if (Array.isArray(data.events)) customEvents = data.events;
            }
          } catch (e) {}
          if (typeof showToast === 'function') showToast(ev.done ? 'Reminder completed' : 'Reminder reopened');
        });
      });
    }

    // Detailed Event Card
    const detailEl = document.getElementById('alm-detail-card');
    const selEv = getAllEvents().find(e => e.id === selectedEventId);
    const curLibId = (typeof activeLibraryId !== 'undefined' && activeLibraryId) ? activeLibraryId : 'default';

    if (!selEv) {
      detailEl.classList.add('hidden');
    } else {
      detailEl.classList.remove('hidden');
      const st = sourceStyle(selEv);
      const age = getTurningAge(selEv, p.y);
      const span = getSpanInfo(selEv, selectedDate);
      const isOtherLib = selEv.lineage && selEv.lineage.libraryId && selEv.lineage.libraryId !== curLibId;
      const jumpBtnLabel = isOtherLib
        ? `Switch to ${escHtml(selEv.lineage.library)} &amp; Open &rarr;`
        : `Open Book &amp; Page &rarr;`;

      const lineageHtml = selEv.lineage ? `
        <div class="rounded-xl p-2.5 space-y-2" style="background: var(--alm-bg-alt); border: 1px solid var(--ui-border);">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--ui-muted);">Source Location</span>
            ${isOtherLib ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style="background: var(--ui-accent-soft); color: var(--ui-accent);">Another library</span>` : ''}
          </div>
          <div class="flex flex-wrap items-center gap-1 text-[11.5px] font-medium" style="color: var(--ui-ink);">
            <span class="px-1.5 py-0.5 rounded-md" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">🏛 ${escHtml(selEv.lineage.library)}</span>
            <span style="color: var(--ui-muted);">›</span>
            <span class="px-1.5 py-0.5 rounded-md" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">🚪 ${escHtml(selEv.lineage.hall)}</span>
            <span style="color: var(--ui-muted);">›</span>
            <span class="px-1.5 py-0.5 rounded-md" style="background: var(--ui-surface-alt); border: 1px solid var(--ui-border);">📘 ${escHtml(selEv.lineage.book)}</span>
            <span style="color: var(--ui-muted);">›</span>
            <span class="px-1.5 py-0.5 rounded-md font-bold" style="background: var(--ui-accent-soft); color: var(--ui-accent);">📄 ${escHtml(selEv.lineage.page)}</span>
          </div>
          <div>
            <button id="alm-btn-jump-source" type="button" class="storybook-btn rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer">
              ${jumpBtnLabel}
            </button>
          </div>
        </div>
      ` : `
        <div class="rounded-xl px-2.5 py-2 text-[11px]" style="background: var(--alm-bg-alt); border: 1px solid var(--ui-border); color: var(--ui-muted);">
          Standalone calendar item (not linked to a specific book)
        </div>
      `;

      const dateDisplay = span
        ? `${formatShortRange(selEv.date, selEv.endDate)} (${span.total} days · Day ${span.dayNum} of ${span.total})`
        : `${selEv.date}${selEv.source === 'birthday' ? ' (birth date)' : ''}`;

      detailEl.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap mb-1">
              <span class="text-[10.5px] font-bold px-2 py-0.5 rounded-full" style="background:${st.bg}; border: 1px solid ${st.border}; color: var(--ui-ink);">${st.icon} ${escHtml(st.label)}</span>
              ${selEv.recur && selEv.recur !== 'none' ? `<span class="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style="background: var(--ui-surface-alt); color: var(--ui-muted);">↻ ${escHtml(selEv.recur)}</span>` : ''}
              ${age ? `<span class="text-[10.5px] font-bold px-2 py-0.5 rounded-full" style="background: var(--ui-accent-soft); color: var(--ui-accent);">Turning ${age}</span>` : ''}
            </div>
            <h3 class="font-storybook font-bold text-sm m-0" style="color: var(--ui-ink);">${escHtml(selEv.title)}</h3>
          </div>
          ${selEv.source === 'reminder' ? `
            <div class="flex items-center gap-1 shrink-0">
              <button id="alm-btn-edit-ev" type="button" class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer">Edit</button>
              <button id="alm-btn-del-ev" type="button" class="storybook-btn rounded-lg px-2 py-1 text-[11px] font-semibold cursor-pointer" style="color: #e27878;">Delete</button>
            </div>
          ` : ''}
        </div>
        <div class="text-xs flex items-center gap-3 flex-wrap" style="color: var(--ui-muted);">
          <span>📅 ${escHtml(dateDisplay)}</span>
          ${selEv.time ? `<span>🕒 ${escHtml(formatTime12(selEv.time))}</span>` : ''}
        </div>
        ${selEv.notes ? `<p class="text-xs leading-relaxed m-0" style="color: var(--ui-ink); opacity: 0.9;">${escHtml(selEv.notes)}</p>` : ''}
        ${lineageHtml}
      `;

      document.getElementById('alm-btn-jump-source')?.addEventListener('click', async () => {
        const l = selEv.lineage;
        if (!l) return;
        setModalOpen(false);
        try {
          if (l.libraryId && l.libraryId !== curLibId && typeof switchToLibrary === 'function') {
            await switchToLibrary(l.libraryId);
          }
          if (typeof openBookCenter === 'function' && l.hallId && l.bookId) {
            openBookCenter(l.hallId, l.bookId, l.pageId || null);
          }
        } catch (err) {
          if (typeof showToast === 'function') showToast('Could not open linked page');
        }
      });

      document.getElementById('alm-btn-edit-ev')?.addEventListener('click', () => openEventForm(selEv));

      document.getElementById('alm-btn-del-ev')?.addEventListener('click', async () => {
        const id = selEv.id;
        customEvents = customEvents.filter(x => x.id !== id);
        selectedEventId = null;
        renderAll();
        try {
          const resp = await fetch(`/api/almanac/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data.events)) customEvents = data.events;
          }
        } catch (e) {}
        if (typeof showToast === 'function') showToast('Deleted event');
      });
    }

    // Coming Up (Next 14 Days) — deduplicated for multi-day blocks
    const upList = [];
    const seenUp = new Set();
    for (let offset = 0; offset <= 14; offset++) {
      const d = new Date(t.y, t.m, t.d + offset);
      const ymd = toYMD(d.getFullYear(), d.getMonth(), d.getDate());
      getEventsForDate(ymd).forEach(ev => {
        if (ev.done) return;
        if (isMultiDay(ev)) {
          if (seenUp.has(ev.id)) return;
          seenUp.add(ev.id);
        }
        upList.push({ ymd, offset, ev, d });
      });
    }
    document.getElementById('alm-upcoming-count').textContent = `${upList.length} upcoming`;
    const upEl = document.getElementById('alm-upcoming-list');
    upEl.innerHTML = upList.length === 0
      ? `<div class="text-xs" style="color: var(--ui-muted);">All clear for the next 14 days.</div>`
      : upList.slice(0, 8).map(({ ymd, offset, ev, d }) => {
          const st = sourceStyle(ev);
          const datePart = isMultiDay(ev)
            ? formatShortRange(ev.date, ev.endDate)
            : `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
          const rel = offset === 0 ? (isMultiDay(ev) ? `Now · ${datePart}` : 'Today')
            : (offset === 1 ? (isMultiDay(ev) ? `Tomorrow · ${datePart}` : 'Tomorrow') : `in ${offset}d · ${datePart}`);
          return `
            <button type="button" data-alm-up="${escHtml(ymd)}|${escHtml(ev.id)}"
              class="w-full text-left rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer transition-colors"
              style="background: var(--ui-surface-solid); border: 1px solid var(--ui-border);">
              <span class="text-xs truncate" style="color: var(--ui-ink);">${st.icon} ${escHtml(ev.title)}</span>
              <span class="text-[10.5px] font-mono shrink-0" style="color: ${offset === 0 ? 'var(--ui-accent)' : 'var(--ui-muted)'};">${escHtml(rel)}</span>
            </button>
          `;
        }).join('');

    upEl.querySelectorAll('[data-alm-up]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ymd, id] = btn.dataset.almUp.split('|');
        const p2 = parseYMD(ymd);
        viewYear = p2.y; viewMonth = p2.m;
        selectedDate = ymd;
        selectedEventId = id;
        renderAll();
      });
    });
  }

  function openEventForm(existingEv = null, dateStr = null) {
    populateScopeAndLinks();
    const form = document.getElementById('alm-event-form');
    form.classList.remove('hidden');
    const endInp = document.getElementById('alm-f-end-date');
    const linkSel = document.getElementById('alm-f-link');

    if (existingEv) {
      editingEventId = existingEv.id;
      document.getElementById('alm-form-heading').textContent = 'Edit Event / Reminder';
      document.getElementById('alm-btn-submit-form').textContent = 'Save Changes';
      document.getElementById('alm-f-title').value = existingEv.title || '';
      document.getElementById('alm-f-date').value = existingEv.date || selectedDate;
      endInp.value = existingEv.endDate || '';
      endInp.min = existingEv.date || '';
      document.getElementById('alm-f-time').value = existingEv.time || '';
      document.getElementById('alm-f-kind').value = existingEv.kind || 'reminder';
      document.getElementById('alm-f-recur').value = existingEv.recur || 'none';
      document.getElementById('alm-f-notes').value = existingEv.notes || '';
      if (existingEv.lineage) {
        const match = Array.from(linkSel.options).find(opt => {
          if (!opt.value) return false;
          try {
            const parsed = JSON.parse(opt.value);
            return parsed.libraryId === existingEv.lineage.libraryId && parsed.bookId === existingEv.lineage.bookId && parsed.pageId === existingEv.lineage.pageId;
          } catch (e) { return false; }
        });
        linkSel.value = match ? match.value : '';
      } else {
        linkSel.value = '';
      }
    } else {
      editingEventId = null;
      document.getElementById('alm-form-heading').textContent = 'New Event / Reminder';
      document.getElementById('alm-btn-submit-form').textContent = 'Save';
      const startVal = dateStr || selectedDate;
      document.getElementById('alm-f-title').value = '';
      document.getElementById('alm-f-date').value = startVal;
      endInp.value = '';
      endInp.min = startVal;
      document.getElementById('alm-f-time').value = '';
      document.getElementById('alm-f-kind').value = 'reminder';
      document.getElementById('alm-f-recur').value = 'none';
      linkSel.value = '';
      document.getElementById('alm-f-notes').value = '';
    }
    document.getElementById('alm-f-title').focus();
  }

  function renderAll() {
    renderCalendar();
    renderRightPane();
    updatePillBadges();
  }

  function setModalOpen(open) {
    modalOpen = open;
    modalEl.classList.toggle('modal-closed', !open);
    if (open) {
      if (typeof closeAllMenus === 'function') closeAllMenus();
      populateScopeAndLinks();
      const firstEv = getEventsForDate(selectedDate)[0];
      if (!selectedEventId && firstEv) selectedEventId = firstEv.id;
      renderAll();
      loadAlmanac();
    }
  }

  // ---- Event Wiring ----
  triggerBtn.addEventListener('click', () => setModalOpen(!modalOpen));
  document.getElementById('alm-btn-close').addEventListener('click', () => setModalOpen(false));
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) setModalOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOpen) {
      const pop = document.getElementById('alm-month-jump-pop');
      if (pop && !pop.classList.contains('hidden')) {
        pop.classList.add('hidden');
        e.stopPropagation();
        return;
      }
      setModalOpen(false);
      e.stopPropagation();
    }
  });

  // Month navigation & Quick Jump
  document.getElementById('alm-btn-prev-month').addEventListener('click', () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  document.getElementById('alm-btn-next-month').addEventListener('click', () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });
  document.getElementById('alm-btn-go-today').addEventListener('click', () => {
    const t = getTodayParts();
    viewYear = t.y; viewMonth = t.m; selectedDate = t.ymd;
    selectedEventId = getEventsForDate(t.ymd)[0]?.id || null;
    renderAll();
  });
  document.getElementById('alm-btn-month-jump').addEventListener('click', () => {
    const pop = document.getElementById('alm-month-jump-pop');
    jumpYear = viewYear;
    renderMonthJump();
    pop.classList.toggle('hidden');
  });
  document.getElementById('alm-jump-yr-prev').addEventListener('click', () => { jumpYear--; renderMonthJump(); });
  document.getElementById('alm-jump-yr-next').addEventListener('click', () => { jumpYear++; renderMonthJump(); });

  // Mobile toggle
  document.getElementById('alm-mob-month').addEventListener('click', () => { mobilePane = 'month'; syncMobilePanes(); });
  document.getElementById('alm-mob-agenda').addEventListener('click', () => { mobilePane = 'agenda'; syncMobilePanes(); });

  // Filter chips & library scope
  document.getElementById('alm-filter-chips').querySelectorAll('[data-alm-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.almFilter;
      document.getElementById('alm-filter-chips').querySelectorAll('[data-alm-filter]').forEach(b => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });
  document.getElementById('alm-scope-select').addEventListener('change', (e) => {
    activeScope = e.target.value;
    renderAll();
  });

  // Add / Edit form
  document.getElementById('alm-f-date').addEventListener('change', (e) => {
    const endInp = document.getElementById('alm-f-end-date');
    endInp.min = e.target.value;
    if (endInp.value && endInp.value < e.target.value) endInp.value = e.target.value;
  });
  document.getElementById('alm-btn-add').addEventListener('click', () => openEventForm(null, selectedDate));
  document.getElementById('alm-btn-cancel-form').addEventListener('click', () => {
    editingEventId = null;
    document.getElementById('alm-event-form').classList.add('hidden');
  });

  document.getElementById('alm-event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('alm-f-title').value.trim();
    const date = document.getElementById('alm-f-date').value;
    const rawEnd = document.getElementById('alm-f-end-date').value;
    const endDate = rawEnd && rawEnd > date ? rawEnd : '';
    if (!title || !date) return;

    let lineage = null;
    const linkVal = document.getElementById('alm-f-link').value;
    if (linkVal) {
      try { lineage = JSON.parse(linkVal); } catch (err) {}
    }

    const payload = {
      id: editingEventId || undefined,
      title,
      date,
      endDate,
      time: endDate ? '' : document.getElementById('alm-f-time').value,
      kind: document.getElementById('alm-f-kind').value,
      recur: endDate ? 'none' : document.getElementById('alm-f-recur').value,
      notes: document.getElementById('alm-f-notes').value.trim(),
      lineage
    };

    try {
      const resp = await fetch('/api/almanac/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: payload })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to save event');
      if (Array.isArray(data.events)) customEvents = data.events;
      selectedEventId = data.event?.id || editingEventId || null;
      const wasEdit = Boolean(editingEventId);
      editingEventId = null;
      const p = parseYMD(date);
      viewYear = p.y; viewMonth = p.m;
      selectedDate = date;
      document.getElementById('alm-event-form').classList.add('hidden');
      renderAll();
      if (typeof showToast === 'function') {
        showToast(wasEdit ? 'Updated event' : (endDate ? 'Blocked multi-day range on Almanac' : 'Added to Library Almanac'));
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast(err.message || 'Could not save event');
    }
  });

  // Weather location & unit controls
  document.getElementById('alm-btn-change-loc').addEventListener('click', () => {
    const bar = document.getElementById('alm-loc-bar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) {
      document.getElementById('alm-loc-input').focus();
    }
  });
  document.getElementById('alm-btn-cancel-loc').addEventListener('click', () => {
    document.getElementById('alm-loc-bar').classList.add('hidden');
  });
  document.getElementById('alm-loc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = document.getElementById('alm-loc-input').value.trim();
    if (!query) return;
    await saveWeatherConfig({ query });
  });
  document.getElementById('alm-btn-geo-loc').addEventListener('click', () => {
    if (!navigator.geolocation) {
      if (typeof showToast === 'function') showToast('Geolocation not supported in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => saveWeatherConfig({ lat: pos.coords.latitude, lon: pos.coords.longitude, locationName: 'Current Location' }),
      () => { if (typeof showToast === 'function') showToast('Location blocked (use city/ZIP on HTTP)'); },
      { timeout: 8000 }
    );
  });
  document.getElementById('alm-unit-f').addEventListener('click', () => {
    weatherData.unit = 'F';
    renderWeather();
    saveWeatherConfig({ unit: 'F' });
  });
  document.getElementById('alm-unit-c').addEventListener('click', () => {
    weatherData.unit = 'C';
    renderWeather();
    saveWeatherConfig({ unit: 'C' });
  });

  // Boot!
  updateClock();
  setInterval(updateClock, 15000);
  renderWeather();
  loadAlmanac();
  loadWeather();
  setInterval(loadWeather, 20 * 60 * 1000);

  // Expose lightweight refresh hook if other modules want to ping badges
  window.refreshAlmanacBadges = updatePillBadges;
})();
