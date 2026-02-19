const GROK_API_KEY = 'xai-REPLACE-WITH-YOUR-KEY'; // Set via Cloudflare Worker env vars in production
const XAI_BASE = 'https://api.x.ai/v1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/chat' && request.method === 'POST') return handleChat(request, env);
    if (url.pathname === '/image' && request.method === 'POST') return handleImage(request, env);
    if (url.pathname === '/images' && request.method === 'GET') return handleListImages(request, env);
    if (url.pathname === '/stats' && request.method === 'GET') return handleStats(request, env);
    if (url.pathname === '/convos' && request.method === 'GET') return handleListConvos(request, env);

    return new Response(JSON.stringify({ 
      service: 'ChronoQuest AI Worker v2.0',
      endpoints: ['/chat', '/image', '/images', '/stats', '/convos']
    }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
};

async function handleChat(request, env) {
  try {
    const body = await request.json();
    const { userMessage, npcName = 'Guide', era = '', chapterTitle = '', history = [], chapterId = '' } = body;
    if (!userMessage) return jsonError('userMessage required', 400);

    const systemPrompt = buildSystemPrompt(npcName, era, chapterTitle);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6),
      { role: 'user', content: userMessage }
    ];

    let reply, model;
    const grokRes = await fetch(`${XAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-3-fast', messages, max_tokens: 200, temperature: 0.82 })
    });

    if (grokRes.ok) {
      const data = await grokRes.json();
      reply = data.choices[0].message.content.trim();
      model = 'grok-3-fast';
    } else {
      reply = getMockReply(era);
      model = 'mock-fallback';
    }

    if (env.DB) {
      try {
        const now = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO chronoquest_conversations (chapter_id, npc_name, user_msg, npc_reply, model, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(chapterId || '', npcName, userMessage, reply, model, now).run();
      } catch(e) { console.error('D1 convo save:', e.message); }
    }

    return jsonOk({ reply, model });
  } catch(e) {
    return jsonError(e.message, 500);
  }
}

async function handleImage(request, env) {
  try {
    const body = await request.json();
    const { prompt, era = '', region = '', chapterId = '', sceneId = '', width = 1024, height = 576 } = body;
    if (!prompt) return jsonError('prompt required', 400);

    const fullPrompt = buildImagePrompt(prompt, era, region);
    const promptHash = await hashStr(fullPrompt);

    // Check D1 cache first
    if (env.DB) {
      try {
        const cached = await env.DB.prepare(
          'SELECT * FROM chronoquest_images WHERE prompt_hash = ? LIMIT 1'
        ).bind(promptHash).first();
        if (cached) {
          return jsonOk({ url: cached.public_url, r2_key: cached.r2_key, cached: true, model: cached.model, id: cached.id });
        }
      } catch(e) { console.error('D1 cache check:', e.message); }
    }

    // Generate via Grok
    const grokRes = await fetch(`${XAI_BASE}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-2-image', prompt: fullPrompt, n: 1, response_format: 'b64_json' })
    });

    if (!grokRes.ok) {
      const errText = await grokRes.text();
      console.error('Grok image error:', grokRes.status, errText.slice(0,200));
      return jsonError(`Image generation failed: ${grokRes.status}`, 502);
    }

    const imageData = await grokRes.json();
    const item = imageData.data[0];
    const b64 = item.b64_json;
    const revisedPrompt = item.revised_prompt || fullPrompt;

    // Upload to R2
    const key = `chronoquest/images/${chapterId || 'general'}/${promptHash}.png`;
    let publicUrl = `https://pub-f2baa7516b76426abe7a464af22746e7.r2.dev/${key}`;
    
    if (env.BUCKET) {
      try {
        const imageBuffer = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        await env.BUCKET.put(key, imageBuffer, {
          httpMetadata: { contentType: 'image/png' },
          customMetadata: { prompt: fullPrompt.slice(0, 500), chapter: chapterId || 'general', generated: new Date().toISOString() }
        });
      } catch(e) { console.error('R2 upload:', e.message); }
    }

    // Save to D1
    const now = new Date().toISOString();
    let savedId = null;
    if (env.DB) {
      try {
        const result = await env.DB.prepare(
          'INSERT INTO chronoquest_images (prompt, prompt_hash, r2_key, public_url, model, chapter_id, scene_id, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(fullPrompt, promptHash, key, publicUrl, 'grok-2-image', chapterId || '', sceneId || '', width, height, now).run();
        savedId = result.meta?.last_row_id;
      } catch(e) { console.error('D1 image save:', e.message); }
    }

    return jsonOk({ url: publicUrl, r2_key: key, revised_prompt: revisedPrompt, cached: false, model: 'grok-2-image', id: savedId });
  } catch(e) {
    return jsonError(e.message, 500);
  }
}

async function handleListImages(request, env) {
  try {
    const url = new URL(request.url);
    const chapterId = url.searchParams.get('chapter');
    if (!env.DB) return jsonOk([]);
    let result;
    if (chapterId) {
      result = await env.DB.prepare(
        'SELECT id, prompt, r2_key, public_url, model, chapter_id, scene_id, width, height, created_at FROM chronoquest_images WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 100'
      ).bind(chapterId).all();
    } else {
      result = await env.DB.prepare(
        'SELECT id, prompt, r2_key, public_url, model, chapter_id, scene_id, width, height, created_at FROM chronoquest_images ORDER BY created_at DESC LIMIT 100'
      ).all();
    }
    return jsonOk(result.results || []);
  } catch(e) { return jsonError(e.message, 500); }
}

async function handleListConvos(request, env) {
  try {
    if (!env.DB) return jsonOk([]);
    const result = await env.DB.prepare(
      'SELECT id, chapter_id, npc_name, user_msg, npc_reply, model, created_at FROM chronoquest_conversations ORDER BY created_at DESC LIMIT 50'
    ).all();
    return jsonOk(result.results || []);
  } catch(e) { return jsonError(e.message, 500); }
}

async function handleStats(request, env) {
  try {
    if (!env.DB) return jsonOk({ images: 0, conversations: 0 });
    const [imgCount, convoCount] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as total FROM chronoquest_images').first(),
      env.DB.prepare('SELECT COUNT(*) as total FROM chronoquest_conversations').first(),
    ]);
    return jsonOk({ images: imgCount?.total || 0, conversations: convoCount?.total || 0, service: 'ChronoQuest AI Worker v2.0' });
  } catch(e) { return jsonError(e.message, 500); }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const IMAGE_STYLE = 'Historical educational illustration, highly detailed, dramatic atmospheric lighting, painterly style inspired by classical historical art, illuminated manuscript aesthetic, rich earthy colors, period-accurate architecture and costumes, cinematic composition, no text overlays, no watermarks, no modern elements';

function buildImagePrompt(scene, era, region) {
  const eraCtx = era ? `Setting: ${era}, ${region}.` : '';
  return `${scene} ${eraCtx} ${IMAGE_STYLE}`.replace(/\s+/g, ' ').trim();
}

function buildSystemPrompt(npcName, era, chapterTitle) {
  return `You are ${npcName}, a historically authentic character living in ${era} (${chapterTitle}).
RULES: Stay in character. Speak for your era. Be historically accurate. Max 2-3 sentences. Be warm and human. Never mention AI or modern tech. Root for underdogs. Reference concrete sensory details around you.`.trim();
}

const MOCKS = {
  japan: ["The way of the samurai is not merely combat — it is a code that governs every breath, every bow, every word spoken in the presence of one's lord. Honour is the only armour that matters.", "Rice feeds more than the body here — it feeds the entire order of our world. The shogun measures land in koku, the amount of rice to feed one person for a year. Without rice, there is no Japan.", "The Tokugawa have brought peace, yes, but peace like a heavy stone sitting on a river. Still on the surface, but with powerful currents beneath. The ronin in the streets know this well.", "A ronin without a lord is a ship without a rudder — capable of great things, but drifting. In this society, your identity is your loyalty. Without a master, who are you?"],
  americas: ["We do not own this land any more than we own the air we breathe. We belong to it, care for it, and in return it feeds us. This is a truth that no document can change.", "Our trade routes stretch from the sunrise coasts to the sunset mountains — copper from the great lakes, shells from the southern seas, turquoise from the desert canyons. We knew this continent's shape long before any ship arrived from the east.", "The Great Law says: in every council, every decision, we must ask — will this harm the children of the seventh generation yet unborn? That is how far our responsibility extends.", "When the strangers came with gifts in one hand, we saw the other hand too. Our elders had seen traders before. They knew: a man who gives too freely wants something in return."],
  geography: ["Every river on this continent is a road. The Mississippi alone drains forty of your states — imagine following it from its source in the north to where it meets the Gulf. Every junction was a town, every confluence a city.", "The mountains do not stop people — they channel them. The Andes taught my people that vertical geography is not an obstacle; it is a storeroom. Different elevation, different crop, different climate. We lived in all of them at once.", "The first people who crossed from Asia did not know they were crossing into a new world. They were following the mammoth. The continent shaped itself around their footsteps over twenty thousand years.", "The Amazon is not a jungle. It is a garden — planted and tended over thousands of years by people who understood that a forest can be a farm, if you know how to read it.", "My ancestors dug five hundred miles of canals through the desert. They did not conquer the desert — they had a conversation with it. They asked what it needed; it gave them water when they provided channels."],
  rome: ["Bread and circuses, the senators say — give the mob enough to eat and enough to watch, and they will forget they have no real power. It has worked for generations.", "These roads under your feet were not built for merchants or pilgrims — they were built for legions. Twenty thousand miles of stone to move armies anywhere in the empire within weeks.", "The philosophers say Rome is eternal. But I have read the histories. Every republic becomes an empire, every empire overextends, every great city eventually feeds the grass.", "To be Roman is to carry Roman law wherever you walk. Our citizenship — even a freed slave can earn it — is the most powerful document in the world."],
  default: ["History is not a river flowing in one direction — it is an ocean, with currents pulling every way at once. The side that wins does not always win because they were right.", "Every decision echoes through generations. The choices made in moments like this one are the very things historians will puzzle over for centuries.", "The wise traveller asks more questions than they answer. In every land, in every age, the people who understand what is happening are the ones who listen before they speak.", "Power always thinks it will last forever. That is its greatest weakness."]
};

function getMockReply(era) {
  const e = (era || '').toLowerCase();
  const key = e.includes('japan') ? 'japan'
    : (e.includes('geography') || e.includes('migration') || e.includes('beringia') || e.includes('andes') || e.includes('amazon')) ? 'geography'
    : (e.includes('americ') || e.includes('native') || e.includes('indigenous')) ? 'americas'
    : e.includes('rom') ? 'rome'
    : 'default';
  const pool = MOCKS[key];
  return pool[Math.floor(Math.random() * pool.length)];
}

async function hashStr(str) {
  const enc = new TextEncoder().encode(str.trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
