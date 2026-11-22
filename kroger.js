'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createKrogerService({ dataDir }) {
  const CONFIG_FILE = path.join(dataDir, 'kroger-config.json');
  const pendingStates = new Map(); // state -> { createdAt, redirectUri }
  let appTokenCache = { token: null, expiresAt: 0 };

  function readConfigFile() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (err) {
      console.error('[kroger] Config read failed:', err.message);
    }
    return {};
  }

  function writeConfigFile(patch) {
    const next = { ...readConfigFile(), ...patch, updatedAt: new Date().toISOString() };
    const tmp = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
    return next;
  }

  function getEnvMode() {
    const cfg = readConfigFile();
    const raw = (process.env.KROGER_ENV || cfg.env || 'prod').toLowerCase().trim();
    return raw === 'ce' || raw === 'sandbox' ? 'ce' : 'prod';
  }

  function getApiBase() {
    return getEnvMode() === 'ce'
      ? 'https://api-ce.kroger.com/v1'
      : 'https://api.kroger.com/v1';
  }

  function getCredentials() {
    const cfg = readConfigFile();
    const clientId = (process.env.KROGER_CLIENT_ID || cfg.clientId || '').trim();
    const clientSecret = (process.env.KROGER_CLIENT_SECRET || cfg.clientSecret || '').trim();
    const redirectUri = (process.env.KROGER_REDIRECT_URI || cfg.redirectUri || '').trim();
    const fromEnv = Boolean((process.env.KROGER_CLIENT_ID || '').trim() && (process.env.KROGER_CLIENT_SECRET || '').trim());
    return { clientId, clientSecret, redirectUri, fromEnv };
  }

  function resolveRedirectUri(req) {
    const { redirectUri } = getCredentials();
    if (redirectUri) return redirectUri;
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
    return `${proto}://${host}/api/kroger/auth/callback`;
  }

  function getStatus(req) {
    const cfg = readConfigFile();
    const creds = getCredentials();
    const configured = Boolean(creds.clientId && creds.clientSecret);
    const hasUserToken = Boolean(cfg.userAuth && (cfg.userAuth.refreshToken || (cfg.userAuth.accessToken && cfg.userAuth.expiresAt > Date.now())));
    return {
      configured,
      fromEnv: creds.fromEnv,
      env: getEnvMode(),
      connected: configured && hasUserToken,
      connectedAt: cfg.userAuth?.connectedAt || null,
      store: cfg.store || null,
      redirectUri: resolveRedirectUri(req)
    };
  }

  function saveCredentials({ clientId, clientSecret, redirectUri, env }) {
    const patch = {};
    if (typeof clientId === 'string') patch.clientId = clientId.trim();
    if (typeof clientSecret === 'string' && clientSecret.trim() !== '') patch.clientSecret = clientSecret.trim();
    if (typeof redirectUri === 'string') patch.redirectUri = redirectUri.trim();
    if (env === 'prod' || env === 'ce') patch.env = env;
    appTokenCache = { token: null, expiresAt: 0 };
    return writeConfigFile(patch);
  }

  function saveStore(store) {
    if (!store || !store.locationId) {
      return writeConfigFile({ store: null });
    }
    const clean = {
      locationId: String(store.locationId).trim(),
      name: String(store.name || 'Kroger Store').trim(),
      chain: String(store.chain || 'Kroger').trim(),
      address: String(store.address || '').trim(),
      zipCode: String(store.zipCode || '').trim()
    };
    return writeConfigFile({ store: clean });
  }

  function basicAuthHeader() {
    const { clientId, clientSecret } = getCredentials();
    if (!clientId || !clientSecret) {
      throw Object.assign(new Error('Kroger API credentials are not configured yet.'), { statusCode: 400 });
    }
    return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  }

  async function requestToken(params) {
    const url = `${getApiBase()}/connect/oauth2/token`;
    const body = new URLSearchParams(params).toString();
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body
    });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!resp.ok) {
      const detail = json?.error_description || json?.error || json?.message || text || `HTTP ${resp.status}`;
      throw Object.assign(new Error(`Kroger OAuth error: ${detail}`), { statusCode: resp.status === 401 ? 401 : 502 });
    }
    return json;
  }

  async function getAppAccessToken() {
    const now = Date.now();
    if (appTokenCache.token && appTokenCache.expiresAt > now + 30000) {
      return appTokenCache.token;
    }
    const data = await requestToken({
      grant_type: 'client_credentials',
      scope: 'product.compact'
    });
    const expiresIn = Math.max(60, Number(data.expires_in) || 1800);
    appTokenCache = {
      token: data.access_token,
      expiresAt: now + expiresIn * 1000
    };
    return appTokenCache.token;
  }

  async function getUserAccessToken() {
    const cfg = readConfigFile();
    const auth = cfg.userAuth;
    if (!auth) {
      throw Object.assign(new Error('Kroger account is not connected. Please connect your Kroger account first.'), { statusCode: 401 });
    }
    const now = Date.now();
    if (auth.accessToken && auth.expiresAt && auth.expiresAt > now + 30000) {
      return auth.accessToken;
    }
    if (!auth.refreshToken) {
      throw Object.assign(new Error('Kroger session expired. Please reconnect your Kroger account.'), { statusCode: 401 });
    }
    const data = await requestToken({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken
    });
    const expiresIn = Math.max(60, Number(data.expires_in) || 1800);
    writeConfigFile({
      userAuth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || auth.refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
        connectedAt: auth.connectedAt || new Date().toISOString()
      }
    });
    return data.access_token;
  }

  function buildAuthStartUrl(req) {
    const { clientId } = getCredentials();
    if (!clientId) {
      throw Object.assign(new Error('Kroger API credentials are not configured.'), { statusCode: 400 });
    }
    // Prune expired OAuth states (> 15 min)
    const now = Date.now();
    for (const [k, v] of pendingStates.entries()) {
      if (now - v.createdAt > 15 * 60 * 1000) pendingStates.delete(k);
    }
    const stateToken = crypto.randomBytes(18).toString('hex');
    const redirectUri = resolveRedirectUri(req);
    pendingStates.set(stateToken, { createdAt: now, redirectUri });

    const params = new URLSearchParams({
      scope: 'cart.basic:write product.compact profile.compact',
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: stateToken
    });
    return `${getApiBase()}/connect/oauth2/authorize?${params.toString()}`;
  }

  async function handleAuthCallback(queryParams) {
    const error = queryParams.get('error');
    if (error) {
      const desc = queryParams.get('error_description') || error;
      throw Object.assign(new Error(`Kroger sign-in cancelled or failed: ${desc}`), { statusCode: 400 });
    }
    const code = queryParams.get('code');
    const stateToken = queryParams.get('state');
    if (!code || !stateToken || !pendingStates.has(stateToken)) {
      throw Object.assign(new Error('Invalid or expired OAuth state. Please try connecting again.'), { statusCode: 400 });
    }
    const { redirectUri } = pendingStates.get(stateToken);
    pendingStates.delete(stateToken);

    const data = await requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });
    const expiresIn = Math.max(60, Number(data.expires_in) || 1800);
    writeConfigFile({
      userAuth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: Date.now() + expiresIn * 1000,
        connectedAt: new Date().toISOString()
      }
    });
    return { ok: true };
  }

  function disconnectUser() {
    writeConfigFile({ userAuth: null });
    return { ok: true };
  }

  async function krogerApiGet(pathnameWithQuery, token) {
    const resp = await fetch(`${getApiBase()}${pathnameWithQuery}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!resp.ok) {
      const detail = json?.errors?.[0]?.reason || json?.error_description || json?.message || `HTTP ${resp.status}`;
      throw Object.assign(new Error(`Kroger API error: ${detail}`), { statusCode: resp.status >= 400 && resp.status < 500 ? resp.status : 502 });
    }
    return json;
  }

  function pickProductImage(images) {
    if (!Array.isArray(images) || images.length === 0) return '';
    const front = images.find((im) => im && im.perspective === 'front') || images[0];
    const sizes = Array.isArray(front?.sizes) ? front.sizes : [];
    const pref = ['medium', 'small', 'thumbnail', 'large'];
    for (const sz of pref) {
      const found = sizes.find((s) => s && s.size === sz && s.url);
      if (found) return found.url;
    }
    return sizes[0]?.url || '';
  }

  function normalizeProduct(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const item = Array.isArray(raw.items) && raw.items.length > 0 ? raw.items[0] : {};
    const priceObj = item.price || {};
    const regular = typeof priceObj.regular === 'number' && priceObj.regular > 0 ? priceObj.regular : null;
    const promoRaw = typeof priceObj.promo === 'number' && priceObj.promo > 0 ? priceObj.promo : null;
    const promo = promoRaw !== null && (regular === null || promoRaw < regular) ? promoRaw : null;

    const aisleObj = Array.isArray(raw.aisleLocations) && raw.aisleLocations.length > 0 ? raw.aisleLocations[0] : null;
    let aisle = '';
    if (aisleObj) {
      const desc = aisleObj.description || '';
      const num = aisleObj.number ? `Aisle ${aisleObj.number}` : '';
      aisle = [desc, num].filter(Boolean).join(' · ');
    }
    if (!aisle && Array.isArray(raw.categories) && raw.categories.length > 0) {
      aisle = raw.categories[0];
    }

    const stockRaw = item.inventory?.stockLevel || '';
    const stockLevel = ['HIGH', 'LOW', 'TEMPORARILY_OUT_OF_STOCK'].includes(stockRaw) ? stockRaw : 'UNKNOWN';
    const f = item.fulfillment || {};
    const productId = String(raw.productId || raw.upc || '').trim();
    const upc = String(raw.upc || raw.productId || '').trim();

    return {
      upc,
      productId,
      brand: String(raw.brand || '').trim(),
      name: String(raw.description || 'Unnamed Product').trim(),
      size: String(item.size || '').trim(),
      price: regular,
      promo,
      stockLevel,
      aisle: aisle || 'Grocery',
      aisleNumber: aisleObj?.number ? String(aisleObj.number) : '',
      department: aisleObj?.description ? String(aisleObj.description) : (raw.categories?.[0] || 'Grocery'),
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      imageUrl: pickProductImage(raw.images),
      fulfillment: {
        inStore: Boolean(f.inStore),
        curbside: Boolean(f.curbside),
        delivery: Boolean(f.delivery),
        shipToHome: Boolean(f.shipToHome)
      },
      url: productId ? `https://www.kroger.com/p/item/${productId}` : ''
    };
  }

  function extractProductIdFromUrl(rawInput) {
    const s = String(rawInput || '').trim();
    if (!s) return null;
    // Direct 11-14 digit UPC / product ID
    if (/^\d{11,14}$/.test(s)) {
      return s.length < 13 ? s.padStart(13, '0') : s.slice(-13);
    }
    try {
      const parsed = new URL(s);
      // Standard Kroger banner URLs: /p/<slug>/<13-digit-id>
      const pathMatch = parsed.pathname.match(/\/p\/[^/]+\/(\d{11,14})/i) || parsed.pathname.match(/\/(\d{12,14})(?:\/|$)/);
      if (pathMatch) {
        const digits = pathMatch[1];
        return digits.length < 13 ? digits.padStart(13, '0') : digits.slice(-13);
      }
      const qId = parsed.searchParams.get('productId') || parsed.searchParams.get('upc');
      if (qId && /^\d{11,14}$/.test(qId)) {
        return qId.length < 13 ? qId.padStart(13, '0') : qId.slice(-13);
      }
    } catch (e) {
      // Fallback regex if user pasted a partial URL without scheme
      const fallback = s.match(/(\d{12,14})/);
      if (fallback) {
        const digits = fallback[1];
        return digits.length < 13 ? digits.padStart(13, '0') : digits.slice(-13);
      }
    }
    return null;
  }

  async function searchLocations(zipCode, limit = 10) {
    const cleanZip = String(zipCode || '').replace(/[^0-9]/g, '').slice(0, 5);
    if (cleanZip.length !== 5) {
      throw Object.assign(new Error('Please enter a valid 5-digit ZIP code.'), { statusCode: 400 });
    }
    const token = await getAppAccessToken();
    const qs = new URLSearchParams({
      'filter.zipCode.near': cleanZip,
      'filter.limit': String(Math.max(1, Math.min(20, Number(limit) || 10)))
    });
    const json = await krogerApiGet(`/locations?${qs.toString()}`, token);
    const list = Array.isArray(json?.data) ? json.data : [];
    return list.map((loc) => ({
      locationId: String(loc.locationId || ''),
      name: String(loc.name || 'Kroger Store'),
      chain: String(loc.chain || 'Kroger'),
      address: [loc.address?.addressLine1, loc.address?.city, loc.address?.state].filter(Boolean).join(', '),
      zipCode: String(loc.address?.zipCode || cleanZip),
      phone: String(loc.phone || '')
    }));
  }

  async function searchProducts({ term, locationId, limit = 12 }) {
    const cleanTerm = String(term || '').trim();
    if (cleanTerm.length < 2) {
      throw Object.assign(new Error('Enter at least 2 characters to search Kroger.'), { statusCode: 400 });
    }
    const cfg = readConfigFile();
    const locId = String(locationId || cfg.store?.locationId || '').trim();
    const token = await getAppAccessToken();
    const params = {
      'filter.term': cleanTerm,
      'filter.limit': String(Math.max(1, Math.min(25, Number(limit) || 12)))
    };
    if (locId) params['filter.locationId'] = locId;
    const qs = new URLSearchParams(params);
    const json = await krogerApiGet(`/products?${qs.toString()}`, token);
    const list = Array.isArray(json?.data) ? json.data : [];
    return list.map(normalizeProduct).filter(Boolean);
  }

  async function lookupByUrl(rawUrl, locationId) {
    const productId = extractProductIdFromUrl(rawUrl);
    if (!productId) {
      throw Object.assign(new Error('Could not find a Kroger product ID / UPC in that URL.'), { statusCode: 400 });
    }
    const cfg = readConfigFile();
    const locId = String(locationId || cfg.store?.locationId || '').trim();
    const token = await getAppAccessToken();
    const qs = new URLSearchParams();
    if (locId) qs.set('filter.locationId', locId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const json = await krogerApiGet(`/products/${encodeURIComponent(productId)}${suffix}`, token);
    const prod = normalizeProduct(json?.data);
    if (!prod) {
      throw Object.assign(new Error(`No Kroger product found for ID ${productId}.`), { statusCode: 404 });
    }
    return { productId, product: prod };
  }

  async function refreshProducts(upcs, locationId) {
    const cleanUpcs = Array.from(new Set(
      (Array.isArray(upcs) ? upcs : [])
        .map((u) => String(u || '').replace(/[^0-9]/g, ''))
        .filter((u) => u.length >= 11 && u.length <= 14)
        .map((u) => (u.length < 13 ? u.padStart(13, '0') : u.slice(-13)))
    ));
    if (cleanUpcs.length === 0) return {};

    const cfg = readConfigFile();
    const locId = String(locationId || cfg.store?.locationId || '').trim();
    const token = await getAppAccessToken();
    const out = {};

    // Batch in chunks of 40 (Kroger API allows up to 50 filter.productId values)
    for (let i = 0; i < cleanUpcs.length; i += 40) {
      const chunk = cleanUpcs.slice(i, i + 40);
      const params = {
        'filter.productId': chunk.join(','),
        'filter.limit': String(chunk.length)
      };
      if (locId) params['filter.locationId'] = locId;
      const qs = new URLSearchParams(params);
      const json = await krogerApiGet(`/products?${qs.toString()}`, token);
      for (const raw of (Array.isArray(json?.data) ? json.data : [])) {
        const norm = normalizeProduct(raw);
        if (norm) {
          if (norm.upc) out[norm.upc] = norm;
          if (norm.productId) out[norm.productId] = norm;
        }
      }
    }
    return out;
  }

  async function addToCart(items, modality = 'PICKUP') {
    const cleanModality = String(modality || 'PICKUP').toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
    const payloadItems = (Array.isArray(items) ? items : [])
      .map((it) => {
        const rawUpc = String(it?.upc || it?.productId || '').replace(/[^0-9]/g, '');
        if (!rawUpc) return null;
        const upc = rawUpc.length < 13 ? rawUpc.padStart(13, '0') : rawUpc.slice(-13);
        const quantity = Math.max(1, Math.min(99, parseInt(it?.quantity || it?.qty || 1, 10) || 1));
        return { upc, quantity, modality: cleanModality };
      })
      .filter(Boolean);

    if (payloadItems.length === 0) {
      throw Object.assign(new Error('No valid Kroger items to add to cart.'), { statusCode: 400 });
    }

    const token = await getUserAccessToken();
    const resp = await fetch(`${getApiBase()}/cart/add`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ items: payloadItems })
    });

    if (!resp.ok) {
      const text = await resp.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) {}
      const detail = json?.errors?.[0]?.reason || json?.error_description || json?.message || text || `HTTP ${resp.status}`;
      throw Object.assign(new Error(`Kroger Cart error: ${detail}`), { statusCode: resp.status === 401 ? 401 : 502 });
    }

    return { ok: true, addedCount: payloadItems.length, modality: cleanModality };
  }

  return {
    getStatus,
    saveCredentials,
    saveStore,
    buildAuthStartUrl,
    handleAuthCallback,
    disconnectUser,
    extractProductIdFromUrl,
    searchLocations,
    searchProducts,
    lookupByUrl,
    refreshProducts,
    addToCart
  };
}

module.exports = { createKrogerService };
