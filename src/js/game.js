/* ============================================================
   CHRONOQUEST v2.0 — GAME ENGINE
   Features:
   • Grok AI live NPC dialogue (via Cloudflare Worker)
   • AI scene image generation (Grok-2-Image → R2 → D1)
   • Era-accurate economy (earn/spend/travel costs)
   • Character selection (traveler / local)
   • Travel system (short vs. long journey)
   • Decision consequences with historical accuracy
   • Glossary pop-ups, quizzes, end-of-chapter summary
   ============================================================ */

// ─── State ─────────────────────────────────────────────────────
const G = {
  chapter:       null,
  scene:         null,
  player:        { name: 'Traveller', character: null },
  stats:         { health: 100, maxHealth: 100, money: 0, currency: 'coins', inventory: [] },
  glossary:      {},
  currentNpc:    null,
  sceneHistory:  [],
  quizIndex:     0,
  jobsDone:      [],
  retryScene:    null,
  chatHistory:   [],     // [{role, content}] for NPC conversation context
  imageCache:    {},     // prompt → URL
  aiOnline:      true,   // false if Worker unreachable
  soundEnabled:  true,
};

// ─── URL / Storage ──────────────────────────────────────────────
const params    = new URLSearchParams(location.search);
const chapterId = params.get('chapter') || '1';
G.player.name   = params.get('player') || localStorage.getItem('cq_player') || 'Traveller';

// ─── DOM Refs ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
  body:          document.getElementById('gameBody'),
  sceneBg:       $('sceneBg'),
  sceneTitle:    $('sceneTitle'),
  sceneEra:      $('sceneEra'),
  sceneImage:    $('sceneImage'),
  narrative:     $('narrativeText'),
  narrativeBox:  $('narrativeBox'),
  npcDialogue:   $('npcDialogue'),
  npcAvatar:     $('npcAvatar'),
  npcName:       $('npcName'),
  npcSpeech:     $('npcSpeech'),
  npcImageWrap:  $('npcImageWrap'),
  npcPortrait:   $('npcPortrait'),
  talkBtn:       $('talkToNpc'),
  eduPopup:      $('eduPopup'),
  eduTerm:       $('eduTerm'),
  eduBody:       $('eduBody'),
  choices:       $('choicesArea'),
  choicesGrid:   $('choicesGrid'),
  restArea:      $('restArea'),
  restOptions:   $('restOptions'),
  minigame:      $('minigameArea'),
  jobGrid:       $('jobGrid'),
  continueJob:   $('continueAfterJob'),
  travelArea:    $('travelArea'),
  travelGrid:    $('travelGrid'),
  quizArea:      $('quizArea'),
  quizQ:         $('quizQuestion'),
  quizOpts:      $('quizOptions'),
  summary:       $('summaryArea'),
  summaryBody:   $('summaryBody'),
  setback:       $('setbackArea'),
  setbackTitle:  $('setbackTitle'),
  setbackText:   $('setbackText'),
  setbackLesson: $('setbackLesson'),
  setbackBtn:    $('setbackRetry'),
  continueArea:  $('continueArea'),
  continueBtn:   $('continueBtn'),
  hudChapter:    $('hudChapter'),
  healthVal:     $('healthVal'),
  healthBar:     $('healthBar'),
  moneyVal:      $('moneyVal'),
  currencyUnit:  $('currencyUnit'),
  toasts:        $('toastContainer'),
  chatModal:     $('chatModal'),
  chatMessages:  $('chatMessages'),
  chatInput:     $('chatInput'),
  chatSend:      $('chatSend'),
  chatClose:     $('chatClose'),
  chatNpcName:   $('chatNpcName'),
  invModal:      $('inventoryModal'),
  invItems:      $('inventoryItems'),
  invClose:      $('inventoryClose'),
  glossModal:    $('glossaryModal'),
  glossList:     $('glossaryList'),
  glossClose:    $('glossaryClose'),
  mapModal:      $('mapModal'),
  mapClose:      $('mapClose'),
  mapContent:    $('mapContent'),
};

// ─── Utilities ──────────────────────────────────────────────────
function show(...els) { els.forEach(e => e && (e.style.display = '')); }
function hide(...els) { els.forEach(e => e && (e.style.display = 'none')); }
function hideAllSections() {
  [DOM.npcDialogue, DOM.eduPopup, DOM.choices, DOM.restArea,
   DOM.minigame, DOM.travelArea, DOM.quizArea, DOM.summary,
   DOM.setback, DOM.continueArea].forEach(el => el && hide(el));
}

function toast(msg, type = 'info', duration = 3500) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = msg;
  DOM.toasts.appendChild(t);
  setTimeout(() => t.classList.add('toast-fade'), duration - 500);
  setTimeout(() => t.remove(), duration);
}

function md(text) {
  return (text || '')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function typeText(el, text, speed = 18) {
  el.innerHTML = '';
  let i = 0;
  const html = md(text);
  // Parse HTML into chunks preserving tags
  const div = document.createElement('div');
  div.innerHTML = html;
  el.innerHTML = html;
  el.style.opacity = '0';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = '1';
  });
}

function updateHUD() {
  if (!DOM.healthVal) return;
  DOM.healthVal.textContent = Math.max(0, G.stats.health);
  DOM.moneyVal.textContent  = G.stats.money;
  DOM.currencyUnit.textContent = G.stats.currency;
  const pct = Math.max(0, Math.min(100, (G.stats.health / G.stats.maxHealth) * 100));
  if (DOM.healthBar) {
    DOM.healthBar.style.width = `${pct}%`;
    DOM.healthBar.style.background = pct > 60 ? '#4ade80' : pct > 30 ? '#facc15' : '#f87171';
  }
  if (DOM.hudChapter && G.chapter) DOM.hudChapter.textContent = G.chapter.title;
}

function applyStatChange(change) {
  if (!change) return;
  if (change.health !== undefined) {
    const old = G.stats.health;
    G.stats.health = Math.max(0, Math.min(G.stats.maxHealth, G.stats.health + change.health));
    const delta = G.stats.health - old;
    if (delta !== 0) toast(delta > 0 ? `❤️ +${delta} health` : `💔 ${delta} health`, delta > 0 ? 'success' : 'danger');
  }
  if (change.money !== undefined) {
    const old = G.stats.money;
    G.stats.money = Math.max(0, G.stats.money + change.money);
    const delta = G.stats.money - old;
    if (delta !== 0) toast(delta > 0 ? `💰 +${delta} ${G.stats.currency} earned` : `💸 ${Math.abs(delta)} ${G.stats.currency} spent`, delta > 0 ? 'success' : 'warning');
  }
  if (change.item) {
    G.stats.inventory.push(change.item);
    toast(`🎒 Added: ${change.item}`, 'info');
  }
  updateHUD();
  saveProgress();
}

// ─── Background / Theme ─────────────────────────────────────────
function applyChapterTheme(theme) {
  const themes = ['sepia', 'earth', 'stone', 'ocean', 'forest', 'desert'];
  themes.forEach(t => DOM.body && DOM.body.classList.remove(`theme-${t}`));
  if (theme) DOM.body && DOM.body.classList.add(`theme-${theme}`);
}

function setBackground(bg) {
  if (!DOM.sceneBg) return;
  DOM.sceneBg.className = 'scene-bg';
  if (bg) DOM.sceneBg.classList.add(`bg-${bg.replace(/_/g, '-')}`);
}

// ─── AI Image Loading ────────────────────────────────────────────
async function loadSceneImage(scene) {
  if (!DOM.sceneImage) return;
  if (!scene.aiImage && !scene.imagePrompt && !scene.title) return;

  const prompt = scene.imagePrompt || `${scene.title}. ${(scene.text || '').slice(0, 120)}`;
  const cacheKey = `${chapterId}_${scene.id}`;

  // Check memory cache first
  if (G.imageCache[cacheKey]) {
    showImage(G.imageCache[cacheKey]);
    return;
  }

  // Show placeholder
  DOM.sceneImage.style.opacity = '0.3';
  DOM.sceneImage.style.backgroundImage = 'none';

  try {
    const res = await fetch('/api/ai/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        era:       G.chapter.era,
        region:    G.chapter.region,
        chapterId: String(chapterId),
        sceneId:   scene.id,
      }),
    });
    if (!res.ok) throw new Error('Image API error');
    const data = await res.json();
    G.imageCache[cacheKey] = data.url;
    showImage(data.url);
    if (data.cached) console.log(`[Image] Reused from ${data.cached ? 'cache' : 'new'}: ${data.r2_key || data.url.slice(0,60)}`);
  } catch(e) {
    console.warn('[Image] Failed:', e.message);
    DOM.sceneImage.style.opacity = '0';
  }
}

function showImage(url) {
  if (!DOM.sceneImage || !url) return;
  const img = new Image();
  img.onload = () => {
    DOM.sceneImage.style.backgroundImage = `url('${url}')`;
    DOM.sceneImage.style.opacity = '1';
    DOM.sceneImage.style.transition = 'opacity 0.6s';
  };
  img.onerror = () => { DOM.sceneImage.style.opacity = '0'; };
  img.src = url;
}

// ─── NPC Portrait Loading ────────────────────────────────────────
async function loadNpcPortrait(npc) {
  if (!DOM.npcPortrait || !npc || !G.chapter) return;
  if (!npc.name) return;

  const cacheKey = `portrait_${npc.name}`;
  if (G.imageCache[cacheKey]) {
    DOM.npcPortrait.src = G.imageCache[cacheKey];
    show(DOM.npcImageWrap);
    return;
  }

  try {
    const res = await fetch('/api/ai/portrait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        npcName:    npc.name,
        era:        G.chapter.era,
        region:     G.chapter.region,
        description: npc.description || '',
        chapterId:  String(chapterId),
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    G.imageCache[cacheKey] = data.url;
    DOM.npcPortrait.src = data.url;
    DOM.npcPortrait.onload = () => show(DOM.npcImageWrap);
  } catch(e) {
    console.warn('[Portrait] Failed:', e.message);
  }
}

// ─── Scene Renderer ─────────────────────────────────────────────
async function renderScene(sceneId) {
  if (!G.chapter) return;
  const scene = G.chapter.scenes.find(s => s.id === sceneId);
  if (!scene) {
    console.error('Scene not found:', sceneId);
    return;
  }

  G.scene = scene;
  G.sceneHistory.push(sceneId);
  hideAllSections();

  // Update header
  if (DOM.sceneTitle) DOM.sceneTitle.textContent = scene.title || '';
  if (DOM.sceneEra)   DOM.sceneEra.textContent   = G.chapter.era || '';

  // Background
  setBackground(scene.background);

  // Narrative text
  if (DOM.narrative) {
    const text = replacePlaceholders(scene.text || scene.narrative || '');
    typeText(DOM.narrative, text);
  }

  // Load AI scene image async (don't block render)
  if (scene.type !== 'character-select') {
    loadSceneImage(scene);
  }

  // Educational term pop-up
  if (scene.educationalTerm && G.glossary[scene.educationalTerm]) {
    setTimeout(() => showEduPopup(scene.educationalTerm, scene.educationalNote), 1200);
  } else if (scene.educationalNote && scene.educationalTerm) {
    setTimeout(() => showEduPopup(scene.educationalTerm, scene.educationalNote), 1200);
  }

  // NPC
  if (scene.npc) {
    G.currentNpc = scene.npc;
    if (DOM.npcAvatar) DOM.npcAvatar.textContent = scene.npc.avatar || '🧑';
    if (DOM.npcName)   DOM.npcName.textContent   = scene.npc.name || '';
    if (DOM.npcSpeech) DOM.npcSpeech.textContent = scene.npcDialogue || scene.dialogue || '';
    show(DOM.npcDialogue);
    hide(DOM.npcImageWrap);
    loadNpcPortrait(scene.npc);
    G.chatHistory = [];  // Reset chat history for new NPC
  } else {
    hide(DOM.npcDialogue);
    G.currentNpc = null;
  }

  // Scene type specific rendering
  switch (scene.type) {
    case 'character-select': renderCharacterSelect(scene); break;
    case 'narrative':        renderNarrative(scene);       break;
    case 'choice':           renderChoices(scene);          break;
    case 'setback':          renderSetback(scene);          break;
    case 'rest':             renderRest(scene);             break;
    case 'minigame':         renderMinigame(scene);         break;
    case 'travel':           renderTravel(scene);           break;
    case 'quiz':             renderQuiz(scene);             break;
    case 'summary':          renderSummary(scene);          break;
    default:                 renderNarrative(scene);
  }

  updateHUD();
}

// ─── Narrative ──────────────────────────────────────────────────
function renderNarrative(scene) {
  if (scene.next) {
    show(DOM.continueArea);
    if (DOM.continueBtn) {
      DOM.continueBtn.textContent = scene.continueText || 'Continue →';
      DOM.continueBtn.onclick = () => renderScene(scene.next);
    }
  }
}

// ─── Character Select ────────────────────────────────────────────
function renderCharacterSelect(scene) {
  const characters = G.chapter.characters || [];
  if (!DOM.choicesGrid) return;

  DOM.choicesGrid.innerHTML = '';
  characters.forEach(char => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn character-choice';
    btn.innerHTML = `
      <div class="char-avatar">${char.avatar || '🧑'}</div>
      <div class="char-name">${char.name}</div>
      <div class="char-desc">${char.description}</div>
      <div class="char-bonus">✨ ${char.bonus || 'balanced'}</div>
    `;
    btn.onclick = () => {
      G.player.character = char;
      toast(`Playing as: ${char.name}`, 'success');
      // Apply character bonus
      if (char.startingBonus) applyStatChange(char.startingBonus);
      saveProgress();
      renderScene(scene.next || G.chapter.scenes[1].id);
    };
    DOM.choicesGrid.appendChild(btn);
  });

  show(DOM.choices);
  if (DOM.choices.querySelector('.choices-prompt')) {
    DOM.choices.querySelector('.choices-prompt').textContent = scene.choicePrompt || 'Choose your character:';
  }
}

// ─── Choices ─────────────────────────────────────────────────────
function renderChoices(scene) {
  if (!DOM.choicesGrid) return;
  DOM.choicesGrid.innerHTML = '';

  const choices = scene.choices || [];
  choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `
      <span class="choice-text">${choice.text}</span>
      ${choice.hint ? `<span class="choice-hint">${choice.hint}</span>` : ''}
      ${choice.cost ? `<span class="choice-cost">💰 ${choice.cost} ${G.stats.currency}</span>` : ''}
    `;

    // Disable if can't afford
    if (choice.cost && G.stats.money < choice.cost) {
      btn.classList.add('choice-disabled');
      btn.title = `Need ${choice.cost} ${G.stats.currency}`;
    } else {
      btn.onclick = () => makeChoice(choice, scene);
    }

    DOM.choicesGrid.appendChild(btn);
  });

  show(DOM.choices);
}

function makeChoice(choice, scene) {
  G.retryScene = scene.id;

  // Apply stat changes
  if (choice.statChange) applyStatChange(choice.statChange);
  if (choice.cost)        applyStatChange({ money: -choice.cost });

  // Play sound effect
  playSound(choice.outcome && scene.scenes ? 'decision' : 'click');

  // Navigate
  if (choice.outcome) {
    setTimeout(() => renderScene(choice.outcome), 300);
  } else if (choice.next) {
    setTimeout(() => renderScene(choice.next), 300);
  }
}

// ─── Setback ─────────────────────────────────────────────────────
function renderSetback(scene) {
  if (DOM.setbackTitle)  DOM.setbackTitle.textContent  = scene.title || 'Setback!';
  if (DOM.setbackText)   DOM.setbackText.innerHTML     = md(scene.text || '');
  if (DOM.setbackLesson) DOM.setbackLesson.innerHTML   = md(scene.lesson || '');

  if (DOM.setbackBtn) {
    DOM.setbackBtn.textContent = scene.retryText || (scene.retry ? '← Try Again' : 'Continue →');
    DOM.setbackBtn.onclick = () => {
      if (scene.retry && G.retryScene) renderScene(G.retryScene);
      else if (scene.next) renderScene(scene.next);
      else if (G.retryScene) renderScene(G.retryScene);
    };
  }
  show(DOM.setback);
}

// ─── Rest ────────────────────────────────────────────────────────
function renderRest(scene) {
  if (!DOM.restOptions) return;
  DOM.restOptions.innerHTML = '';

  const options = scene.restOptions || [
    { id: 'camp',   label: '🏕️ Camp outdoors',  cost: 0,  health: 10, description: 'Free but basic rest. +10 health.' },
    { id: 'inn',    label: '🏠 Stay at an inn', cost: scene.innCost || 8,  health: 30, description: `Comfortable rest. +30 health. (${scene.innCost || 8} ${G.stats.currency})` },
    { id: 'temple', label: '⛩️ Temple shelter',  cost: 0,  health: 20, description: 'Monks offer free shelter. +20 health.' },
  ];

  options.forEach(opt => {
    const div = document.createElement('div');
    div.className = 'rest-option glass';
    const canAfford = opt.cost === 0 || G.stats.money >= opt.cost;
    div.innerHTML = `
      <div class="rest-label">${opt.label}</div>
      <div class="rest-desc">${opt.description}</div>
      <div class="rest-health">❤️ +${opt.health} health</div>
      ${opt.cost > 0 ? `<div class="rest-cost ${canAfford ? '' : 'unaffordable'}">💰 ${opt.cost} ${G.stats.currency}</div>` : '<div class="rest-free">Free</div>'}
    `;
    if (canAfford) {
      div.style.cursor = 'pointer';
      div.onclick = () => {
        if (opt.cost > 0) applyStatChange({ money: -opt.cost });
        applyStatChange({ health: opt.health });
        toast(`${opt.label} — Rested well!`, 'success');
        if (scene.next) setTimeout(() => renderScene(scene.next), 1000);
      };
    } else {
      div.classList.add('rest-disabled');
      div.title = `Need ${opt.cost} ${G.stats.currency}`;
    }
    DOM.restOptions.appendChild(div);
  });

  show(DOM.restArea);
}

// ─── Minigame (Jobs) ─────────────────────────────────────────────
function renderMinigame(scene) {
  if (!DOM.jobGrid) return;
  DOM.jobGrid.innerHTML = '';

  const jobs = scene.jobs || [];
  jobs.forEach(job => {
    const alreadyDone = G.jobsDone.includes(job.id);
    const card = document.createElement('div');
    card.className = `job-card glass ${alreadyDone ? 'job-done' : ''}`;
    card.innerHTML = `
      <div class="job-header">
        <span class="job-title">${job.title}</span>
        <span class="job-pay">+${job.pay} ${G.stats.currency}</span>
      </div>
      <div class="job-desc">${job.description}</div>
      <div class="job-meta">
        <span class="job-time">⏰ ${job.time}</span>
        <span class="job-diff diff-${job.difficulty}">${job.difficulty}</span>
      </div>
      <div class="job-note">📜 ${job.historicalNote || ''}</div>
      ${alreadyDone 
        ? '<div class="job-done-badge">✅ Completed</div>' 
        : `<button class="btn-work" data-job="${job.id}">Work →</button>`}
    `;

    if (!alreadyDone) {
      card.querySelector('.btn-work').onclick = () => doJob(job, scene);
    }

    DOM.jobGrid.appendChild(card);
  });

  if (scene.next) {
    show(DOM.continueJob);
    DOM.continueJob.textContent = 'Continue Journey →';
    DOM.continueJob.onclick = () => renderScene(scene.next);
  }

  show(DOM.minigame);
}

function doJob(job, scene) {
  if (G.jobsDone.includes(job.id)) { toast('Already done this job today.', 'warning'); return; }

  // Simulate job with small interaction
  const duration = job.difficulty === 'hard' ? 2000 : job.difficulty === 'medium' ? 1500 : 1000;

  // Animate the work
  const btn = DOM.jobGrid.querySelector(`[data-job="${job.id}"]`);
  if (btn) {
    btn.textContent = '⚒️ Working...';
    btn.disabled = true;
    btn.classList.add('working');
  }

  setTimeout(() => {
    G.jobsDone.push(job.id);
    applyStatChange({ money: job.pay });
    if (job.healthCost) applyStatChange({ health: -job.healthCost });
    toast(`✅ ${job.title} complete! +${job.pay} ${G.stats.currency}`, 'success');
    renderMinigame(scene);  // Re-render to show done state
    playSound('earn');
  }, duration);
}

// ─── Travel ──────────────────────────────────────────────────────
function renderTravel(scene) {
  if (!DOM.travelGrid) return;
  DOM.travelGrid.innerHTML = '';

  const routes = scene.routes || scene.choices || [];
  routes.forEach(route => {
    const div = document.createElement('div');
    div.className = 'travel-route glass';
    const canAfford = !route.cost || G.stats.money >= route.cost;
    const hasTransport = !route.requiresTransport || G.stats.inventory.includes(route.requiresTransport);

    div.innerHTML = `
      <div class="route-header">
        <span class="route-icon">${route.icon || '🗺️'}</span>
        <span class="route-name">${route.text || route.name}</span>
        <span class="route-type ${route.isLong ? 'long-journey' : 'short-journey'}">${route.isLong ? 'Long Journey' : 'Short Trip'}</span>
      </div>
      <div class="route-desc">${route.description || ''}</div>
      <div class="route-requirements">
        ${route.cost ? `<span class="req-cost ${canAfford ? '' : 'req-missing'}">💰 ${route.cost} ${G.stats.currency}</span>` : ''}
        ${route.requiresTransport ? `<span class="req-transport ${hasTransport ? '' : 'req-missing'}">${route.icon || '🐎'} ${route.requiresTransport}</span>` : ''}
        ${route.healthCost ? `<span class="req-health">❤️ -${route.healthCost} health</span>` : ''}
        ${route.duration ? `<span class="req-time">⏰ ${route.duration}</span>` : ''}
      </div>
    `;

    if (canAfford && hasTransport) {
      div.style.cursor = 'pointer';
      div.onclick = () => {
        if (route.cost) applyStatChange({ money: -route.cost });
        if (route.healthCost) applyStatChange({ health: -route.healthCost });
        if (route.statChange) applyStatChange(route.statChange);
        toast(`🗺️ Travelling to ${route.destination || 'next location'}...`, 'info');
        if (route.outcome) setTimeout(() => renderScene(route.outcome), 800);
        else if (route.next) setTimeout(() => renderScene(route.next), 800);
      };
    } else {
      div.classList.add('route-blocked');
      if (!canAfford) div.title = `Need ${route.cost} ${G.stats.currency}`;
      if (!hasTransport) div.title = `Need: ${route.requiresTransport}`;
    }

    DOM.travelGrid.appendChild(div);
  });

  show(DOM.travelArea);
}

// ─── Quiz ────────────────────────────────────────────────────────
function renderQuiz(scene) {
  const questions = scene.questions || [];
  if (!questions.length) { if (scene.next) renderScene(scene.next); return; }

  const q = questions[G.quizIndex % questions.length];
  if (!q) { if (scene.next) renderScene(scene.next); return; }

  if (DOM.quizQ) DOM.quizQ.textContent = q.question;
  if (!DOM.quizOpts) return;

  DOM.quizOpts.innerHTML = '';
  (q.options || []).forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.textContent = opt;
    btn.onclick = () => checkAnswer(i, q, scene, questions);
    DOM.quizOpts.appendChild(btn);
  });

  show(DOM.quizArea);
}

function checkAnswer(idx, q, scene, allQs) {
  const correct = idx === q.correct;
  const btns = DOM.quizOpts.querySelectorAll('.quiz-option');
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct) b.classList.add('correct');
    else if (i === idx && !correct) b.classList.add('wrong');
  });

  if (correct) {
    applyStatChange({ health: 5, money: 2 });
    toast('✅ Correct! +5 health +2 coins', 'success');
    playSound('correct');
  } else {
    applyStatChange({ health: -5 });
    toast(`❌ ${q.explanation || 'Incorrect.'}`, 'danger');
    playSound('wrong');
  }

  G.quizIndex++;
  setTimeout(() => {
    if (G.quizIndex < allQs.length) {
      renderQuiz(scene);
    } else {
      G.quizIndex = 0;
      if (scene.next) renderScene(scene.next);
    }
  }, 2000);
}

// ─── Summary ──────────────────────────────────────────────────────
function renderSummary(scene) {
  if (!DOM.summaryBody) return;

  const timeSpent = G.sceneHistory.length;
  const moneyEarned = G.stats.money - (G.chapter.startingStats?.money || 0);
  const choicesCorrect = G.sceneHistory.filter(id => {
    const s = G.chapter.scenes.find(sc => sc.id === id);
    return s && s.type === 'narrative' && !s.type === 'setback';
  }).length;

  // Build guiding question block if present
  const guidingQ = G.chapter.guidingQuestion || '';
  const guidingA = scene.guidingQuestionAnswer || '';
  const guidingBlock = (guidingQ || guidingA) ? `
    <div class="summary-guiding glass">
      ${guidingQ ? `<h3 class="summary-guiding-q">🧭 Guiding Question: <em>${guidingQ}</em></h3>` : ''}
      ${guidingA ? `<p class="summary-guiding-a">${md(guidingA)}</p>` : ''}
    </div>` : '';

  // Build lessons list if present
  const lessonsArr = scene.lessons || [];
  const lessonsBlock = lessonsArr.length ? `
    <div class="summary-lessons glass">
      <h3>📖 Key Lessons</h3>
      <ul class="summary-lessons-list">
        ${lessonsArr.map(l => `<li>${md(l)}</li>`).join('')}
      </ul>
    </div>` : '';

  // Build analysis questions if present
  const analysisArr = scene.analysisQuestions || [];
  const analysisBlock = analysisArr.length ? `
    <div class="summary-analysis glass">
      <h3>💬 Analysis Questions</h3>
      <ol class="summary-analysis-list">
        ${analysisArr.map(q => `<li>${q}</li>`).join('')}
      </ol>
    </div>` : '';

  // Build key terms if present
  const keyTermsArr = scene.keyTerms || [];
  const keyTermsBlock = keyTermsArr.length ? `
    <div class="summary-terms glass">
      <h3>📚 Key Terms</h3>
      <div class="summary-terms-grid">
        ${keyTermsArr.map(t => `<span class="summary-term-tag">${t}</span>`).join('')}
      </div>
    </div>` : '';

  // Build quiz block if present (inline quiz from scene.quiz array)
  const quizArr = scene.quiz || [];
  const quizBlock = quizArr.length ? `
    <div class="summary-quiz glass" id="summaryQuizBlock">
      <h3>📝 Quick Quiz</h3>
      <div id="summaryQuizContainer"></div>
    </div>` : '';

  DOM.summaryBody.innerHTML = `
    <div class="summary-grid">
      <div class="summary-stat">
        <div class="ss-icon">❤️</div>
        <div class="ss-val">${G.stats.health}</div>
        <div class="ss-label">Final Health</div>
      </div>
      <div class="summary-stat">
        <div class="ss-icon">💰</div>
        <div class="ss-val">${G.stats.money} ${G.stats.currency}</div>
        <div class="ss-label">Money Accumulated</div>
      </div>
      <div class="summary-stat">
        <div class="ss-icon">🗺️</div>
        <div class="ss-val">${timeSpent}</div>
        <div class="ss-label">Scenes Visited</div>
      </div>
      <div class="summary-stat">
        <div class="ss-icon">🎒</div>
        <div class="ss-val">${G.stats.inventory.length}</div>
        <div class="ss-label">Items Collected</div>
      </div>
    </div>
    <div class="summary-message">
      ${md(scene.summary || scene.summaryText || `You have completed **${G.chapter.title}**! Your journey through ${G.chapter.era} showed the complexity of this historical period.`)}
    </div>
    ${guidingBlock}
    ${lessonsBlock}
    ${keyTermsBlock}
    ${analysisBlock}
    ${quizBlock}
    ${scene.historicalNote ? `<div class="summary-historical glass"><h3>📖 Historical Context</h3><p>${md(scene.historicalNote)}</p></div>` : ''}
    <div class="summary-actions">
      <a href="/" class="btn-home">← Choose New Chapter</a>
      ${scene.quizScene ? `<button class="btn-quiz" onclick="renderScene('${scene.quizScene}')">📝 Full Quiz</button>` : ''}
    </div>
  `;

  // Render inline quiz if present
  if (quizArr.length) {
    renderInlineSummaryQuiz(quizArr);
  }

  show(DOM.summary);
  saveProgress();
  toast('🏆 Chapter Complete!', 'success', 5000);
}

// ─── Inline Summary Quiz ─────────────────────────────────────────
function renderInlineSummaryQuiz(quizArr) {
  const container = document.getElementById('summaryQuizContainer');
  if (!container) return;

  let currentQ = 0;
  let score = 0;

  function showQuestion() {
    if (currentQ >= quizArr.length) {
      container.innerHTML = `
        <div class="quiz-complete">
          <div class="quiz-score">Score: ${score} / ${quizArr.length}</div>
          <div class="quiz-score-msg">${score >= quizArr.length * 0.7 ? '🏆 Excellent work!' : score >= quizArr.length * 0.5 ? '👍 Good effort!' : '📚 Review the chapter to strengthen your knowledge!'}</div>
        </div>`;
      applyStatChange({ money: score * 2, health: score });
      return;
    }

    const q = quizArr[currentQ];
    container.innerHTML = `
      <div class="sq-question">
        <div class="sq-q-num">Question ${currentQ + 1} of ${quizArr.length}</div>
        <div class="sq-q-text">${q.q}</div>
        <div class="sq-options">
          ${(q.options || []).map((opt, i) => `
            <button class="sq-opt" data-idx="${i}">${opt}</button>
          `).join('')}
        </div>
      </div>`;

    container.querySelectorAll('.sq-opt').forEach(btn => {
      btn.addEventListener('click', function() {
        const chosen = parseInt(this.dataset.idx);
        const correct = q.answer;
        container.querySelectorAll('.sq-opt').forEach((b, i) => {
          b.disabled = true;
          if (i === correct) b.classList.add('sq-correct');
          else if (i === chosen && chosen !== correct) b.classList.add('sq-wrong');
        });
        if (chosen === correct) { score++; toast('✅ Correct!', 'success'); }
        else { toast(`❌ The answer was: ${q.options[correct]}`, 'danger'); }
        setTimeout(() => { currentQ++; showQuestion(); }, 1800);
      });
    });
  }

  showQuestion();
}

// ─── Educational Popup ────────────────────────────────────────────
function showEduPopup(term, note) {
  if (!DOM.eduPopup) return;

  const glossaryDef = G.glossary[term] || {};
  if (DOM.eduTerm) DOM.eduTerm.textContent = term;
  if (DOM.eduBody) {
    DOM.eduBody.innerHTML = md(note || glossaryDef.definition || 'No definition available.');
  }
  show(DOM.eduPopup);

  // Auto-hide after 8 seconds
  const autoHide = setTimeout(() => hide(DOM.eduPopup), 8000);
  if (DOM.eduPopup._autoHide) clearTimeout(DOM.eduPopup._autoHide);
  DOM.eduPopup._autoHide = autoHide;
}

// ─── AI Chat Modal ────────────────────────────────────────────────
function openChatModal() {
  if (!G.currentNpc || !DOM.chatModal) return;
  if (DOM.chatNpcName) DOM.chatNpcName.textContent = `💬 Chat with ${G.currentNpc.name}`;
  if (DOM.chatMessages) DOM.chatMessages.innerHTML = '';
  
  // Show initial NPC speech in chat
  const initMsg = G.scene?.npcDialogue || G.scene?.dialogue || '';
  if (initMsg) addChatMessage(initMsg, 'npc');

  show(DOM.chatModal);
  if (DOM.chatInput) DOM.chatInput.focus();
}

function addChatMessage(text, who) {
  if (!DOM.chatMessages) return;
  const div = document.createElement('div');
  div.className = `chat-msg chat-${who}`;
  div.innerHTML = `
    <div class="chat-bubble">${md(text)}</div>
    <div class="chat-meta">${who === 'npc' ? (G.currentNpc?.name || 'NPC') : G.player.name}</div>
  `;
  DOM.chatMessages.appendChild(div);
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

async function sendChatMessage() {
  if (!DOM.chatInput || !G.currentNpc) return;
  const msg = DOM.chatInput.value.trim();
  if (!msg) return;

  DOM.chatInput.value = '';
  addChatMessage(msg, 'player');

  // Show typing indicator
  const typing = document.createElement('div');
  typing.className = 'chat-msg chat-npc typing';
  typing.innerHTML = '<div class="chat-bubble"><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div>';
  DOM.chatMessages.appendChild(typing);
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:      msg,
        npcName:      G.currentNpc.name,
        chapterEra:   G.chapter.era,
        chapterId:    String(chapterId),
        chapterTitle: G.chapter.title,
      }),
    });

    const data = await res.json();
    typing.remove();

    addChatMessage(data.reply, 'npc');
    G.aiOnline = data.model !== 'mock-fallback';

    // Update NPC speech in scene
    if (DOM.npcSpeech) DOM.npcSpeech.textContent = data.reply;

    // Store in chat history for context
    G.chatHistory.push({ role: 'user', content: msg });
    G.chatHistory.push({ role: 'assistant', content: data.reply });

  } catch(e) {
    typing.remove();
    addChatMessage('*The connection is lost — perhaps the spirits are interfering...*', 'npc');
  }
}

// ─── Sound Effects ───────────────────────────────────────────────
const sounds = {};
function initSounds() {
  // Using Web Audio API for lightweight effects
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    sounds._ctx = ctx;
  } catch(e) { G.soundEnabled = false; }
}

function playSound(type) {
  if (!G.soundEnabled || !sounds._ctx) return;
  try {
    const ctx = sounds._ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const configs = {
      click:   { freq: 440, type: 'sine',   dur: 0.08, vol: 0.1 },
      earn:    { freq: 880, type: 'sine',   dur: 0.3,  vol: 0.15 },
      correct: { freq: 660, type: 'sine',   dur: 0.4,  vol: 0.2 },
      wrong:   { freq: 220, type: 'square', dur: 0.3,  vol: 0.15 },
      decision:{ freq: 550, type: 'sine',   dur: 0.2,  vol: 0.1 },
    };

    const c = configs[type] || configs.click;
    osc.frequency.value = c.freq;
    osc.type = c.type;
    gain.gain.setValueAtTime(c.vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + c.dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + c.dur);
  } catch(e) {}
}

// ─── Modals ───────────────────────────────────────────────────────
function openInventory() {
  if (!DOM.invItems) return;
  DOM.invItems.innerHTML = G.stats.inventory.length
    ? G.stats.inventory.map(item => `<div class="inv-item">🎒 ${item}</div>`).join('')
    : '<p class="empty-inv">Your pack is empty.</p>';
  
  const startItems = G.chapter?.startingStats?.inventory || [];
  if (startItems.length) {
    DOM.invItems.innerHTML += `<hr><p class="inv-section">Starting items:</p>` +
      startItems.map(i => `<div class="inv-item inv-start">📦 ${i}</div>`).join('');
  }
  show(DOM.invModal);
}

function openGlossary() {
  if (!DOM.glossList) return;
  const chapterTerms = G.chapter?.glossary || [];
  const terms = chapterTerms.length ? chapterTerms : Object.keys(G.glossary);

  DOM.glossList.innerHTML = terms.map(term => {
    const def = G.glossary[term] || { definition: 'See textbook.', era: G.chapter?.era };
    return `
      <div class="gloss-item glass" onclick="this.classList.toggle('open')">
        <div class="gloss-term">${term}</div>
        <div class="gloss-def">${md(def.definition || def)}</div>
        ${def.era ? `<div class="gloss-era">Era: ${def.era}</div>` : ''}
      </div>
    `;
  }).join('') || '<p>No glossary terms for this chapter.</p>';
  show(DOM.glossModal);
}

function openMap() {
  if (!DOM.mapContent || !G.chapter) return;
  const scenes = G.chapter.scenes || [];
  DOM.mapContent.innerHTML = `
    <h3>${G.chapter.title}</h3>
    <div class="map-journey">
      ${scenes.map((s, i) => {
        const visited = G.sceneHistory.includes(s.id);
        const current = G.scene?.id === s.id;
        return `
          <div class="map-node ${visited ? 'visited' : ''} ${current ? 'current' : ''} type-${s.type}">
            <div class="map-dot">${current ? '📍' : visited ? '✓' : '○'}</div>
            <div class="map-label">${s.title || s.id}</div>
          </div>
          ${i < scenes.length - 1 ? '<div class="map-line"></div>' : ''}
        `;
      }).join('')}
    </div>
    <div class="map-legend">
      <span class="legend-visited">✓ Visited</span>
      <span class="legend-current">📍 Current</span>
    </div>
  `;
  show(DOM.mapModal);
}

// ─── Placeholder Replacement ─────────────────────────────────────
function replacePlaceholders(text) {
  return text
    .replace(/\{\{money\}\}/g, `${G.stats.money} ${G.stats.currency}`)
    .replace(/\{\{health\}\}/g, String(G.stats.health))
    .replace(/\{\{player\}\}/g, G.player.name)
    .replace(/\{\{character\}\}/g, G.player.character?.name || G.player.name)
    .replace(/\{\{currency\}\}/g, G.stats.currency);
}

// ─── Save / Load Progress ────────────────────────────────────────
function saveProgress() {
  const data = {
    chapterId,
    player:   G.player,
    stats:    G.stats,
    history:  G.sceneHistory.slice(-20),
    scene:    G.scene?.id,
    jobsDone: G.jobsDone,
    ts:       Date.now(),
  };
  localStorage.setItem(`cq_progress_${chapterId}`, JSON.stringify(data));

  // Also save to server
  fetch('/api/progress/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

function loadProgress() {
  const raw = localStorage.getItem(`cq_progress_${chapterId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

// ─── Init ────────────────────────────────────────────────────────
async function init() {
  // Load chapter data
  const res = await fetch(`/api/chapters/${chapterId}`);
  if (!res.ok) { document.body.innerHTML = '<p style="color:white;padding:20px">Chapter not found.</p>'; return; }
  G.chapter = await res.json();

  // Load glossary
  try {
    const gr = await fetch('/api/glossary');
    const glossaryData = await gr.json();
    // Support both array and object formats
    if (Array.isArray(glossaryData)) {
      glossaryData.forEach(entry => {
        if (entry.term) G.glossary[entry.term] = entry;
      });
    } else {
      G.glossary = glossaryData;
    }
  } catch(e) { console.warn('Glossary load failed:', e.message); }

  // Apply chapter starting stats
  if (G.chapter.startingStats) {
    G.stats = {
      ...G.stats,
      ...G.chapter.startingStats,
      maxHealth: G.chapter.startingStats.maxHealth || G.chapter.startingStats.health || 100,
    };
  }

  // Restore saved progress
  const saved = loadProgress();
  if (saved && saved.chapterId == chapterId && saved.ts > Date.now() - 24 * 60 * 60 * 1000) {
    G.stats        = saved.stats   || G.stats;
    G.player       = saved.player  || G.player;
    G.sceneHistory = saved.history || [];
    G.jobsDone     = saved.jobsDone || [];
  }

  // Apply theme
  applyChapterTheme(G.chapter.theme);

  // Init sounds
  initSounds();

  // Wire up HUD buttons
  $('inventoryBtn')?.addEventListener('click', openInventory);
  $('glossaryBtn')?.addEventListener('click',  openGlossary);
  $('mapBtn')?.addEventListener('click',        openMap);

  // Close buttons
  DOM.invClose?.addEventListener('click',    () => hide(DOM.invModal));
  DOM.glossClose?.addEventListener('click',  () => hide(DOM.glossModal));
  DOM.mapClose?.addEventListener('click',    () => hide(DOM.mapModal));
  DOM.chatClose?.addEventListener('click',   () => hide(DOM.chatModal));
  $('eduClose')?.addEventListener('click',   () => hide(DOM.eduPopup));

  // Chat
  DOM.talkBtn?.addEventListener('click',    openChatModal);
  DOM.chatSend?.addEventListener('click',   sendChatMessage);
  DOM.chatInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });

  // Close modals on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hide(modal);
    });
  });

  // Clickable glossary terms in narrative
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('gloss-link')) {
      const term = e.target.dataset.term;
      if (term) showEduPopup(term, G.glossary[term]?.definition);
    }
  });

  // Check if chapter has character select
  const hasCharSelect = G.chapter.scenes.find(s => s.type === 'character-select');
  const startScene = hasCharSelect?.id || G.chapter.scenes[0]?.id || 'intro';

  // If progress exists and has a valid scene, ask to continue
  const savedScene = saved?.scene;
  if (savedScene && G.chapter.scenes.find(s => s.id === savedScene) && savedScene !== startScene) {
    if (confirm(`Resume from "${savedScene}"? (Cancel to start over)`)) {
      G.sceneHistory.pop(); // Remove the scene we're about to render
      renderScene(savedScene);
    } else {
      G.stats    = { ...G.chapter.startingStats, maxHealth: G.chapter.startingStats?.health || 100, inventory: [...(G.chapter.startingStats?.inventory || [])] };
      G.jobsDone = [];
      renderScene(startScene);
    }
  } else {
    renderScene(startScene);
  }

  updateHUD();
}

// ─── Start ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
