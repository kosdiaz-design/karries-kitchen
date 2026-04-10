const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ── Database ── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
let dbAvailable = false;

const VALID_SYNC_KEYS = new Set([
  'ck_imported', 'ck_tracking', 'ck_urls', 'ck_api_key', 'ck_units', 'ck_theme'
]);

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        pin_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_data (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, key)
      );
    `);

    // Seed or update users from env vars
    const pins = {
      eric: process.env.PIN_ERIC,
      karrie: process.env.PIN_KARRIE
    };
    for (const [id, pin] of Object.entries(pins)) {
      if (!pin) continue;
      const exists = await client.query('SELECT pin_hash FROM users WHERE user_id=$1', [id]);
      if (exists.rows.length === 0) {
        const hash = await bcrypt.hash(pin, 10);
        await client.query('INSERT INTO users (user_id, pin_hash) VALUES ($1, $2)', [id, hash]);
        console.log(`Seeded user: ${id}`);
      } else {
        // Update hash if PIN changed
        const match = await bcrypt.compare(pin, exists.rows[0].pin_hash);
        if (!match) {
          const hash = await bcrypt.hash(pin, 10);
          await client.query('UPDATE users SET pin_hash=$1 WHERE user_id=$2', [hash, id]);
          console.log(`Updated PIN for user: ${id}`);
        }
      }
    }
    dbAvailable = true;
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

/* ── Session tokens (in-memory) ── */
const sessions = new Map(); // token → user_id

function authMiddleware(req, res, next) {
  if (!dbAvailable) return res.status(503).json({ error: 'Database unavailable' });
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sessionUser = sessions.get(token);
  if (sessionUser !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/* ── Rate limiting (simple in-memory) ── */
const loginAttempts = new Map(); // ip → { count, resetAt }
function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record && now < record.resetAt) {
    if (record.count >= 10) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }
    record.count++;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
  }
  next();
}

/* ── Health check (for client to probe server availability) ── */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: dbAvailable });
});

/* ── Auth ── */
app.post('/api/login', loginRateLimit, async (req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database unavailable' });
  const { user_id: userId, pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  if (!userId) return res.status(400).json({ error: 'User ID required' });

  try {
    const result = await pool.query('SELECT pin_hash FROM users WHERE user_id=$1', [userId]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (await bcrypt.compare(String(pin), result.rows[0].pin_hash)) {
      const token = crypto.randomUUID();
      sessions.set(token, userId);
      return res.json({ user_id: userId, token });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (e) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ── Sync: Pull ── */
app.get('/api/sync/:userId', authMiddleware, async (req, res) => {
  const { userId } = req.params;
  const since = req.query.since || null;

  if (since && isNaN(Date.parse(since))) {
    return res.status(400).json({ error: 'Invalid since timestamp' });
  }

  try {
    let result;
    if (since) {
      result = await pool.query(
        'SELECT key, value, updated_at FROM sync_data WHERE user_id=$1 AND updated_at > $2',
        [userId, since]
      );
    } else {
      result = await pool.query(
        'SELECT key, value, updated_at FROM sync_data WHERE user_id=$1',
        [userId]
      );
    }
    return res.json({ data: result.rows });
  } catch (e) {
    console.error('Sync pull error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ── Sync: Push ── */
app.put('/api/sync/:userId', authMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items array required' });
  }
  if (items.length > 20) {
    return res.status(400).json({ error: 'Too many items' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    for (const item of items) {
      if (typeof item.key !== 'string' || !VALID_SYNC_KEYS.has(item.key)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid key: ${item.key}` });
      }
      if (item.value !== null && typeof item.value !== 'string') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Value must be string or null' });
      }
      await client.query(
        `INSERT INTO sync_data (user_id, key, value, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [userId, item.key, item.value, now]
      );
    }
    await client.query('COMMIT');
    return res.json({ updated_at: now });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection dead */ }
    console.error('Sync push error:', e);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/* ── Static files ── */
// Only serve specific safe file types, not server.js/package.json
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.js', '.json'].includes(ext) && !filePath.endsWith('.html')) {
      // Block server files but allow JS/JSON that might be in assets
      const base = path.basename(filePath);
      if (['server.js', 'package.json', 'package-lock.json'].includes(base)) {
        res.status(403);
      }
    }
  },
  index: false
}));

app.get('*', (req, res) => {
  // Block direct access to server files
  const blocked = ['server.js', 'package.json', 'package-lock.json', '.env', '.gitignore'];
  const reqFile = path.basename(req.path);
  if (blocked.includes(reqFile)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'KarriesKitchen.html'));
});

/* ── Start ── */
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Karrie's Kitchen running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    app.listen(PORT, () => {
      console.log(`Karrie's Kitchen running on port ${PORT} (no database)`);
    });
  });

/* ── Graceful shutdown ── */
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
