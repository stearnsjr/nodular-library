'use strict';

// ============================================================
// 1. DYNAMIC COLOR HARMONY ENGINE, ICONS & CONSTANTS
// ============================================================
const HUB_RADIUS = 138;
const MAX_BAY_INNER_W = 192;
const MAX_BOOKS_PER_BAY = 6;
const MAX_STUDY_TABLE_BOOKS = 11;
const SPINE_GAP = 3.5;
const STORAGE_KEY = 'storytellers_library_mindmap_v1';

const DEFAULT_PALETTE_SPEC = [
  { id: 'sage',       name: 'Sage Leaf',   hex: '#6c9a72' },
  { id: 'terracotta', name: 'Terracotta',  hex: '#d17152' },
  { id: 'harbor',     name: 'Harbor Blue', hex: '#5a87ab' },
  { id: 'honey',      name: 'Honey Ochre', hex: '#d69e42' },
  { id: 'plum',       name: 'Berry Plum',  hex: '#9c6380' },
  { id: 'seaglass',   name: 'Sea Glass',   hex: '#539993' }
];

const DEFAULT_STAMPS = [
  { id: 'st_key',      label: 'Key Idea',   color: '#c45e3c' },
  { id: 'st_lore',     label: 'Lore',       color: '#7d4a66' },
  { id: 'st_visual',   label: 'Visual Ref', color: '#4c7c53' },
  { id: 'st_mystery',  label: 'Mystery',    color: '#436b8c' },
  { id: 'st_todo',     label: 'To-Do',      color: '#b88225' }
];

const LEGACY_TAG_MAP = {
  key: 'st_key',
  idea: 'st_lore',
  draft: 'st_visual',
  question: 'st_mystery',
  note: 'st_todo'
};

const HALL_ICONS = [
  { id: 'spark',   label: 'Spark',   path: 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z' },
  { id: 'compass', label: 'Compass', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.6 6.4l-2 5.2-5.2 2 2-5.2z' },
  { id: 'leaf',    label: 'Leaf',    path: 'M19 4C11 4 5 9 5 18c0 .6.4 1 1 1 9 0 14-6 14-14 0-.6-.4-1-1-1zM5 19l7-7' },
  { id: 'quill',   label: 'Quill',   path: 'M20 4c-5 0-11 4-13 11l-3 5 5-3c7-2 11-8 11-13zM9 15l4-4' },
  { id: 'castle',  label: 'Realm',   path: 'M4 20V9h3V6h3v3h4V6h3v3h3v11H4zm6 0v-5a2 2 0 0 1 4 0v5' },
  { id: 'music',   label: 'Melody',  path: 'M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zm11-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z' },
  { id: 'gear',    label: 'Craft',   path: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M3 12h2m14 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4' },
  { id: 'lantern', label: 'Lantern', path: 'M9 4h6M10 4v2h4V4M7 9c0-2 2-3 5-3s5 1 5 3v6c0 2-2 4-5 4s-5-2-5-4V9zm5 2v3' }
];

// Convert any hex into a full storybook gouache swatch family (fill, deep, soft, accent, rugEdge)
function hexToHsl(hex) {
  let h = (hex || '#6c9a72').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { h: 128, s: 22, l: 51 };
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0, lum = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s: sat * 100, l: lum * 100 };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function deriveSwatch(entry) {
  const hex = /^#[0-9a-f]{6}$/i.test(entry.hex || entry.fill || '') ? (entry.hex || entry.fill) : '#6c9a72';
  const { h, s, l } = hexToHsl(hex);
  return {
    id: entry.id,
    name: entry.name || 'Custom',
    hex,
    fill: hex,
    deep: hslToHex(h, Math.min(92, s + 6), Math.max(18, l - 17)),
    soft: hslToHex(h, Math.min(62, s * 0.85), Math.max(84, Math.min(92, l + 34))),
    accent: hslToHex(h, Math.min(85, s + 4), Math.min(82, l + 16)),
    rugEdge: hslToHex(h, Math.min(48, s * 0.65), 95)
  };
}

function getPalette() {
  if (!state || !Array.isArray(state.palette) || state.palette.length === 0) {
    return DEFAULT_PALETTE_SPEC.map(deriveSwatch);
  }
  return state.palette.map(deriveSwatch);
}
function getSwatch(id) {
  const pal = getPalette();
  return pal.find(s => s.id === id) || pal[0];
}
function getStamps() {
  return Array.isArray(state?.stamps) ? state.stamps : DEFAULT_STAMPS;
}
function getStamp(id) {
  return getStamps().find(s => s.id === id) || null;
}
function getHallIcon(id) { return HALL_ICONS.find(i => i.id === id) || HALL_ICONS[0]; }
function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`; }
function hashNum(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function plainTextToHtml(text) {
  const safe = esc(text || '');
  const linked = safe.replace(
    /\b(https?:\/\/[^\s<]+)/gi,
    (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  return linked.replace(/\n/g, '<br>');
}
function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const GRIP_SVG = `<svg width="11" height="14" viewBox="0 0 11 14" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="8" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="8" cy="11" r="1.2"/></svg>`;

function isScrollItem(item) {
  return Boolean(item && item.itemType === 'scroll');
}
function isCharacterBook(item) {
  return Boolean(item && item.dndChar && typeof item.dndChar === 'object');
}
function isMarketLedger(item) {
  return Boolean(item && item.marketLedger && typeof item.marketLedger === 'object');
}
function isProjectBoard(item) {
  return Boolean(item && item.projectBoard && typeof item.projectBoard === 'object');
}

function createDefaultProjectBoardData(doneChapterId = null) {
  return {
    doneChapterId: doneChapterId || null
  };
}

function normalizeProjectBoard(raw, chapters = []) {
  const validIds = new Set((chapters || []).map(c => c.id));
  let doneId = (raw && typeof raw.doneChapterId === 'string' && validIds.has(raw.doneChapterId))
    ? raw.doneChapterId
    : null;
  if (!doneId && Array.isArray(chapters) && chapters.length > 0) {
    const doneGuess = chapters.find(c => /\b(done|complete|completed|finished|shipped)\b/i.test(c.title || ''));
    if (doneGuess) doneId = doneGuess.id;
  }
  return { doneChapterId: doneId };
}

function getProjectBoardStats(book) {
  if (!book || !Array.isArray(book.pages)) return { done: 0, total: 0, doneChapterId: null };
  const doneChapterId = book.projectBoard?.doneChapterId || null;
  const total = book.pages.length;
  const done = doneChapterId ? book.pages.filter(p => p.chapterId === doneChapterId).length : 0;
  return { done, total, doneChapterId };
}

function createDefaultMarketLedgerData(initialListName = 'Weekly Groceries') {
  const listId = uid('ml');
  return {
    activeListId: listId,
    groupBy: 'aisle',
    modality: 'PICKUP',
    lists: [
      {
        id: listId,
        name: initialListName,
        color: 'sage',
        items: []
      }
    ]
  };
}

function normalizeMarketLedger(raw) {
  const base = createDefaultMarketLedgerData();
  if (!raw || typeof raw !== 'object') return base;
  const lists = Array.isArray(raw.lists) && raw.lists.length > 0
    ? raw.lists
        .filter(l => l && typeof l === 'object')
        .map((l, idx) => ({
          id: l.id || uid('ml'),
          name: typeof l.name === 'string' && l.name.trim() ? l.name : `List ${idx + 1}`,
          color: typeof l.color === 'string' ? l.color : 'sage',
          items: Array.isArray(l.items)
            ? l.items
                .filter(it => it && typeof it === 'object')
                .map(it => ({
                  id: it.id || uid('mi'),
                  name: typeof it.name === 'string' ? it.name : 'Unnamed Item',
                  brand: typeof it.brand === 'string' ? it.brand : '',
                  size: typeof it.size === 'string' ? it.size : '',
                  qty: Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1)),
                  checked: Boolean(it.checked),
                  note: typeof it.note === 'string' ? it.note : '',
                  deal: typeof it.deal === 'string' ? it.deal : '',
                  upc: typeof it.upc === 'string' ? it.upc : '',
                  productId: typeof it.productId === 'string' ? it.productId : '',
                  price: typeof it.price === 'number' && !Number.isNaN(it.price) ? it.price : null,
                  promo: typeof it.promo === 'number' && !Number.isNaN(it.promo) ? it.promo : null,
                  stockLevel: typeof it.stockLevel === 'string' ? it.stockLevel : 'UNKNOWN',
                  aisle: typeof it.aisle === 'string' && it.aisle ? it.aisle : 'Custom / Other',
                  imageUrl: typeof it.imageUrl === 'string' ? it.imageUrl : '',
                  url: typeof it.url === 'string' ? it.url : '',
                  updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : ''
                }))
            : []
        }))
    : base.lists;
  const activeValid = lists.some(l => l.id === raw.activeListId);
  return {
    activeListId: activeValid ? raw.activeListId : lists[0].id,
    groupBy: raw.groupBy === 'flat' ? 'flat' : 'aisle',
    modality: raw.modality === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
    lists
  };
}

const DND_ABILITIES = [
  { key: 'str', label: 'STR', name: 'Strength' },
  { key: 'dex', label: 'DEX', name: 'Dexterity' },
  { key: 'con', label: 'CON', name: 'Constitution' },
  { key: 'int', label: 'INT', name: 'Intelligence' },
  { key: 'wis', label: 'WIS', name: 'Wisdom' },
  { key: 'cha', label: 'CHA', name: 'Charisma' }
];

const DND_SKILLS = [
  { key: 'acrobatics',     label: 'Acrobatics',      ab: 'dex' },
  { key: 'animalHandling', label: 'Animal Handling', ab: 'wis' },
  { key: 'arcana',         label: 'Arcana',          ab: 'int' },
  { key: 'athletics',      label: 'Athletics',       ab: 'str' },
  { key: 'deception',      label: 'Deception',       ab: 'cha' },
  { key: 'history',        label: 'History',         ab: 'int' },
  { key: 'insight',        label: 'Insight',         ab: 'wis' },
  { key: 'intimidation',   label: 'Intimidation',    ab: 'cha' },
  { key: 'investigation',  label: 'Investigation',   ab: 'int' },
  { key: 'medicine',       label: 'Medicine',        ab: 'wis' },
  { key: 'nature',         label: 'Nature',          ab: 'int' },
  { key: 'perception',     label: 'Perception',      ab: 'wis' },
  { key: 'performance',    label: 'Performance',     ab: 'cha' },
  { key: 'persuasion',     label: 'Persuasion',      ab: 'cha' },
  { key: 'religion',       label: 'Religion',        ab: 'int' },
  { key: 'sleightOfHand',  label: 'Sleight of Hand', ab: 'dex' },
  { key: 'stealth',        label: 'Stealth',         ab: 'dex' },
  { key: 'survival',       label: 'Survival',        ab: 'wis' }
];

function dndMod(score) {
  const n = Number(score);
  return Math.floor(((Number.isFinite(n) ? n : 10) - 10) / 2);
}
function fmtSigned(n) {
  const v = Number(n) || 0;
  return v >= 0 ? `+${v}` : `${v}`;
}
function dndProfBonus(level) {
  const lv = Math.max(1, Math.min(20, Number(level) || 1));
  return Math.ceil(lv / 4) + 1;
}

function createDefaultDndCharData(name = 'New Adventurer', edition = '2024') {
  const spells = {};
  for (let lv = 0; lv <= 9; lv++) {
    spells[lv] = { slotsTotal: lv === 1 ? 2 : 0, slotsUsed: 0, list: [] };
  }
  return {
    edition: edition === '5e' ? '5e' : '2024',
    name,
    className: '',
    subclass: '',
    level: 1,
    background: '',
    species: '',
    alignment: '',
    xp: 0,
    originFeat: '',
    inspiration: false,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProfs: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    skillProfs: {}, // skillKey -> 0 (none) | 1 (proficient) | 2 (expertise)
    ac: 10,
    speed: '30 ft.',
    initBonus: 0,
    hpMax: 10,
    hpCur: 10,
    hpTemp: 0,
    hitDieType: 'd8',
    hitDiceTotal: 1,
    hitDiceSpent: 0,
    deathSuccess: 0,
    deathFail: 0,
    exhaustion: 0,
    attacks: [
      { id: uid('atk'), name: 'Dagger', bonus: '+2', damage: '1d4+0 piercing', mastery: 'Nick' }
    ],
    features: '',
    traits: '',
    ideals: '',
    bonds: '',
    flaws: '',
    proficiencies: '',
    // Page 2: Bio, Appearance & Equipment
    portrait: '',
    age: '', height: '', weight: '', eyes: '', skin: '', hair: '', size: 'Medium',
    coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
    attunement: [
      { active: false, name: '' },
      { active: false, name: '' },
      { active: false, name: '' }
    ],
    equipment: '',
    backstory: '',
    allies: '',
    // Page 3: Spellcasting
    spellClass: '',
    spellAbility: 'int',
    spells
  };
}

function normalizeDndChar(raw) {
  const base = createDefaultDndCharData(raw?.name || 'Adventurer', raw?.edition || '2024');
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw };
  out.edition = raw.edition === '5e' ? '5e' : '2024';
  out.abilities = { ...base.abilities, ...(raw.abilities || {}) };
  out.saveProfs = { ...base.saveProfs, ...(raw.saveProfs || {}) };
  out.skillProfs = { ...(raw.skillProfs || {}) };
  out.coins = { ...base.coins, ...(raw.coins || {}) };
  out.attacks = Array.isArray(raw.attacks) ? raw.attacks.map(a => ({ id: a.id || uid('atk'), name: a.name || '', bonus: a.bonus || '', damage: a.damage || '', mastery: a.mastery || '' })) : base.attacks;
  out.attunement = Array.isArray(raw.attunement) && raw.attunement.length === 3
    ? raw.attunement.map(x => ({ active: Boolean(x?.active), name: String(x?.name || '') }))
    : base.attunement;
  out.spells = {};
  for (let lv = 0; lv <= 9; lv++) {
    const s = raw.spells?.[lv] || base.spells[lv];
    out.spells[lv] = {
      slotsTotal: Math.max(0, Math.min(9, Number(s?.slotsTotal) || 0)),
      slotsUsed: Math.max(0, Math.min(9, Number(s?.slotsUsed) || 0)),
      list: Array.isArray(s?.list) ? s.list.map(sp => ({ id: sp.id || uid('sp'), prepared: Boolean(sp.prepared), name: String(sp.name || ''), note: String(sp.note || '') })) : []
    };
  }
  return out;
}

let dndRollMode = 'normal'; // 'normal' | 'adv' | 'dis'
let dndLastRoll = null;     // { label, total, detail, isCrit, isFumble }

function rollDndD20(label, modifier) {
  const mod = Number(modifier) || 0;
  const r1 = Math.floor(Math.random() * 20) + 1;
  const r2 = Math.floor(Math.random() * 20) + 1;
  let chosen = r1;
  let detail = `d20 (${r1}) ${mod >= 0 ? '+' : '-'} ${Math.abs(mod)}`;
  if (dndRollMode === 'adv') {
    chosen = Math.max(r1, r2);
    detail = `Adv [${r1}, ${r2}] → ${chosen} ${mod >= 0 ? '+' : '-'} ${Math.abs(mod)}`;
  } else if (dndRollMode === 'dis') {
    chosen = Math.min(r1, r2);
    detail = `Dis [${r1}, ${r2}] → ${chosen} ${mod >= 0 ? '+' : '-'} ${Math.abs(mod)}`;
  }
  const total = chosen + mod;
  dndLastRoll = { label, total, detail, isCrit: chosen === 20, isFumble: chosen === 1 };
  playCozySound('dice');
  if (chosen === 20) setTimeout(() => playCozySound('chime'), 160);
  return dndLastRoll;
}

function rollDndDiceExpr(label, exprStr) {
  const m = String(exprStr || '').match(/(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i);
  if (!m) return null;
  const count = Math.max(1, Math.min(20, parseInt(m[1], 10)));
  const sides = Math.max(2, Math.min(100, parseInt(m[2], 10)));
  const bonus = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
  const sum = rolls.reduce((a, b) => a + b, 0) + bonus;
  const detail = `${count}d${sides} [${rolls.join(', ')}]${bonus ? (bonus > 0 ? ` + ${bonus}` : ` - ${Math.abs(bonus)}`) : ''}`;
  dndLastRoll = { label, total: sum, detail, isCrit: false, isFumble: false };
  playCozySound('dice');
  return dndLastRoll;
}
