const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/src', express.static(path.join(__dirname, 'src')));
app.use(express.session ? express.session : (req, res, next) => next());

app.use(session({
  secret: 'chrono-quest-secret-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ─── Chapter data endpoint ───────────────────────────────────────────────────
app.get('/api/chapters', (req, res) => {
  const dataDir = path.join(__dirname, 'src/data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f !== 'glossary.json');
  const chapters = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, f)));
    return { id: data.id, title: data.title, era: data.era, region: data.region, difficulty: data.difficulty, thumbnail: data.thumbnail, description: data.description };
  });
  chapters.sort((a, b) => a.id - b.id);
  res.json(chapters);
});

app.get('/api/chapters/:id', (req, res) => {
  const dataDir = path.join(__dirname, 'src/data');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f !== 'glossary.json');
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, f)));
    if (String(data.id) === String(req.params.id)) return res.json(data);
  }
  res.status(404).json({ error: 'Chapter not found' });
});

// ─── Glossary ─────────────────────────────────────────────────────────────────
app.get('/api/glossary', (req, res) => {
  const p = path.join(__dirname, 'src/data/glossary.json');
  res.json(JSON.parse(fs.readFileSync(p)));
});

// ─── AI chat proxy (uses OpenAI if key provided, else mock) ───────────────────
app.post('/api/ai/chat', async (req, res) => {
  const { message, context, chapterEra } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: `You are an NPC in a history educational RPG set in ${chapterEra}. Stay in character, be historically accurate, speak authentically to the era. Limit responses to 2-3 sentences.` },
            { role: 'user', content: message }
          ],
          max_tokens: 150
        })
      });
      const data = await response.json();
      res.json({ reply: data.choices[0].message.content });
    } catch (e) {
      res.json({ reply: getMockReply(message, chapterEra) });
    }
  } else {
    res.json({ reply: getMockReply(message, chapterEra) });
  }
});

// ─── Admin: upload chapter ────────────────────────────────────────────────────
app.post('/api/admin/chapter', (req, res) => {
  const { chapter } = req.body;
  if (!chapter || !chapter.id) return res.status(400).json({ error: 'Invalid chapter data' });
  const p = path.join(__dirname, `src/data/chapter_${chapter.id}.json`);
  fs.writeFileSync(p, JSON.stringify(chapter, null, 2));
  res.json({ success: true, message: `Chapter ${chapter.id} saved.` });
});

// ─── Progress save/load ────────────────────────────────────────────────────────
app.post('/api/progress/save', (req, res) => {
  req.session.progress = req.body;
  res.json({ success: true });
});
app.get('/api/progress/load', (req, res) => {
  res.json(req.session.progress || {});
});

// ─── Mock NPC replies ──────────────────────────────────────────────────────────
function getMockReply(message, era) {
  const replies = {
    japan: [
      "The way of the samurai is not merely combat — it is a code of honour that governs every breath we take.",
      "Rice is the lifeblood of our people. The daimyo who controls the harvest controls the land.",
      "The Tokugawa shogunate has brought peace, but at what cost to those who once roamed freely?",
      "A ronin without a master is like a river without its banks — powerful, but directionless.",
      "The cherry blossoms remind us: beauty is fleeting, and so is power."
    ],
    americas: [
      "These lands have sustained my people for thousands of seasons. We do not own the earth — we belong to it.",
      "The great river spirits guide us. To ignore them is to lose your way in the forest of life.",
      "Our trade routes stretch further than any European map has ever shown. We knew these lands long before others came.",
      "Maize is sacred. It is not merely food — it is the story of our creation.",
      "The buffalo give us everything: shelter, food, tools. We honor each one we take."
    ],
    rome: [
      "The Senate debates endlessly while the legions hold the frontiers with blood and iron.",
      "Rome was not built in a day, traveller, and it shall not fall in one either — though some say the cracks have already begun.",
      "The Pax Romana is a gift — but a gift given at the point of a gladius is still a demand.",
      "Bread and circuses keep the masses content. But wisdom, that is the true currency of power.",
      "The roads we build today will carry the footsteps of civilizations we cannot yet imagine."
    ],
    default: [
      "History is written by those who survive to tell the tale. Which side will you be on?",
      "Every decision you make today echoes through the ages. Choose wisely, traveller.",
      "These are turbulent times. The wise person observes before acting.",
      "Speak carefully here. Words carry weight in this era.",
      "The path of least resistance is rarely the path of greatest honour."
    ]
  };
  const key = era && era.toLowerCase().includes('japan') ? 'japan'
    : era && (era.toLowerCase().includes('americ') || era.toLowerCase().includes('indigenous')) ? 'americas'
    : era && era.toLowerCase().includes('rom') ? 'rome'
    : 'default';
  const pool = replies[key];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Catch-all → serve index ───────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => console.log(`ChronoQuest server running on port ${PORT}`));
