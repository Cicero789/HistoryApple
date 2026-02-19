/**
 * ChronoQuest — Main Express Server
 * ─────────────────────────────────
 * Grok AI chat + image generation routed through Cloudflare Worker
 *   Worker URL: https://chronoquest-ai.shanheart95.workers.dev
 *   R2 public:  https://pub-f2baa7516b76426abe7a464af22746e7.r2.dev
 *   D1 DB UUID: 3def1618-b215-417c-9d09-3f337f97a5fd
 */

const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const Database = require('better-sqlite3');

const app  = express();
const PORT = 3000;

// ── Config ────────────────────────────────────────────────────────────────────
const CF_WORKER_URL  = 'https://chronoquest-ai.shanheart95.workers.dev';
const CF_API_TOKEN   = process.env.CF_API_TOKEN || '';
const CF_ACCOUNT_ID  = 'aa63e05af724df04d81cce575ffdfa5b';
const D1_DB_ID       = '3def1618-b215-417c-9d09-3f337f97a5fd';
const R2_BUCKET      = 'scholarship';
const R2_PUBLIC_BASE = 'https://pub-f2baa7516b76426abe7a464af22746e7.r2.dev';
const GROK_API_KEY   = process.env.GROK_API_KEY || '';

// ── Local SQLite (fast cache — mirrors D1) ────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const localDb = new Database(path.join(dataDir, 'chronoquest.db'));
localDb.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt      TEXT NOT NULL,
    prompt_hash TEXT NOT NULL UNIQUE,
    r2_key      TEXT,
    public_url  TEXT,
    model       TEXT DEFAULT 'grok-2-image',
    chapter_id  TEXT,
    scene_id    TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id  TEXT,
    npc_name    TEXT,
    user_msg    TEXT NOT NULL,
    npc_reply   TEXT NOT NULL,
    model       TEXT DEFAULT 'grok-3-fast',
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    session_id  TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

const stmts = {
  getImage:      localDb.prepare('SELECT * FROM images WHERE prompt_hash = ? LIMIT 1'),
  insertImage:   localDb.prepare('INSERT OR IGNORE INTO images (prompt, prompt_hash, r2_key, public_url, model, chapter_id, scene_id, created_at) VALUES (@prompt, @hash, @r2_key, @public_url, @model, @chapter_id, @scene_id, @created_at)'),
  allImages:     localDb.prepare('SELECT * FROM images ORDER BY created_at DESC LIMIT 200'),
  chapterImages: localDb.prepare('SELECT * FROM images WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 100'),
  countImages:   localDb.prepare('SELECT COUNT(*) as n FROM images'),
  insertConvo:   localDb.prepare('INSERT INTO conversations (chapter_id, npc_name, user_msg, npc_reply, model, created_at) VALUES (@chapter_id, @npc_name, @user_msg, @npc_reply, @model, @created_at)'),
  getConvos:     localDb.prepare('SELECT * FROM conversations WHERE chapter_id = ? AND npc_name = ? ORDER BY created_at DESC LIMIT 10'),
  countConvos:   localDb.prepare('SELECT COUNT(*) as n FROM conversations'),
};

const crypto = require('crypto');
function hashPrompt(p) { return crypto.createHash('sha256').update(p.trim().toLowerCase()).digest('hex').slice(0,16); }

// ── HTTP helper (uses native Node https) ──────────────────────────────────────
function httpPost(urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(data);
    req.end();
  });
}

function httpGet(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: 'GET', headers,
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Upload buffer to R2 via CF HTTP API
async function uploadToR2(buffer, key, contentType = 'image/png') {
  return new Promise((resolve, reject) => {
    const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`);
    const opts = {
      hostname: u.hostname, port: 443, path: u.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
      },
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        const json = JSON.parse(buf);
        if (json.success) resolve({ key, public_url: `${R2_PUBLIC_BASE}/${key}` });
        else reject(new Error(JSON.stringify(json.errors)));
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('R2 upload timeout')); });
    req.write(buffer);
    req.end();
  });
}

// D1 query via CF HTTP API
async function d1Query(sql, params = []) {
  const r = await httpPost(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DB_ID}/query`,
    { sql, params },
    { 'Authorization': `Bearer ${CF_API_TOKEN}` }
  );
  return JSON.parse(r.body);
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/src', express.static(path.join(__dirname, 'src')));
app.use(session({
  secret: 'chrono-quest-secret-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// ── Chapter API ───────────────────────────────────────────────────────────────
app.get('/api/chapters', (req, res) => {
  const dir = path.join(__dirname, 'src/data');
  const chapters = fs.readdirSync(dir)
    .filter(f => f.startsWith('chapter_') && f.endsWith('.json'))
    .map(f => {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
      return { id: d.id, title: d.title, era: d.era, region: d.region, difficulty: d.difficulty, thumbnail: d.thumbnail, description: d.description };
    })
    .sort((a, b) => a.id - b.id);
  res.json(chapters);
});

app.get('/api/chapters/:id', (req, res) => {
  const dir = path.join(__dirname, 'src/data');
  for (const f of fs.readdirSync(dir).filter(f => f.startsWith('chapter_') && f.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
    if (String(d.id) === String(req.params.id)) return res.json(d);
  }
  res.status(404).json({ error: 'Chapter not found' });
});

// ── Glossary ──────────────────────────────────────────────────────────────────
app.get('/api/glossary', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(path.join(__dirname, 'src/data/glossary.json'))));
});

// ── AI Chat (proxied via CF Worker) ──────────────────────────────────────────
app.post('/api/ai/chat', async (req, res) => {
  const { message, npcName = 'Local Guide', chapterEra = '', chapterId = '', chapterTitle = '' } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // Get prior conversation for context
  let history = [];
  try {
    const rows = stmts.getConvos.all(chapterId, npcName);
    history = rows.reverse().flatMap(r => [
      { role: 'user', content: r.user_msg },
      { role: 'assistant', content: r.npc_reply },
    ]);
  } catch(e) {}

  let reply, model;
  try {
    // Route through CF Worker (not blocked)
    const r = await httpPost(`${CF_WORKER_URL}/chat`, {
      userMessage: message, npcName, era: chapterEra,
      chapterTitle: chapterTitle || chapterEra, history, chapterId,
    });
    
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      reply = data.reply;
      model = data.model;
    } else {
      throw new Error(`Worker status ${r.status}`);
    }
  } catch (err) {
    console.error('[Chat Error]', err.message);
    reply = getMockReply(chapterEra);
    model = 'mock-fallback';
  }

  // Save locally
  try {
    stmts.insertConvo.run({ chapter_id: chapterId, npc_name: npcName, user_msg: message, npc_reply: reply, model, created_at: new Date().toISOString() });
  } catch(e) {}

  res.json({ reply, model });
});

// ── AI Image Generation (Grok → R2 → D1) ────────────────────────────────────
app.post('/api/ai/image', async (req, res) => {
  const { prompt, era = '', region = '', chapterId = '', sceneId = '', width = 1024, height = 576 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const IMAGE_STYLE = 'Historical educational illustration, highly detailed, dramatic atmospheric lighting, painterly style inspired by classical historical art and illuminated manuscripts, rich earthy colors, period-accurate architecture and costumes, cinematic composition, no text overlays, no watermarks';
  const fullPrompt = `${prompt} ${era ? `Setting: ${era}, ${region}.` : ''} ${IMAGE_STYLE}`.replace(/\s+/g, ' ').trim();
  const hash = hashPrompt(fullPrompt);

  // 1. Check local cache
  const cached = stmts.getImage.get(hash);
  if (cached) {
    console.log(`[Image Cache HIT] ${prompt.slice(0,60)}`);
    return res.json({ url: cached.public_url, r2_key: cached.r2_key, cached: true, model: cached.model, id: cached.id });
  }

  // 2. Generate via CF Worker (which calls Grok)
  console.log(`[Grok Image] Generating: ${prompt.slice(0,80)}`);
  try {
    const r = await httpPost(`${CF_WORKER_URL}/image`, { prompt, era, region, chapterId, sceneId, width, height });
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      // Save to local SQLite cache too
      try {
        stmts.insertImage.run({ prompt: fullPrompt, hash, r2_key: data.r2_key || '', public_url: data.url, model: 'grok-2-image', chapter_id: chapterId, scene_id: sceneId, created_at: new Date().toISOString() });
      } catch(e) {}
      return res.json(data);
    } else {
      throw new Error(`Worker returned ${r.status}: ${r.body.slice(0,200)}`);
    }
  } catch(err) {
    console.error('[Image Error]', err.message);
    return res.status(502).json({ error: 'Image generation failed', details: err.message });
  }
});

// ── NPC Portrait ──────────────────────────────────────────────────────────────
app.post('/api/ai/portrait', async (req, res) => {
  const { npcName, era, region, description = '', chapterId = '' } = req.body;
  if (!npcName) return res.status(400).json({ error: 'npcName required' });
  
  const prompt = `Portrait of ${npcName}, a character from ${era} ${region}. ${description}. Close-up portrait, historically accurate costume and setting, detailed expressive face, warm dramatic lighting.`;
  req.body.prompt = prompt;
  req.body.sceneId = `portrait_${npcName.replace(/\s/g,'_')}`;
  
  // Forward to image endpoint
  const { prompt: p, era: e, region: rg, chapterId: cid, sceneId: sid } = req.body;
  const r = await httpPost(`${CF_WORKER_URL}/image`, { prompt: p, era: e, region: rg, chapterId: cid, sceneId: sid });
  if (r.status === 200) res.json(JSON.parse(r.body));
  else res.status(502).json({ error: 'Portrait generation failed' });
});

// ── Admin: Parse textbook excerpt with Grok ──────────────────────────────────
app.post('/api/admin/parse-textbook', async (req, res) => {
  const { text, era = '', region = '' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const parsePrompt = `You are a curriculum designer creating an educational RPG chapter. Analyze this historical text and extract:
1. KEY_TERMS: List of 5-10 important historical terms with brief definitions
2. KEY_EVENTS: List of 3-5 important events with dates
3. KEY_FIGURES: List of 2-4 important people
4. JOBS: List of 3-5 era-appropriate jobs (each with: title, description, pay in local currency 5-10 units, historicalNote)
5. NARRATIVE_HOOK: A 2-3 sentence compelling opening for a student player entering this world

Return as valid JSON with these exact keys: key_terms (array of {term, definition}), key_events (array of {event, date, significance}), key_figures (array of {name, role, description}), jobs (array of {id, title, description, pay, time, difficulty, historicalNote}), narrative_hook (string).

Text: """${text.slice(0, 3000)}"""`;

  try {
    const r = await httpPost(`${CF_WORKER_URL}/chat`, {
      userMessage: parsePrompt,
      npcName: 'Curriculum AI',
      era: era,
      chapterTitle: 'Textbook Analysis',
    });

    if (r.status !== 200) throw new Error('Worker error');
    
    const data = JSON.parse(r.body);
    let parsed;
    
    // Try to extract JSON from the reply
    try {
      const jsonMatch = data.reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {
      parsed = { raw: data.reply };
    }
    
    res.json({ success: true, parsed, model: data.model });
  } catch(err) {
    console.error('[Textbook Parse Error]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Admin: Save Chapter ───────────────────────────────────────────────────────
app.post('/api/admin/chapter', (req, res) => {
  const { chapter } = req.body;
  if (!chapter || !chapter.id) return res.status(400).json({ error: 'Invalid chapter data' });
  const p = path.join(__dirname, `src/data/chapter_${chapter.id}.json`);
  fs.writeFileSync(p, JSON.stringify(chapter, null, 2));
  res.json({ success: true, message: `Chapter ${chapter.id} saved`, path: p });
});

// ── Image Gallery ─────────────────────────────────────────────────────────────
app.get('/api/images', (req, res) => {
  const cid = req.query.chapter;
  try {
    const rows = cid ? stmts.chapterImages.all(cid) : stmts.allImages.all();
    res.json(rows);
  } catch(e) {
    res.json([]);
  }
});

app.get('/api/images/stats', async (req, res) => {
  try {
    // Get from both local and D1
    const localCount = stmts.countImages.get().n;
    const localConvos = stmts.countConvos.get().n;
    
    let workerStats = { images: 0, conversations: 0 };
    try {
      const r = await httpGet(`${CF_WORKER_URL}/stats`);
      if (r.status === 200) workerStats = JSON.parse(r.body);
    } catch(e) {}
    
    res.json({
      local_images: localCount,
      local_convos: localConvos,
      d1_images: workerStats.images,
      d1_convos: workerStats.conversations,
      worker_url: CF_WORKER_URL,
      r2_public: R2_PUBLIC_BASE,
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// ── Progress API ──────────────────────────────────────────────────────────────
app.post('/api/progress/save', (req, res) => {
  const sid = req.sessionID;
  const data = JSON.stringify(req.body);
  try {
    localDb.prepare('INSERT OR REPLACE INTO progress (session_id, data, updated_at) VALUES (?, ?, ?)').run(sid, data, new Date().toISOString());
  } catch(e) {}
  req.session.progress = req.body;
  res.json({ success: true });
});

app.get('/api/progress/load', (req, res) => {
  const sid = req.sessionID;
  try {
    const row = localDb.prepare('SELECT data FROM progress WHERE session_id = ?').get(sid);
    if (row) return res.json(JSON.parse(row.data));
  } catch(e) {}
  res.json(req.session.progress || {});
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let workerOk = false;
  try {
    const r = await httpGet(`${CF_WORKER_URL}/stats`);
    workerOk = r.status === 200;
  } catch(e) {}
  
  res.json({
    status: 'ok',
    server: 'ChronoQuest v2.0',
    worker_url: CF_WORKER_URL,
    worker_ok: workerOk,
    r2_public: R2_PUBLIC_BASE,
    local_images: stmts.countImages.get().n,
    local_convos: stmts.countConvos.get().n,
    grok_model: 'grok-3-fast / grok-2-image',
  });
});

// ── SPA Fallback ──────────────────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ── Mock Reply fallback ───────────────────────────────────────────────────────
function getMockReply(era = '') {
  const e = era.toLowerCase();
  const MOCKS = {
    japan: ["The way of the samurai is not merely combat — it is a code that governs every breath, every bow, every word spoken in the presence of one's lord. Honour is the only armour that matters.", "Rice feeds more than the body here — it feeds the entire order of our world. The shogun measures land in koku, the amount of rice to feed one person for a year.", "The Tokugawa have brought peace, yes, but peace like a heavy stone sitting on a river. Still on the surface, but with powerful currents beneath."],
    americas: ["We do not own this land any more than we own the air we breathe. We belong to it, care for it, and in return it feeds us.", "Our trade routes stretch from the sunrise coasts to the sunset mountains — copper from the great lakes, shells from the southern seas.", "The Great Law says: in every council, every decision, we must ask — will this harm the children of the seventh generation yet unborn?"],
    rome: ["Bread and circuses, the senators say — give the mob enough to eat and enough to watch, and they will forget they have no real power.", "These roads were not built for merchants — they were built for legions. Twenty thousand miles of stone to move armies anywhere within weeks.", "The philosophers say Rome is eternal. But every republic becomes an empire, every empire overextends, every great city eventually feeds the grass."],
    default: ["History is not a river flowing in one direction — it is an ocean, with currents pulling every way at once.", "Every decision echoes through generations. The choices made in moments like this one are the very things historians will puzzle over for centuries.", "Power always thinks it will last forever. That is its greatest weakness."],
  };
  const key = e.includes('japan') ? 'japan' : (e.includes('americ') || e.includes('native')) ? 'americas' : e.includes('rom') ? 'rome' : 'default';
  const pool = MOCKS[key];
  return pool[Math.floor(Math.random() * pool.length)];
}

app.listen(PORT, () => {
  console.log(`\n⏳  ChronoQuest v2.0 running on port ${PORT}`);
  console.log(`   CF Worker: ${CF_WORKER_URL}`);
  console.log(`   R2 Public: ${R2_PUBLIC_BASE}`);
  console.log(`   Local DB : ${stmts.countImages.get().n} images, ${stmts.countConvos.get().n} convos\n`);
});
