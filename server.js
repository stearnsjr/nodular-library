'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, 'public'));
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LIBRARIES_DIR = path.join(DATA_DIR, 'libraries');
const LEGACY_STATE_FILE = path.join(DATA_DIR, 'library.json');
const MAX_BACKUPS = Math.max(1, parseInt(process.env.MAX_BACKUPS || '20', 10));
const BACKUP_MIN_INTERVAL_MS = Math.max(0, parseInt(process.env.BACKUP_INTERVAL_SEC || '60', 10) * 1000);
const MAX_BODY_BYTES = Math.max(1, parseInt(process.env.MAX_BODY_MB || '50', 10)) * 1024 * 1024;
const LIBRARY_PASSWORD = process.env.LIBRARY_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(LIBRARIES_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const lastBackupAtByLib = new Map();

function sanitizeLibId(raw) {
  const clean = String(raw || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return clean || 'default';
}

function getLibraryFile(libId) {
  return path.join(LIBRARIES_DIR, `${sanitizeLibId(libId)}.json`);
}

function countBooksInHalls(halls) {
  let n = 0;
  for (const h of halls || []) {
    n += Array.isArray(h.books) ? h.books.length : 0;
    if (Array.isArray(h.subHalls)) n += countBooksInHalls(h.subHalls);
  }
  return n;
}

function migrateLegacyStateIfNeeded() {
  try {
    const existing = fs.readdirSync(LIBRARIES_DIR).filter((f) => f.endsWith('.json'));
    if (existing.length === 0 && fs.existsSync(LEGACY_STATE_FILE)) {
      const target = getLibraryFile('default');
      fs.copyFileSync(LEGACY_STATE_FILE, target);
      console.log('[library] Migrated legacy library.json -> libraries/default.json');
    }
  } catch (err) {
    console.error('[library] Legacy migration check failed:', err.message);
  }
}

migrateLegacyStateIfNeeded();

function parseEnvelopeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { rev: 0, updatedAt: null, state: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw && typeof raw === 'object' && 'state' in raw && typeof raw.rev === 'number') {
      return raw;
    }
    if (raw && typeof raw.title === 'string' && Array.isArray(raw.halls)) {
      return { rev: 1, updatedAt: new Date().toISOString(), state: raw };
    }
  } catch (err) {
    console.error('[library] Failed to parse state file:', err.message);
  }
  return { rev: 0, updatedAt: null, state: null };
}

function listLibraries() {
  migrateLegacyStateIfNeeded();
  const files = fs.readdirSync(LIBRARIES_DIR).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    const id = file.slice(0, -5);
    const filePath = path.join(LIBRARIES_DIR, file);
    const env = parseEnvelopeFile(filePath);
    if (!env.state) continue;
    out.push({
      id,
      title: env.state.title || 'Untitled Library',
      subtitle: env.state.subtitle || '',
      rev: env.rev || 1,
      updatedAt: env.updatedAt || fs.statSync(filePath).mtime.toISOString(),
      hallCount: Array.isArray(env.state.halls) ? env.state.halls.length : 0,
      bookCount: countBooksInHalls(env.state.halls)
    });
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}

function resolveLibraryId(requestedId) {
  migrateLegacyStateIfNeeded();
  if (requestedId) return sanitizeLibId(requestedId);
  const defaultFile = getLibraryFile('default');
  if (fs.existsSync(defaultFile)) return 'default';
  const libs = listLibraries();
  return libs.length > 0 ? libs[0].id : 'default';
}

function readEnvelope(libId) {
  const id = resolveLibraryId(libId);
  const env = parseEnvelopeFile(getLibraryFile(id));
  return { id, ...env };
}

function writeEnvelopeAtomic(libId, envelope) {
  const id = sanitizeLibId(libId);
  const targetFile = getLibraryFile(id);
  const tmpFile = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(envelope), 'utf8');
  fs.renameSync(tmpFile, targetFile);
}

function maybeWriteRollingBackup(libId, previousEnvelope, force = false) {
  if (!previousEnvelope || !previousEnvelope.state) return;
  const id = sanitizeLibId(libId);
  const now = Date.now();
  const lastAt = lastBackupAtByLib.get(id) || 0;
  if (!force && now - lastAt < BACKUP_MIN_INTERVAL_MS) return;
  lastBackupAtByLib.set(id, now);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `library-${id}-rev${previousEnvelope.rev}-${stamp}.json`);
  try {
    fs.writeFileSync(backupPath, JSON.stringify(previousEnvelope), 'utf8');
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('library-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_BACKUPS) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    }
  } catch (err) {
    console.error('[library] Backup write failed:', err.message);
  }
}

function checkAuth(req, res) {
  if (!LIBRARY_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
    const expected = Buffer.from(LIBRARY_PASSWORD, 'utf8');
    const actual = Buffer.from(pass, 'utf8');
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      return true;
    }
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Storyteller\'s Library"',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('Authentication required');
  return false;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let relPath = pathname === '/' ? '/index.html' : pathname;
  try {
    relPath = decodeURIComponent(relPath);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const resolved = path.resolve(PUBLIC_DIR, '.' + relPath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  const contentType = relPath === '/manifest.json'
    ? 'application/manifest+json; charset=utf-8'
    : (MIME_TYPES[ext] || 'application/octet-stream');
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': (ext === '.html' || ext === '.css' || ext === '.js') ? 'no-cache' : 'public, max-age=300'
  });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Health endpoint for Docker HEALTHCHECK (no auth required)
  if (pathname === '/api/health' && req.method === 'GET') {
    const reqId = url.searchParams.get('id') || '';
    const env = readEnvelope(reqId);
    sendJson(res, 200, { ok: true, id: env.id, rev: env.rev, updatedAt: env.updatedAt });
    return;
  }

  if (!checkAuth(req, res)) return;

  if (pathname === '/api/libraries' && req.method === 'GET') {
    try {
      sendJson(res, 200, { libraries: listLibraries() });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Failed to list libraries' });
    }
    return;
  }

  if (pathname === '/api/libraries' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const nextState = body && body.state;
      if (!nextState || typeof nextState.title !== 'string' || !Array.isArray(nextState.halls)) {
        sendJson(res, 400, { error: 'Invalid library state payload' });
        return;
      }
      const baseSlug = sanitizeLibId(body.id || nextState.title || 'library');
      let libId = baseSlug;
      let suffix = 2;
      while (fs.existsSync(getLibraryFile(libId))) {
        libId = sanitizeLibId(`${baseSlug}-${suffix++}`);
      }
      const updated = {
        rev: 1,
        updatedAt: new Date().toISOString(),
        state: nextState
      };
      writeEnvelopeAtomic(libId, updated);
      sendJson(res, 201, {
        ok: true,
        id: libId,
        rev: updated.rev,
        updatedAt: updated.updatedAt,
        library: {
          id: libId,
          title: nextState.title || 'Untitled Library',
          subtitle: nextState.subtitle || '',
          rev: updated.rev,
          updatedAt: updated.updatedAt,
          hallCount: nextState.halls.length,
          bookCount: countBooksInHalls(nextState.halls)
        }
      });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { error: err.message || 'Create failed' });
    }
    return;
  }

  if (pathname.startsWith('/api/libraries/') && req.method === 'DELETE') {
    try {
      const rawId = decodeURIComponent(pathname.slice('/api/libraries/'.length));
      const libId = sanitizeLibId(rawId);
      const filePath = getLibraryFile(libId);
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'Library not found' });
        return;
      }
      const prev = parseEnvelopeFile(filePath);
      maybeWriteRollingBackup(libId, prev, true);
      fs.unlinkSync(filePath);
      sendJson(res, 200, { ok: true, id: libId, libraries: listLibraries() });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Delete failed' });
    }
    return;
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    const reqId = url.searchParams.get('id') || '';
    const env = readEnvelope(reqId);
    sendJson(res, 200, env);
    return;
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const nextState = body && body.state;
      if (!nextState || typeof nextState.title !== 'string' || !Array.isArray(nextState.halls)) {
        sendJson(res, 400, { error: 'Invalid library state payload' });
        return;
      }
      const libId = resolveLibraryId(url.searchParams.get('id') || body.id || '');
      const current = readEnvelope(libId);
      const baseRev = typeof body.baseRev === 'number' ? body.baseRev : null;
      const force = Boolean(body.force);
      if (!force && baseRev !== null && current.rev > 0 && baseRev !== current.rev) {
        sendJson(res, 409, {
          error: 'conflict',
          id: libId,
          rev: current.rev,
          updatedAt: current.updatedAt,
          state: current.state
        });
        return;
      }
      maybeWriteRollingBackup(libId, current, false);
      const updated = {
        rev: current.rev + 1,
        updatedAt: new Date().toISOString(),
        state: nextState
      };
      writeEnvelopeAtomic(libId, updated);
      sendJson(res, 200, { ok: true, id: libId, rev: updated.rev, updatedAt: updated.updatedAt });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { error: err.message || 'Save failed' });
    }
    return;
  }

  function isValidBackupName(name) {
    return typeof name === 'string' && path.basename(name) === name && name.startsWith('library-') && name.endsWith('.json');
  }

  function listBackups() {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => isValidBackupName(f))
      .sort()
      .reverse()
      .map((name) => {
        const full = path.join(BACKUP_DIR, name);
        const st = fs.statSync(full);
        const env = parseEnvelopeFile(full);
        const m = name.match(/^library-(.+)-rev(\d+)-/);
        return {
          name,
          size: st.size,
          mtime: st.mtime.toISOString(),
          libId: m ? m[1] : 'default',
          rev: env.rev || (m ? Number(m[2]) : 0),
          title: env.state?.title || 'Untitled Backup',
          hallCount: Array.isArray(env.state?.halls) ? env.state.halls.length : 0,
          bookCount: countBooksInHalls(env.state?.halls)
        };
      });
  }

  if (pathname === '/api/backups' && req.method === 'GET') {
    try {
      sendJson(res, 200, { backups: listBackups() });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname.startsWith('/api/backups/') && pathname.endsWith('/restore') && req.method === 'POST') {
    try {
      const rawName = decodeURIComponent(pathname.slice('/api/backups/'.length, -'/restore'.length));
      if (!isValidBackupName(rawName)) {
        sendJson(res, 400, { error: 'Invalid backup name' });
        return;
      }
      const backupPath = path.join(BACKUP_DIR, rawName);
      if (!fs.existsSync(backupPath)) {
        sendJson(res, 404, { error: 'Backup not found' });
        return;
      }
      const env = parseEnvelopeFile(backupPath);
      if (!env.state || typeof env.state.title !== 'string' || !Array.isArray(env.state.halls)) {
        sendJson(res, 400, { error: 'Backup file is not a valid library' });
        return;
      }
      const m = rawName.match(/^library-(.+)-rev\d+-/);
      const baseSlug = sanitizeLibId((m && m[1]) || env.state.title || 'restored');
      let libId = baseSlug;
      let suffix = 2;
      while (fs.existsSync(getLibraryFile(libId))) {
        libId = sanitizeLibId(`${baseSlug}-${suffix++}`);
      }
      const restored = {
        rev: 1,
        updatedAt: new Date().toISOString(),
        state: env.state
      };
      writeEnvelopeAtomic(libId, restored);
      sendJson(res, 201, {
        ok: true,
        id: libId,
        rev: restored.rev,
        updatedAt: restored.updatedAt,
        state: restored.state,
        libraries: listLibraries(),
        backups: listBackups()
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Restore failed' });
    }
    return;
  }

  if (pathname.startsWith('/api/backups/') && req.method === 'DELETE') {
    try {
      const rawName = decodeURIComponent(pathname.slice('/api/backups/'.length));
      if (!isValidBackupName(rawName)) {
        sendJson(res, 400, { error: 'Invalid backup name' });
        return;
      }
      const backupPath = path.join(BACKUP_DIR, rawName);
      if (!fs.existsSync(backupPath)) {
        sendJson(res, 404, { error: 'Backup not found' });
        return;
      }
      fs.unlinkSync(backupPath);
      sendJson(res, 200, { ok: true, name: rawName, backups: listBackups() });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Permanent delete failed' });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`[library] Storyteller's Library listening on http://${HOST}:${PORT}`);
  console.log(`[library] Data directory: ${DATA_DIR}`);
  console.log(`[library] Password protection: ${LIBRARY_PASSWORD ? 'ENABLED' : 'disabled'}`);
});
