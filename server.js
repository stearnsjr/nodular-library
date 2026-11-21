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
const STATE_FILE = path.join(DATA_DIR, 'library.json');
const MAX_BACKUPS = Math.max(1, parseInt(process.env.MAX_BACKUPS || '20', 10));
const BACKUP_MIN_INTERVAL_MS = Math.max(0, parseInt(process.env.BACKUP_INTERVAL_SEC || '60', 10) * 1000);
const MAX_BODY_BYTES = Math.max(1, parseInt(process.env.MAX_BODY_MB || '50', 10)) * 1024 * 1024;
const LIBRARY_PASSWORD = process.env.LIBRARY_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

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

let lastBackupAt = 0;

function readEnvelope() {
  if (!fs.existsSync(STATE_FILE)) {
    return { rev: 0, updatedAt: null, state: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && 'state' in raw && typeof raw.rev === 'number') {
      return raw;
    }
    // Support plain exported library.json dropped directly into /data/library.json
    if (raw && typeof raw.title === 'string' && Array.isArray(raw.halls)) {
      return { rev: 1, updatedAt: new Date().toISOString(), state: raw };
    }
  } catch (err) {
    console.error('[library] Failed to parse state file:', err.message);
  }
  return { rev: 0, updatedAt: null, state: null };
}

function writeEnvelopeAtomic(envelope) {
  const tmpFile = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(envelope), 'utf8');
  fs.renameSync(tmpFile, STATE_FILE);
}

function maybeWriteRollingBackup(previousEnvelope) {
  if (!previousEnvelope || !previousEnvelope.state) return;
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
  lastBackupAt = now;
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `library-rev${previousEnvelope.rev}-${stamp}.json`);
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
    const env = readEnvelope();
    sendJson(res, 200, { ok: true, rev: env.rev, updatedAt: env.updatedAt });
    return;
  }

  if (!checkAuth(req, res)) return;

  if (pathname === '/api/state' && req.method === 'GET') {
    const env = readEnvelope();
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
      const current = readEnvelope();
      const baseRev = typeof body.baseRev === 'number' ? body.baseRev : null;
      const force = Boolean(body.force);
      if (!force && baseRev !== null && current.rev > 0 && baseRev !== current.rev) {
        sendJson(res, 409, {
          error: 'conflict',
          rev: current.rev,
          updatedAt: current.updatedAt,
          state: current.state
        });
        return;
      }
      maybeWriteRollingBackup(current);
      const updated = {
        rev: current.rev + 1,
        updatedAt: new Date().toISOString(),
        state: nextState
      };
      writeEnvelopeAtomic(updated);
      sendJson(res, 200, { ok: true, rev: updated.rev, updatedAt: updated.updatedAt });
    } catch (err) {
      sendJson(res, err.statusCode || 500, { error: err.message || 'Save failed' });
    }
    return;
  }

  if (pathname === '/api/backups' && req.method === 'GET') {
    try {
      const backups = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('library-') && f.endsWith('.json'))
        .sort()
        .reverse()
        .map((name) => {
          const st = fs.statSync(path.join(BACKUP_DIR, name));
          return { name, size: st.size, mtime: st.mtime.toISOString() };
        });
      sendJson(res, 200, { backups });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
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
