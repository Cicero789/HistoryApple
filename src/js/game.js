/* ============================================================
   CHRONOQUEST — GAME ENGINE JS
   Full RPG engine: scenes, choices, HUD, AI chat, glossary
   ============================================================ */

// ─── State ─────────────────────────────────────────────────────
const G = {
  chapter: null,
  scene: null,
  player: { name: 'Traveller', character: null },
  stats: { health: 100, maxHealth: 100, money: 0, currency: 'coins', inventory: [] },
  glossary: {},
  currentNpc: null,
  sceneHistory: [],
  quizIndex: 0,
  jobsDone: [],
  retryScene: null,
};

// ─── URL Params ────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const chapterId = params.get('chapter') || '1';
G.player.name = params.get('player') || localStorage.getItem('chronoquest_player') || 'Traveller';

// ─── DOM Refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const sceneBg = $('sceneBg');
const sceneTitle = $('sceneTitle');
const sceneEra = $('sceneEra');
const narrativeText = $('narrativeText');
const narrativeBox = $('narrativeBox');
const npcDialogue = $('npcDialogue');
const npcAvatar = $('npcAvatar');
const npcName = $('npcName');
const npcSpeech = $('npcSpeech');
const eduPopup = $('eduPopup');
const eduTerm = $('eduTerm');
const eduBody = $('eduBody');
const choicesArea = $('choicesArea');
const choicesGrid = $('choicesGrid');
const restArea = $('restArea');
const restOptions = $('restOptions');
const minigameArea = $('minigameArea');
const jobGrid = $('jobGrid');
const quizArea = $('quizArea');
const summaryArea = $('summaryArea');
const setbackArea = $('setbackArea');
const continueArea = $('continueArea');

// ─── Utilities ─────────────────────────────────────────────────
function show(...els) { els.forEach(e => e && (e.style.display = '')); }
function hide(...els) { els.forEach(e => e && (e.style.display = 'none')); }
function showFlex(...els) { els.forEach(e => e && (e.style.display = 'flex')); }
function hideAll() {
  hide(npcDialogue, eduPopup, choicesArea, restArea, minigameArea, quizArea, summaryArea, setbackArea, continueArea);
}

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function updateHUD() {
  $('healthVal').textContent = G.stats.health;
  $('moneyVal').textContent = G.stats.money;
  $('currencyUnit').textContent = G.stats.currency;
  const pct = Math.max(0, (G.stats.health / G.stats.maxHealth) * 100);
  $('healthBar').style.width = `${pct}%`;
}

function applyStatChange(change) {
  if (!change) return;
  if (change.health) {
    G.stats.health = Math.max(0, Math.min(G.stats.maxHealth, G.stats.health + change.health));
    const msg = change.health > 0 ? `+${change.health} health` : `${change.health} health`;
    toast(msg, change.health > 0 ? 'success' : 'warning');
  }
  if (change.money) {
    G.stats.money = Math.max(0, G.stats.money + change.money);
    const msg = change.money > 0 ? `+${change.money} ${G.stats.currency} earned` : `${change.money} ${G.stats.currency} spent`;
    toast(msg, change.money > 0 ? 'success' : 'warning');
  }
  updateHUD();
  saveProgress();
}

function setBackground(bg) {
  const cls = bg ? `bg-${bg.replace(/_/g, '-')}` : '';
  sceneBg.className = 'scene-bg ' + cls;
}

function markdownToHtml(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

// ─── Load Chapter ───────────────────────────────────────────────
async function loadChapter(id) {
  const bar = $('loadingBar');
  const loadText = $('loadingText');
  let prog = 0;
  const interval = setInterval(() => {
    prog = Math.min(prog + Math.random() * 25, 90);
    bar.style.width = `${prog}%`;
  }, 300);

  try {
    loadText.textContent = 'Loading historical data...';
    const [chRes, glRes] = await Promise.all([
      fetch(`/api/chapters/${id}`),
      fetch('/api/glossary')
    ]);
    G.chapter = await chRes.json();
    const glData = await glRes.json();
    G.glossary = glData.terms || {};

    clearInterval(interval);
    bar.style.width = '100%';
    loadText.textContent = 'Preparing your journey...';

    // Set theme
    document.body.className = `game-page theme-${G.chapter.theme || 'sepia'}`;
    $('hudChapter').textContent = G.chapter.title;
    $('sceneEra').textContent = G.chapter.era;

    // Init stats
    const s = G.chapter.startingStats;
    G.stats.health = s.health || 100;
    G.stats.maxHealth = s.health || 100;
    G.stats.money = s.money || 0;
    G.stats.currency = s.currency || 'coins';
    G.stats.inventory = [...(s.inventory || [])];
    updateHUD();

    await new Promise(r => setTimeout(r, 600));

    // Hide loading, show character select
    const ls = $('loadingScreen');
    ls.style.opacity = '0';
    setTimeout(() => ls.style.display = 'none', 500);

    showCharacterSelect();
  } catch (err) {
    console.error('Failed to load chapter:', err);
    clearInterval(interval);
    toast('Failed to load chapter. Is the server running?', 'error');
    $('loadingText').textContent = 'Failed to load. Try refreshing.';
  }
}

// ─── Character Select ────────────────────────────────────────────
function showCharacterSelect() {
  const overlay = $('characterSelect');
  $('charSubtitle').textContent = G.chapter.era;
  const opts = $('charOptions');
  opts.innerHTML = '';

  G.chapter.characters.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'char-option-btn';
    btn.innerHTML = `
      <div class="char-option-avatar">${ch.avatar}</div>
      <div class="char-option-name">${ch.name}</div>
      <div class="char-option-desc">${ch.description}</div>
    `;
    btn.addEventListener('click', () => {
      G.player.character = ch;
      overlay.style.display = 'none';
      toast(`Playing as ${ch.name}`, 'success');
      playScene('intro');
    });
    opts.appendChild(btn);
  });
  overlay.style.display = 'flex';
}

// ─── Scene Engine ─────────────────────────────────────────────────
function playScene(sceneId) {
  const scene = G.chapter.scenes.find(s => s.id === sceneId);
  if (!scene) { console.error('Scene not found:', sceneId); return; }

  G.scene = scene;
  G.sceneHistory.push(sceneId);
  hideAll();
  setBackground(scene.background || '');

  // Scroll to top of content
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Title
  sceneTitle.textContent = scene.title || '';

  // Apply any stat changes
  if (scene.statChange) applyStatChange(scene.statChange);

  // Narrative
  narrativeText.innerHTML = markdownToHtml(scene.text || '');
  show(narrativeBox);

  // Educational popup
  if (scene.educationalTerm && G.glossary[scene.educationalTerm]) {
    setTimeout(() => showEduPopup(scene.educationalTerm), 800);
  } else if (scene.educationalNote) {
    setTimeout(() => showEduNote(scene.educationalTerm || 'Historical Note', scene.educationalNote), 800);
  }

  // Route by scene type
  switch (scene.type) {
    case 'narrative':
      handleNarrativeScene(scene);
      break;
    case 'choice':
      handleChoiceScene(scene);
      break;
    case 'setback':
      handleSetbackScene(scene);
      break;
    case 'rest':
      handleRestScene(scene);
      break;
    case 'minigame':
      handleMinigameScene(scene);
      break;
    case 'summary':
      handleSummaryScene(scene);
      break;
    default:
      handleNarrativeScene(scene);
  }
}

function handleNarrativeScene(scene) {
  if (scene.npc) showNpc(scene.npc, scene.npcDialogue);
  if (scene.next) {
    setTimeout(() => {
      show(continueArea);
      $('continueBtn').onclick = () => { hide(continueArea); playScene(scene.next); };
    }, 500);
  }
}

function handleChoiceScene(scene) {
  if (scene.npc) showNpc(scene.npc, scene.dialogue);
  setTimeout(() => {
    show(choicesArea);
    choicesGrid.innerHTML = '';
    scene.choices.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `
        <span>${choice.text}</span>
        ${choice.hint ? `<span class="choice-hint">${choice.hint}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        hide(choicesArea, npcDialogue);
        if (choice.statChange) applyStatChange(choice.statChange);
        playScene(choice.outcome);
      });
      choicesGrid.appendChild(btn);
    });
  }, 600);
}

function handleSetbackScene(scene) {
  hide(narrativeBox);
  show(setbackArea);
  $('setbackTitle').textContent = scene.title || 'A Setback!';
  $('setbackText').textContent = scene.text || '';
  $('setbackLesson').innerHTML = scene.lesson ? `📚 Historical Lesson: ${scene.lesson}` : '';

  if (scene.retry === false) {
    // Non-retry setback — just continue
    $('retryBtn').textContent = 'Continue →';
    $('retryBtn').onclick = () => { hide(setbackArea); if (scene.next) playScene(scene.next); };
  } else {
    const retryTarget = G.retryScene || G.sceneHistory[G.sceneHistory.length - 2] || 'intro';
    $('retryBtn').textContent = '← Try Again';
    $('retryBtn').onclick = () => {
      hide(setbackArea);
      G.sceneHistory.pop(); // remove setback from history
      G.sceneHistory.pop(); // remove the failed choice scene
      playScene(retryTarget);
    };
  }
}

function handleRestScene(scene) {
  show(restArea);
  restOptions.innerHTML = '';

  scene.restOptions.forEach(opt => {
    const canAfford = opt.cost === 0 || G.stats.money >= opt.cost;
    const btn = document.createElement('button');
    btn.className = 'rest-btn';
    btn.disabled = !canAfford;
    if (!canAfford) btn.style.opacity = '0.4';
    btn.innerHTML = `
      <span class="rest-icon">${opt.id === 'inn' ? '🏮' : opt.id === 'temple' ? '🛕' : '🌙'}</span>
      <div class="rest-info">
        <span class="rest-title">${opt.title}</span>
        <span class="rest-desc">${opt.description}</span>
        ${opt.historicalNote ? `<span class="rest-note">${opt.historicalNote}</span>` : ''}
      </div>
      <div class="rest-cost">
        <div>+${opt.healthRestore} HP</div>
        <div>${opt.cost > 0 ? `-${opt.cost} ${G.stats.currency}` : 'Free'}</div>
      </div>
    `;
    btn.addEventListener('click', () => {
      if (!canAfford) return;
      applyStatChange({ health: opt.healthRestore, money: -opt.cost });
      hide(restArea);
      toast(`Rested well! +${opt.healthRestore} health`, 'success');
      if (scene.next) playScene(scene.next);
    });
    restOptions.appendChild(btn);
  });
}

function handleMinigameScene(scene) {
  show(minigameArea);
  jobGrid.innerHTML = '';
  hide($('continueAfterJob'));

  let jobsCompleted = 0;

  scene.jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <div class="job-header">
        <span class="job-title">${job.title}</span>
        <span class="job-pay">+${job.pay} ${G.stats.currency}</span>
      </div>
      <p class="job-desc">${job.description}</p>
      ${job.historicalNote ? `<p class="job-note">📜 ${job.historicalNote}</p>` : ''}
      <div class="job-meta">
        <span class="job-tag">⏱ ${job.time}</span>
        <span class="job-tag">💪 ${job.difficulty}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      if (card.classList.contains('selected')) return;
      card.classList.add('selected');
      G.jobsDone.push(job.id);
      applyStatChange({ money: job.pay });
      jobsCompleted++;
      toast(`Completed: ${job.title} +${job.pay} ${G.stats.currency}`, 'success');
      card.innerHTML += `<div style="color:#22c55e;margin-top:8px;font-size:0.85rem">✓ Job Completed</div>`;

      // Show continue after first job
      const continueBtn = $('continueAfterJob');
      continueBtn.style.display = 'block';
      continueBtn.onclick = () => {
        hide(minigameArea);
        if (scene.next) playScene(scene.next);
      };
    });
    jobGrid.appendChild(card);
  });
}

function handleSummaryScene(scene) {
  hide(narrativeBox);
  show(summaryArea);

  // Run quiz first
  if (scene.quiz && scene.quiz.length > 0) {
    G.quizIndex = 0;
    showQuiz(scene.quiz, () => showFinalSummary(scene));
  } else {
    showFinalSummary(scene);
  }
}

// ─── Quiz Engine ──────────────────────────────────────────────────
function showQuiz(questions, onComplete) {
  hide(summaryArea);
  show(quizArea);

  function renderQuestion(idx) {
    if (idx >= questions.length) {
      hide(quizArea);
      onComplete();
      return;
    }
    const q = questions[idx];
    $('quizQuestion').textContent = `Question ${idx + 1}/${questions.length}: ${q.q}`;
    $('quizFeedback').textContent = '';
    $('quizFeedback').className = 'quiz-feedback';
    hide($('quizNext'));

    const opts = $('quizOptions');
    opts.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        opts.querySelectorAll('button').forEach(b => b.disabled = true);
        if (i === q.answer) {
          btn.classList.add('correct');
          $('quizFeedback').className = 'quiz-feedback correct-fb';
          $('quizFeedback').textContent = '✓ Correct! Well done.';
          applyStatChange({ health: 5 });
        } else {
          btn.classList.add('wrong');
          opts.querySelectorAll('button')[q.answer].classList.add('correct');
          $('quizFeedback').className = 'quiz-feedback wrong-fb';
          $('quizFeedback').textContent = `Not quite. The answer is: "${q.options[q.answer]}"`;
        }
        show($('quizNext'));
        $('quizNext').onclick = () => renderQuestion(idx + 1);
      });
      opts.appendChild(btn);
    });
  }

  renderQuestion(0);
}

// ─── Final Summary ─────────────────────────────────────────────────
function showFinalSummary(scene) {
  show(summaryArea);
  summaryArea.innerHTML = `
    <div class="summary-box">
      <h2 class="summary-title">✨ ${scene.title}</h2>
      <p class="summary-subtitle">${scene.summary}</p>

      <div class="summary-section">
        <h3>🎓 Key Lessons</h3>
        ${(scene.lessons || []).map(l => `<div class="lesson-item">${l}</div>`).join('')}
      </div>

      ${scene.keyTerms ? `
      <div class="summary-section">
        <h3>📖 Key Terms Learned</h3>
        <div class="key-terms">
          ${scene.keyTerms.map(t => `<button class="key-term-chip" onclick="showEduPopup('${t}')">${t}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="summary-section">
        <h3>📊 Your Stats</h3>
        <div style="display:flex;gap:24px;font-family:var(--font-ui);font-size:0.9rem;">
          <span>❤️ Health: ${G.stats.health}/${G.stats.maxHealth}</span>
          <span>💰 ${G.stats.currency}: ${G.stats.money}</span>
          <span>🎒 Items: ${G.stats.inventory.length}</span>
        </div>
      </div>

      <div class="summary-actions">
        <a href="/" class="btn-ghost">← All Chapters</a>
        <button class="btn-primary" onclick="location.reload()">▶ Play Again</button>
      </div>
    </div>
  `;
}

// ─── NPC Display ──────────────────────────────────────────────────
function showNpc(npc, speech) {
  show(npcDialogue);
  npcAvatar.textContent = npc.avatar || '👤';
  npcName.textContent = npc.name || 'NPC';
  npcSpeech.textContent = speech || '';
  G.currentNpc = npc;
}

// ─── Educational Popups ───────────────────────────────────────────
function showEduPopup(term) {
  const entry = G.glossary[term];
  if (!entry) return;
  show(eduPopup);
  eduTerm.textContent = term;
  eduBody.innerHTML = `
    <p>${markdownToHtml(entry.definition)}</p>
    ${entry.link ? `<a class="edu-link" href="${entry.link}" target="_blank" style="color:var(--gold);opacity:0.7;font-size:0.85rem;display:block;margin-top:8px;">🔗 Learn more about ${term}</a>` : ''}
  `;
}

function showEduNote(term, note) {
  show(eduPopup);
  eduTerm.textContent = term || 'Historical Note';
  eduBody.innerHTML = `<p>${markdownToHtml(note)}</p>`;
}

$('eduClose')?.addEventListener('click', () => hide(eduPopup));

// ─── AI Chat ──────────────────────────────────────────────────────
$('talkToNpc')?.addEventListener('click', openChat);

function openChat() {
  if (!G.currentNpc) return;
  $('chatNpcName').textContent = G.currentNpc.name;
  $('chatMessages').innerHTML = `
    <div class="chat-msg npc">"${G.scene?.dialogue || 'Greetings, traveller. What do you wish to know?'}"</div>
  `;
  show($('chatPanel'));
  $('chatInput').focus();
}

$('chatClose')?.addEventListener('click', () => hide($('chatPanel')));

$('chatSend')?.addEventListener('click', sendChat);
$('chatInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const messages = $('chatMessages');
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-msg user';
  userMsg.textContent = msg;
  messages.appendChild(userMsg);

  const loading = document.createElement('div');
  loading.className = 'chat-msg npc';
  loading.textContent = '...';
  messages.appendChild(loading);
  messages.scrollTop = messages.scrollHeight;

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        context: G.scene?.dialogue || '',
        chapterEra: G.chapter?.era || ''
      })
    });
    const data = await res.json();
    loading.textContent = `"${data.reply}"`;
  } catch (e) {
    loading.textContent = '"I cannot speak at this moment..."';
  }
  messages.scrollTop = messages.scrollHeight;
}

// ─── Inventory Panel ──────────────────────────────────────────────
$('inventoryBtn')?.addEventListener('click', () => {
  const body = $('inventoryBody');
  body.innerHTML = G.stats.inventory.length === 0
    ? '<p style="opacity:0.5">Your pack is empty.</p>'
    : G.stats.inventory.map(item => `<div class="inventory-item">${item}</div>`).join('');
  show($('inventoryPanel'));
});
$('inventoryClose')?.addEventListener('click', () => hide($('inventoryPanel')));

// ─── Glossary Panel ───────────────────────────────────────────────
$('glossaryBtn')?.addEventListener('click', () => {
  renderGlossaryPanel('');
  show($('glossaryPanel'));
});
$('glossaryClose')?.addEventListener('click', () => hide($('glossaryPanel')));
$('glossarySearch')?.addEventListener('input', (e) => renderGlossaryPanel(e.target.value));

function renderGlossaryPanel(filter) {
  const body = $('glossaryBody');
  const terms = Object.entries(G.glossary)
    .filter(([k, v]) => !filter || k.toLowerCase().includes(filter.toLowerCase()) || v.definition.toLowerCase().includes(filter.toLowerCase()));

  if (terms.length === 0) {
    body.innerHTML = '<p style="opacity:0.5">No terms found.</p>';
    return;
  }

  body.innerHTML = terms.map(([k, v]) => `
    <div class="glossary-item">
      <div class="glossary-term">${v.image || '📖'} ${k}</div>
      <div class="glossary-def">${v.definition}</div>
      ${v.link ? `<a class="glossary-link" href="${v.link}" target="_blank">🔗 External resource</a>` : ''}
    </div>
  `).join('');
}

// ─── Map Button ────────────────────────────────────────────────────
$('mapBtn')?.addEventListener('click', () => {
  toast(`Current location: ${G.chapter?.region || 'Unknown'} — ${G.scene?.title || ''}`, 'info');
});

// ─── Progress Save/Load ────────────────────────────────────────────
function saveProgress() {
  const data = { chapterId, stats: G.stats, sceneHistory: G.sceneHistory, playerName: G.player.name };
  localStorage.setItem('chronoquest_progress', JSON.stringify(data));
  fetch('/api/progress/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(() => {});
}

// ─── Init ──────────────────────────────────────────────────────────
loadChapter(chapterId);
