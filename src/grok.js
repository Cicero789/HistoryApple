/**
 * ChronoQuest — Grok AI Client
 * Routes through Cloudflare Worker (https://chronoquest-ai.shanheart95.workers.dev)
 * to bypass the Cloudflare WAF that blocks direct xAI API calls from shared IPs.
 *
 * The Worker has D1 + R2 bindings and calls xAI natively from CF's infrastructure.
 */

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const CF_WORKER_URL  = 'https://chronoquest-ai.shanheart95.workers.dev';
const CHAT_MODEL     = 'grok-3-fast';   // via Worker
const IMAGE_MODEL    = 'grok-2-image';  // via Worker

// ── HTTP POST helper ──────────────────────────────────────────────────────────
function postWorker(endpoint, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CF_WORKER_URL}${endpoint}`);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Worker timeout')); });
    req.write(data);
    req.end();
  });
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function chat({ userMessage, npcName, era, chapterTitle, history = [], chapterId = '' }) {
  const r = await postWorker('/chat', { userMessage, npcName, era, chapterTitle, history, chapterId });
  if (r.status !== 200) throw new Error(`Worker /chat ${r.status}: ${r.body.slice(0,200)}`);
  const data = JSON.parse(r.body);
  return data.reply;
}

// ── Image Generation ──────────────────────────────────────────────────────────
async function generateImage(prompt, { era = '', region = '', chapterId = '', sceneId = '' } = {}) {
  const r = await postWorker('/image', { prompt, era, region, chapterId, sceneId }, 90000);
  if (r.status !== 200) throw new Error(`Worker /image ${r.status}: ${r.body.slice(0,200)}`);
  const data = JSON.parse(r.body);
  return {
    url: data.url,
    r2_key: data.r2_key,
    revised_prompt: data.revised_prompt,
    model: IMAGE_MODEL,
    cached: data.cached || false,
  };
}

// ── Prompt Builders ────────────────────────────────────────────────────────────
const IMAGE_STYLE = 'Historical educational illustration, highly detailed, dramatic atmospheric lighting, painterly style inspired by classical historical art and illuminated manuscripts, rich earthy colors, period-accurate architecture and costumes, cinematic composition, no text overlays, no watermarks, no modern elements';

function buildImagePrompt(scene, era, region, style) {
  const eraCtx = era ? `Setting: ${era}, ${region}.` : '';
  return `${scene} ${eraCtx} ${style || IMAGE_STYLE}`.replace(/\s+/g, ' ').trim();
}

function buildPortraitPrompt(npcName, era, region, description = '') {
  return `Portrait of ${npcName}, a character from ${era} ${region}. ${description}. ${IMAGE_STYLE}, close-up portrait, detailed expressive face, historically accurate.`;
}

function buildGlossaryPrompt(term, definition, era) {
  return `Educational illustration of "${term}" as it existed during ${era}. ${definition.split('.')[0]}. ${IMAGE_STYLE}, informational illustration, clear subject focus, museum quality.`;
}

// ── Mock Replies (used when Worker is unavailable) ────────────────────────────
const MOCK_REPLIES = {
  japan: [
    "The way of the samurai is not merely combat — it is a code that governs every breath, every bow, every word spoken in the presence of one's lord. Honour is the only armour that matters.",
    "Rice feeds more than the body here — it feeds the entire order of our world. The shogun measures land in koku, the amount of rice to feed one person for a year. Without rice, there is no Japan.",
    "The Tokugawa have brought peace, yes, but peace like a heavy stone sitting on a river. Still on the surface, but with powerful currents beneath. The ronin in the streets know this well.",
    "A ronin without a lord is a ship without a rudder — capable of great things, but drifting. In this society, your identity is your loyalty. Without a master, who are you?",
    "The cherry blossoms fall in days. That is their lesson to us: live fully, accept impermanence, and fall with grace when your time comes. The samurai understands this deeply.",
  ],
  americas: [
    "We do not own this land any more than we own the air we breathe. We belong to it, care for it, and in return it feeds us. This is a truth that no document can change.",
    "Our trade routes stretch from the sunrise coasts to the sunset mountains — copper from the great lakes, shells from the southern seas, turquoise from the desert canyons.",
    "The Great Law says: in every council, every decision, we must ask — will this harm the children of the seventh generation yet unborn? Seven generations. That is how far our responsibility extends.",
    "The corn, the beans, the squash — plant them together and watch them help each other. This is how our families work too: each one gives what the others need.",
    "When the strangers came with gifts in one hand, we saw the other hand too. A man who gives too freely wants something in return that you may not wish to give.",
  ],
  geography: [
    "Every river on this continent is a road. The Mississippi alone drains forty of your states — imagine following it from its source in the north to where it meets the Gulf. Every junction was a town, every confluence a city.",
    "The mountains do not stop people — they channel them. The Andes taught my people that vertical geography is not an obstacle; it is a storeroom. Different elevation, different crop, different climate. We lived in all of them at once.",
    "The first people who crossed from Asia did not know they were crossing into a new world. They were following the mammoth. The continent shaped itself around their footsteps over twenty thousand years.",
    "You ask how geography shapes people? Walk from the Arctic to the Amazon and count the climates. Count the languages that grew in each one. The land made us different — and that difference made us strong.",
    "The Amazon is not a jungle. It is a garden — planted and tended over thousands of years by people who understood that a forest can be a farm, if you know how to read it.",
    "My ancestors dug five hundred miles of canals through the desert. They did not conquer the desert — they had a conversation with it. They asked what it needed; it gave them water when they provided channels.",
  ],
  rome: [
    "Bread and circuses, the senators say — give the mob enough to eat and enough to watch, and they will forget they have no real power. It has worked for generations.",
    "These roads under your feet were not built for merchants or pilgrims — they were built for legions. Twenty thousand miles of stone to move armies anywhere in the empire within weeks.",
    "To be Roman is to carry Roman law wherever you walk. Our citizenship — even a freed slave can earn it — is the most powerful document in the world.",
    "The gladiators you see in the arena — most are not volunteers thirsting for glory. They are men with no other choice: slaves, prisoners, the desperately poor.",
    "The philosophers say Rome is eternal. But every republic becomes an empire, every empire overextends, every great city eventually feeds the grass.",
  ],
  default: [
    "History is not a river flowing in one direction — it is an ocean, with currents pulling every way at once.",
    "Every decision echoes through generations. The choices made in moments like this one are the very things historians will puzzle over for centuries.",
    "The wise traveller asks more questions than they answer. In every land, in every age, the people who understand what is happening are the ones who listen before they speak.",
    "Ordinary people in extraordinary times rarely feel extraordinary. They feel frightened, tired, uncertain. The courage comes later, when there is no other choice.",
    "Power always thinks it will last forever. That is its greatest weakness.",
  ],
};

function getMockReply(era = '') {
  const e = era.toLowerCase();
  const key = e.includes('japan') ? 'japan'
    : e.includes('geography') || e.includes('migration') || e.includes('beringia') || e.includes('andes') || e.includes('amazon') ? 'geography'
    : (e.includes('americ') || e.includes('native') || e.includes('indigenous') || e.includes('columbian')) ? 'americas'
    : e.includes('rom') ? 'rome'
    : 'default';
  const pool = MOCK_REPLIES[key];
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  chat, generateImage,
  buildImagePrompt, buildPortraitPrompt, buildGlossaryPrompt,
  getMockReply,
  CHAT_MODEL, IMAGE_MODEL, CF_WORKER_URL,
};
