'use strict';

const dns = require('dns').promises;
const net = require('net');

const PANTRY_KEYWORDS = [
  'salt', 'kosher salt', 'sea salt', 'black pepper', 'pepper', 'water',
  'olive oil', 'vegetable oil', 'canola oil', 'cooking spray', 'baking soda',
  'baking powder', 'all-purpose flour', 'flour', 'granulated sugar', 'sugar',
  'garlic powder', 'onion powder', 'paprika', 'cinnamon', 'vanilla extract',
  'italian seasoning', 'red pepper flakes', 'soy sauce', 'vinegar'
];

const UNIT_PATTERN = /^(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|cloves?|cans?|pkgs?|packages?|bags?|bunches?|heads?|slices?|stalks?|sprigs?|pinch(?:es)?|dash(?:es)?|sticks?|jars?|bottles?|boxes?|containers?|pints?|quarts?|gallons?|large|medium|small)\b\.?/i;

const UNICODE_FRACS = {
  '¼': '1/4', '½': '1/2', '¾': '3/4',
  '⅓': '1/3', '⅔': '2/3',
  '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
};

function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&frac12;/gi, '1/2')
    .replace(/&frac14;/gi, '1/4')
    .replace(/&frac34;/gi, '3/4')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIsoDurationMinutes(iso) {
  if (typeof iso === 'number' && iso > 0) return Math.round(iso);
  if (typeof iso !== 'string') return 0;
  const s = iso.trim().toUpperCase();
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) {
    const plain = s.match(/(\d+)\s*(?:min|m\b)/i);
    return plain ? parseInt(plain[1], 10) : 0;
  }
  const days = parseInt(m[1] || '0', 10);
  const hours = parseInt(m[2] || '0', 10);
  const mins = parseInt(m[3] || '0', 10);
  const secs = parseInt(m[4] || '0', 10);
  return days * 1440 + hours * 60 + mins + (secs >= 30 ? 1 : 0);
}

function parseServings(rawYield) {
  const val = Array.isArray(rawYield) ? rawYield[0] : rawYield;
  if (typeof val === 'number' && val > 0) return Math.min(100, Math.round(val));
  if (typeof val === 'string') {
    const m = val.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 100) return n;
    }
  }
  return 4;
}

function parseFractionNumber(str) {
  let s = String(str || '').trim();
  for (const [ch, rep] of Object.entries(UNICODE_FRACS)) {
    s = s.replace(new RegExp(ch, 'g'), ' ' + rep + ' ');
  }
  s = s.replace(/\s+/g, ' ').trim();
  // Handle ranges like "2-3" -> take first number
  if (/^\d+(?:\.\d+)?\s*[-–to]+\s*\d+/.test(s)) {
    s = s.split(/[-–]|to/i)[0].trim();
  }
  // Mixed number "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const d = parseInt(mixed[3], 10);
    return d ? parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d : parseInt(mixed[1], 10);
  }
  // Simple fraction "3/4"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const d = parseInt(frac[2], 10);
    return d ? parseInt(frac[1], 10) / d : null;
  }
  const num = parseFloat(s);
  return Number.isNaN(num) ? null : num;
}

function isLikelyPantryStaple(name) {
  const low = String(name || '').toLowerCase();
  return PANTRY_KEYWORDS.some((kw) => {
    const re = new RegExp(`(^|\\b)${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i');
    return re.test(low);
  });
}

function parseIngredientLine(rawLine) {
  let text = decodeHtmlEntities(rawLine);
  if (!text) return null;

  // Normalize unicode fractions at start
  let work = text;
  for (const [ch, rep] of Object.entries(UNICODE_FRACS)) {
    work = work.replace(new RegExp(ch, 'g'), ' ' + rep + ' ');
  }
  work = work.replace(/\s+/g, ' ').trim();

  let qty = null;
  let unit = '';
  let rest = work;

  // Match leading quantity: e.g. "1 1/2", "1/2", "2.5", "2-3"
  const qtyMatch = rest.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s+/);
  if (qtyMatch) {
    qty = parseFractionNumber(qtyMatch[1]);
    rest = rest.slice(qtyMatch[0].length).trim();
  }

  // Optional parenthetical package size like "(14 oz) can" -> skip into name or unit
  const unitMatch = rest.match(UNIT_PATTERN);
  if (unitMatch) {
    unit = unitMatch[1].replace(/\.$/, '').trim();
    rest = rest.slice(unitMatch[0].length).replace(/^\s*of\s+/i, '').trim();
  }

  const name = rest || text;
  return {
    qty: qty !== null && qty > 0 ? +qty.toFixed(3) : 1,
    hasExplicitQty: qty !== null && qty > 0,
    unit,
    name,
    pantry: isLikelyPantryStaple(name)
  };
}

function detectTimerMinutes(stepText) {
  const s = String(stepText || '');
  // Look for "12 minutes", "5-6 min", "1 hour"
  const minMatch = s.match(/\b(\d{1,3})(?:\s*[-–to]+\s*\d{1,3})?\s*(?:minutes?|mins?)\b/i);
  if (minMatch) {
    const n = parseInt(minMatch[1], 10);
    if (n >= 1 && n <= 240) return n;
  }
  const hrMatch = s.match(/\b(\d{1,2})\s*(?:hours?|hrs?)\b/i);
  if (hrMatch) {
    const n = parseInt(hrMatch[1], 10);
    if (n >= 1 && n <= 12) return n * 60;
  }
  return null;
}

function extractSteps(rawInstructions) {
  const out = [];
  function walk(node) {
    if (!node) return;
    if (typeof node === 'string') {
      const cleaned = decodeHtmlEntities(node);
      if (cleaned) {
        // Split multi-paragraph instructions if needed
        const parts = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          out.push({ text: p, timerMin: detectTimerMinutes(p) });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      if (Array.isArray(node.itemListElement)) {
        walk(node.itemListElement);
        return;
      }
      const txt = node.text || node.name || '';
      if (typeof txt === 'string' && txt.trim()) {
        const cleaned = decodeHtmlEntities(txt);
        if (cleaned) out.push({ text: cleaned, timerMin: detectTimerMinutes(cleaned) });
      }
    }
  }
  walk(rawInstructions);
  return out;
}

function extractImageUrl(rawImage) {
  if (!rawImage) return '';
  if (typeof rawImage === 'string') return rawImage.trim();
  if (Array.isArray(rawImage)) {
    for (const item of rawImage) {
      const u = extractImageUrl(item);
      if (u) return u;
    }
    return '';
  }
  if (typeof rawImage === 'object') {
    return String(rawImage.url || rawImage.contentUrl || '').trim();
  }
  return '';
}

function inferDietaryStamps(recipeObj, totalMin) {
  const tags = new Set();
  const haystack = [
    ...(Array.isArray(recipeObj.suitableForDiet) ? recipeObj.suitableForDiet : [recipeObj.suitableForDiet]),
    ...(Array.isArray(recipeObj.recipeCategory) ? recipeObj.recipeCategory : [recipeObj.recipeCategory]),
    ...(Array.isArray(recipeObj.recipeCuisine) ? recipeObj.recipeCuisine : [recipeObj.recipeCuisine]),
    ...(Array.isArray(recipeObj.keywords) ? recipeObj.keywords : [recipeObj.keywords]),
    recipeObj.name
  ].filter(Boolean).join(' ').toLowerCase();

  if (/vegetarian|vegan/i.test(haystack)) tags.add('Vegetarian');
  if (/keto|low[- ]carb/i.test(haystack)) tags.add('Keto');
  if (/gluten[- ]free/i.test(haystack)) tags.add('Gluten-Free');
  if (/dairy[- ]free|vegan/i.test(haystack)) tags.add('Dairy-Free');
  if (/high[- ]protein/i.test(haystack)) tags.add('High Protein');
  if (/meal[- ]prep/i.test(haystack)) tags.add('Meal Prep');
  if (totalMin > 0 && totalMin <= 30) tags.add('30 Min');

  return Array.from(tags);
}

function isRecipeType(node) {
  if (!node || typeof node !== 'object') return false;
  const t = node['@type'];
  if (typeof t === 'string') return t.toLowerCase() === 'recipe' || t.toLowerCase().endsWith('/recipe');
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && (x.toLowerCase() === 'recipe' || x.toLowerCase().endsWith('/recipe')));
  return false;
}

function findRecipeInJsonLd(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (isRecipeType(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (Array.isArray(obj['@graph'])) {
    const found = findRecipeInJsonLd(obj['@graph']);
    if (found) return found;
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const found = findRecipeInJsonLd(val);
      if (found) return found;
    }
  }
  return null;
}

function extractRecipeFromHtml(html, sourceUrl) {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let recipeObj = null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = match[1].trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      const found = findRecipeInJsonLd(parsed);
      if (found) {
        recipeObj = found;
        break;
      }
    } catch (e) {
      // Some blogs have unescaped newlines inside JSON-LD strings
      try {
        const cleaned = rawJson.replace(/[\u0000-\u001F]+/g, ' ');
        const parsed = JSON.parse(cleaned);
        const found = findRecipeInJsonLd(parsed);
        if (found) {
          recipeObj = found;
          break;
        }
      } catch (e2) {}
    }
  }

  let host = '';
  try { host = new URL(sourceUrl).hostname.replace(/^www\./i, ''); } catch (e) {}

  if (!recipeObj) {
    // Fallback to OpenGraph meta tags so user at least gets title/image/source
    const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i))?.[1] || '';
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
    if (!ogTitle) {
      throw Object.assign(new Error('Could not find structured recipe data (JSON-LD) on that page. You can still add it manually!'), { statusCode: 422 });
    }
    return {
      title: decodeHtmlEntities(ogTitle),
      sourceUrl,
      sourceHost: host,
      imageUrl: decodeHtmlEntities(ogImage),
      prepMin: 10,
      cookMin: 20,
      baseServings: 4,
      notes: decodeHtmlEntities(ogDesc),
      ingredients: [],
      steps: [],
      suggestedStamps: [],
      partial: true
    };
  }

  const prepMin = parseIsoDurationMinutes(recipeObj.prepTime);
  const cookMin = parseIsoDurationMinutes(recipeObj.cookTime);
  const totalMin = parseIsoDurationMinutes(recipeObj.totalTime) || (prepMin + cookMin);
  const rawIngs = Array.isArray(recipeObj.recipeIngredient)
    ? recipeObj.recipeIngredient
    : (Array.isArray(recipeObj.ingredients) ? recipeObj.ingredients : []);
  const ingredients = rawIngs.map(parseIngredientLine).filter(Boolean);
  const steps = extractSteps(recipeObj.recipeInstructions);

  return {
    title: decodeHtmlEntities(recipeObj.name || 'Imported Recipe'),
    sourceUrl,
    sourceHost: host,
    imageUrl: extractImageUrl(recipeObj.image),
    prepMin: prepMin || (totalMin > 0 && cookMin === 0 ? Math.round(totalMin * 0.35) : 0),
    cookMin: cookMin || (totalMin > 0 && prepMin === 0 ? Math.round(totalMin * 0.65) : 0),
    baseServings: parseServings(recipeObj.recipeYield),
    notes: decodeHtmlEntities(recipeObj.description || ''),
    ingredients,
    steps,
    suggestedStamps: inferDietaryStamps(recipeObj, totalMin),
    partial: false
  };
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

async function assertSafePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (e) {
    throw Object.assign(new Error('Please enter a valid recipe URL starting with https://'), { statusCode: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only http:// and https:// recipe URLs are supported.'), { statusCode: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw Object.assign(new Error('Local network URLs are not allowed.'), { statusCode: 400 });
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw Object.assign(new Error('Private IP URLs are not allowed.'), { statusCode: 400 });
  }
  try {
    const resolved = await dns.lookup(host);
    if (isPrivateIp(resolved.address)) {
      throw Object.assign(new Error('Private IP URLs are not allowed.'), { statusCode: 400 });
    }
  } catch (err) {
    if (err.statusCode) throw err;
  }
  return parsed.toString();
}

async function importRecipeFromUrl(rawUrl) {
  const safeUrl = await assertSafePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(safeUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StorytellersLibrary/1.0; +https://github.com/stearnsjr/nodular-library)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`Recipe site returned HTTP ${resp.status}. Some sites block automated fetching — you can still enter it manually.`), { statusCode: 502 });
    }
    const html = await resp.text();
    return extractRecipeFromHtml(html, resp.url || safeUrl);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Timed out fetching that recipe page (12s limit).'), { statusCode: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  importRecipeFromUrl,
  extractRecipeFromHtml,
  parseIngredientLine,
  parseIsoDurationMinutes,
  detectTimerMinutes
};
