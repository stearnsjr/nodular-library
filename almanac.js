'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEATHER_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const BIRTHDAY_KEY_RE = /\b(birth\s*day|bday|dob|birth\s*date|anniversary)\b/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function createAlmanacService({ dataDir, librariesDir, parseEnvelopeFile }) {
  const ALMANAC_FILE = path.join(dataDir, 'almanac.json');
  const weatherCache = new Map();

  function defaultStore() {
    return {
      events: [],
      weather: {
        locationName: '',
        lat: null,
        lon: null,
        unit: 'F'
      }
    };
  }

  function readStore() {
    try {
      if (fs.existsSync(ALMANAC_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(ALMANAC_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          return {
            events: Array.isArray(parsed.events) ? parsed.events : [],
            weather: {
              locationName: typeof parsed.weather?.locationName === 'string' ? parsed.weather.locationName : '',
              lat: typeof parsed.weather?.lat === 'number' ? parsed.weather.lat : null,
              lon: typeof parsed.weather?.lon === 'number' ? parsed.weather.lon : null,
              unit: parsed.weather?.unit === 'C' ? 'C' : 'F'
            }
          };
        }
      }
    } catch (err) {
      console.error('[almanac] Failed to read almanac.json:', err.message);
    }
    return defaultStore();
  }

  function writeStore(store) {
    const tmp = `${ALMANAC_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, ALMANAC_FILE);
  }

  function normalizeYmd(val) {
    if (!val || typeof val !== 'string') return '';
    const trimmed = val.trim();
    if (YMD_RE.test(trimmed)) return trimmed;
    const m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(trimmed)) {
      const y = parsed.getFullYear();
      const mo = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
    return '';
  }

  function normalizeEvent(raw, existing = null) {
    const title = String(raw?.title || '').trim().slice(0, 160);
    const date = normalizeYmd(raw?.date);
    if (!title || !date) {
      const err = new Error('Event title and valid date (YYYY-MM-DD) are required');
      err.statusCode = 400;
      throw err;
    }
    const rawEnd = normalizeYmd(raw?.endDate);
    const endDate = rawEnd && rawEnd > date ? rawEnd : '';
    const validKinds = new Set(['reminder', 'event', 'vacation']);
    const kind = validKinds.has(raw?.kind) ? raw.kind : (endDate ? 'vacation' : 'reminder');
    const validRecur = new Set(['none', 'weekly', 'monthly', 'yearly']);
    const recur = endDate ? 'none' : (validRecur.has(raw?.recur) ? raw.recur : 'none');
    const time = endDate ? '' : String(raw?.time || '').trim().slice(0, 10);
    const notes = String(raw?.notes || '').trim().slice(0, 2000);
    const done = Boolean(raw?.done);

    let lineage = null;
    if (raw?.lineage && typeof raw.lineage === 'object' && raw.lineage.libraryId && raw.lineage.bookId) {
      lineage = {
        libraryId: String(raw.lineage.libraryId),
        library: String(raw.lineage.library || 'Library'),
        hallId: String(raw.lineage.hallId || ''),
        hall: String(raw.lineage.hall || 'Hall'),
        bookId: String(raw.lineage.bookId),
        book: String(raw.lineage.book || 'Book'),
        pageId: String(raw.lineage.pageId || ''),
        page: String(raw.lineage.page || 'Page')
      };
    }

    const now = new Date().toISOString();
    return {
      id: existing?.id || (raw?.id && typeof raw.id === 'string' ? raw.id : `alm-${crypto.randomBytes(6).toString('hex')}`),
      source: 'reminder',
      kind,
      title,
      date,
      endDate,
      time,
      recur,
      notes,
      done,
      lineage,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
  }

  function saveEvent(rawEvent) {
    const store = readStore();
    const idx = rawEvent?.id ? store.events.findIndex((e) => e.id === rawEvent.id) : -1;
    const saved = normalizeEvent(rawEvent, idx >= 0 ? store.events[idx] : null);
    if (idx >= 0) {
      store.events[idx] = saved;
    } else {
      store.events.push(saved);
    }
    writeStore(store);
    return { event: saved, events: store.events };
  }

  function patchEvent(id, patch) {
    const store = readStore();
    const idx = store.events.findIndex((e) => e.id === id);
    if (idx < 0) {
      const err = new Error('Event not found');
      err.statusCode = 404;
      throw err;
    }
    const merged = { ...store.events[idx], ...patch, id };
    const saved = normalizeEvent(merged, store.events[idx]);
    store.events[idx] = saved;
    writeStore(store);
    return { event: saved, events: store.events };
  }

  function deleteEvent(id) {
    const store = readStore();
    const before = store.events.length;
    store.events = store.events.filter((e) => e.id !== id);
    if (store.events.length !== before) {
      writeStore(store);
    }
    return { ok: true, events: store.events };
  }

  // Scan all libraries on disk for date properties (birthdays + book dates) & linkable pages
  function scanLibrariesForDates() {
    const bookDates = [];
    const linkTargets = [];
    const libraries = [];

    if (!fs.existsSync(librariesDir)) {
      return { bookDates, linkTargets, libraries };
    }

    const files = fs.readdirSync(librariesDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const libId = file.slice(0, -5);
      const env = parseEnvelopeFile(path.join(librariesDir, file));
      if (!env || !env.state) continue;
      const libTitle = env.state.title || 'Untitled Library';
      libraries.push({ id: libId, title: libTitle });

      const walkHalls = (halls) => {
        for (const hall of halls || []) {
          const hallTitle = hall.title || 'Untitled Hall';
          for (const book of hall.books || []) {
            const bookTitle = book.title || 'Untitled Book';
            for (const page of book.pages || []) {
              const pageTitle = page.title || 'Untitled Page';
              const lineage = {
                libraryId: libId,
                library: libTitle,
                hallId: hall.id || '',
                hall: hallTitle,
                bookId: book.id || '',
                book: bookTitle,
                pageId: page.id || '',
                page: pageTitle
              };

              linkTargets.push(lineage);

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

                let title;
                if (isBirthdayKey) {
                  const keyLabel = /anniversary/i.test(key) ? 'Anniversary' : 'Birthday';
                  title = `${subjectName}'s ${keyLabel}`;
                } else {
                  title = key ? `${subjectName} — ${key}` : subjectName;
                }

                bookDates.push({
                  id: `bd-${libId}-${book.id}-${page.id}-${prop.id || key}`,
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
          if (Array.isArray(hall.subHalls) && hall.subHalls.length > 0) {
            walkHalls(hall.subHalls);
          }
        }
      };

      walkHalls(env.state.halls);
    }

    return { bookDates, linkTargets, libraries };
  }

  function getAlmanacPayload() {
    const store = readStore();
    const { bookDates, linkTargets, libraries } = scanLibrariesForDates();
    return {
      events: store.events,
      bookDates,
      linkTargets,
      libraries,
      weatherConfig: store.weather
    };
  }

  function wmoToDisplay(code, isDay = 1) {
    const c = Number(code);
    if (c === 0) return { cond: 'Clear', icon: isDay ? '☀️' : '🌙' };
    if (c === 1) return { cond: 'Mainly Clear', icon: isDay ? '🌤️' : '🌙' };
    if (c === 2) return { cond: 'Partly Cloudy', icon: isDay ? '⛅' : '☁️' };
    if (c === 3) return { cond: 'Overcast', icon: '☁️' };
    if (c === 45 || c === 48) return { cond: 'Foggy', icon: '🌫️' };
    if ([51, 53, 55, 56, 57].includes(c)) return { cond: 'Drizzle', icon: '🌦️' };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return { cond: 'Rain', icon: '🌧️' };
    if ([71, 73, 75, 77, 85, 86].includes(c)) return { cond: 'Snow', icon: '🌨️' };
    if ([95, 96, 99].includes(c)) return { cond: 'Thunderstorm', icon: '⛈️' };
    return { cond: 'Fair', icon: isDay ? '🌤️' : '🌙' };
  }

  async function geocodeQuery(query) {
    const q = String(query || '').trim();
    if (!q) {
      const err = new Error('Please enter a city name or postal code');
      err.statusCode = 400;
      throw err;
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Geocoding service error (${resp.status})`);
    const data = await resp.json();
    const hit = Array.isArray(data.results) && data.results[0];
    if (!hit) {
      const err = new Error(`Could not find location "${q}"`);
      err.statusCode = 404;
      throw err;
    }
    const parts = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) parts.push(hit.admin1);
    else if (hit.country_code) parts.push(hit.country_code);
    return {
      locationName: parts.join(', '),
      lat: hit.latitude,
      lon: hit.longitude
    };
  }

  async function fetchWeatherForCoords(lat, lon, locationName, unit = 'F') {
    const cacheKey = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < WEATHER_CACHE_TTL_MS) {
      return { ...cached.data, locationName, unit };
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=4`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Weather service error (${resp.status})`);
    const raw = await resp.json();

    const cur = raw.current || {};
    const daily = raw.daily || {};
    const curDisp = wmoToDisplay(cur.weather_code, cur.is_day);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const forecast = [];
    const times = Array.isArray(daily.time) ? daily.time : [];
    for (let i = 1; i < Math.min(4, times.length); i++) {
      const [yy, mm, dd] = times[i].split('-').map(Number);
      const dow = new Date(yy, mm - 1, dd).getDay();
      const dDisp = wmoToDisplay(daily.weather_code?.[i], 1);
      forecast.push({
        day: dayNames[dow],
        icon: dDisp.icon,
        hiF: Math.round(daily.temperature_2m_max?.[i] ?? 0),
        loF: Math.round(daily.temperature_2m_min?.[i] ?? 0)
      });
    }

    const data = {
      configured: true,
      locationName,
      lat: Number(lat),
      lon: Number(lon),
      unit,
      tempF: Math.round(cur.temperature_2m ?? 0),
      hiF: Math.round(daily.temperature_2m_max?.[0] ?? cur.temperature_2m ?? 0),
      loF: Math.round(daily.temperature_2m_min?.[0] ?? cur.temperature_2m ?? 0),
      cond: curDisp.cond,
      icon: curDisp.icon,
      forecast,
      fetchedAt: new Date().toISOString()
    };

    weatherCache.set(cacheKey, { fetchedAt: Date.now(), data });
    return data;
  }

  async function getWeather() {
    const store = readStore();
    const w = store.weather;
    if (typeof w.lat !== 'number' || typeof w.lon !== 'number') {
      return { configured: false, unit: w.unit || 'F', locationName: '' };
    }
    return fetchWeatherForCoords(w.lat, w.lon, w.locationName || 'Local', w.unit || 'F');
  }

  async function updateWeatherConfig(body) {
    const store = readStore();
    if (body?.unit === 'F' || body?.unit === 'C') {
      store.weather.unit = body.unit;
    }

    if (typeof body?.query === 'string' && body.query.trim()) {
      const geo = await geocodeQuery(body.query);
      store.weather.locationName = geo.locationName;
      store.weather.lat = geo.lat;
      store.weather.lon = geo.lon;
    } else if (typeof body?.lat === 'number' && typeof body?.lon === 'number') {
      store.weather.lat = body.lat;
      store.weather.lon = body.lon;
      if (typeof body?.locationName === 'string' && body.locationName.trim()) {
        store.weather.locationName = body.locationName.trim();
      } else if (!store.weather.locationName) {
        store.weather.locationName = 'Current Location';
      }
    }

    writeStore(store);

    if (typeof store.weather.lat === 'number' && typeof store.weather.lon === 'number') {
      return fetchWeatherForCoords(store.weather.lat, store.weather.lon, store.weather.locationName, store.weather.unit);
    }
    return { configured: false, unit: store.weather.unit, locationName: '' };
  }

  return {
    getAlmanacPayload,
    saveEvent,
    patchEvent,
    deleteEvent,
    getWeather,
    updateWeatherConfig
  };
}

module.exports = { createAlmanacService };
