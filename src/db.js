/**
 * ChronoQuest — Local SQLite database
 * Mirrors image metadata that is also stored in Cloudflare R2.
 * Acts as a fast local cache so we never re-generate the same image twice.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'chronoquest.db');

// Ensure the data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt      TEXT    NOT NULL,
    prompt_hash TEXT    NOT NULL UNIQUE,
    r2_key      TEXT    NOT NULL,
    r2_url      TEXT    NOT NULL,
    public_url  TEXT    NOT NULL,
    width       INTEGER DEFAULT 1024,
    height      INTEGER DEFAULT 576,
    model       TEXT    DEFAULT 'aurora',
    chapter_id  TEXT,
    scene_id    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS npc_conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id  TEXT,
    npc_name    TEXT,
    user_msg    TEXT    NOT NULL,
    npc_reply   TEXT    NOT NULL,
    model       TEXT    DEFAULT 'grok-3',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS image_cache_stats (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_hit INTEGER DEFAULT 0,
    cache_miss INTEGER DEFAULT 0,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Prepared statements ─────────────────────────────────────────────────────
const stmts = {
  getImageByHash:   db.prepare('SELECT * FROM images WHERE prompt_hash = ?'),
  insertImage:      db.prepare(`
    INSERT INTO images (prompt, prompt_hash, r2_key, r2_url, public_url, width, height, model, chapter_id, scene_id)
    VALUES (@prompt, @prompt_hash, @r2_key, @r2_url, @public_url, @width, @height, @model, @chapter_id, @scene_id)
  `),
  getAllImages:      db.prepare('SELECT * FROM images ORDER BY created_at DESC'),
  getImagesByChapter: db.prepare('SELECT * FROM images WHERE chapter_id = ? ORDER BY created_at DESC'),
  insertConvo:      db.prepare(`
    INSERT INTO npc_conversations (chapter_id, npc_name, user_msg, npc_reply, model)
    VALUES (@chapter_id, @npc_name, @user_msg, @npc_reply, @model)
  `),
  getConvoHistory:  db.prepare(`
    SELECT * FROM npc_conversations WHERE chapter_id = ? AND npc_name = ?
    ORDER BY created_at DESC LIMIT 20
  `),
  countImages:      db.prepare('SELECT COUNT(*) as total FROM images'),
  countConvos:      db.prepare('SELECT COUNT(*) as total FROM npc_conversations'),
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const crypto = require('crypto');

function hashPrompt(prompt) {
  return crypto.createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex').slice(0, 16);
}

module.exports = {
  hashPrompt,

  // Image operations
  getCachedImage(prompt) {
    return stmts.getImageByHash.get(hashPrompt(prompt)) || null;
  },

  saveImage({ prompt, r2_key, r2_url, public_url, width = 1024, height = 576, model = 'aurora', chapter_id = null, scene_id = null }) {
    const prompt_hash = hashPrompt(prompt);
    try {
      stmts.insertImage.run({ prompt, prompt_hash, r2_key, r2_url, public_url, width, height, model, chapter_id, scene_id });
      return stmts.getImageByHash.get(prompt_hash);
    } catch (e) {
      // Duplicate — return existing
      return stmts.getImageByHash.get(prompt_hash);
    }
  },

  getAllImages() { return stmts.getAllImages.all(); },
  getImagesByChapter(chapterId) { return stmts.getImagesByChapter.all(chapterId); },
  countImages() { return stmts.countImages.get().total; },

  // Conversation operations
  saveConversation({ chapter_id, npc_name, user_msg, npc_reply, model = 'grok-3' }) {
    stmts.insertConvo.run({ chapter_id, npc_name, user_msg, npc_reply, model });
  },

  getConversationHistory(chapter_id, npc_name) {
    return stmts.getConvoHistory.all(chapter_id, npc_name);
  },

  countConvos() { return stmts.countConvos.get().total; },

  // Raw db access
  raw: db,
};
