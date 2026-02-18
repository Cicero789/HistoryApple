/* ============================================================
   CHRONOQUEST — ADMIN PAGE JS
   ============================================================ */

// ─── Tab System ────────────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const tab = document.getElementById(`tab-${id}`);
  if (tab) tab.classList.add('active');
  const link = document.querySelector(`[data-tab="${id}"]`);
  if (link) link.classList.add('active');
}

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab(link.dataset.tab);
  });
});

// ─── Load Overview Stats ────────────────────────────────────────
async function loadOverviewStats() {
  try {
    const [chapRes, glRes] = await Promise.all([
      fetch('/api/chapters'),
      fetch('/api/glossary')
    ]);
    const chapters = await chapRes.json();
    const glossary = await glRes.json();
    const regions = [...new Set(chapters.map(c => c.region))];

    document.getElementById('totalChapters').textContent = chapters.length;
    document.getElementById('totalRegions').textContent = regions.length;
    document.getElementById('totalTerms').textContent = Object.keys(glossary.terms || {}).length;
  } catch (e) {
    console.error('Could not load stats:', e);
  }
}

// ─── Load Chapters Admin List ───────────────────────────────────
async function loadChaptersAdmin() {
  const list = document.getElementById('chaptersAdminList');
  try {
    const res = await fetch('/api/chapters');
    const chapters = await res.json();
    list.innerHTML = chapters.map(ch => `
      <div class="chapter-admin-item">
        <span class="chapter-admin-thumb">${ch.thumbnail || '📜'}</span>
        <div class="chapter-admin-info">
          <div class="chapter-admin-title">${ch.title}</div>
          <div class="chapter-admin-meta">${ch.era} · ${ch.difficulty} · ${ch.region}</div>
        </div>
        <div class="chapter-admin-actions">
          <button class="btn-sm btn-sm-play" onclick="window.open('/game.html?chapter=${ch.id}', '_blank')">▶ Preview</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p style="opacity:0.5">Could not load chapters.</p>';
  }
}

// ─── Load Glossary Admin ────────────────────────────────────────
async function loadGlossaryAdmin() {
  const list = document.getElementById('adminGlossaryList');
  try {
    const res = await fetch('/api/glossary');
    const data = await res.json();
    const terms = Object.entries(data.terms || {});

    list.innerHTML = terms.map(([key, val]) => `
      <div class="glossary-admin-item">
        <span class="glossary-admin-icon">${val.image || '📖'}</span>
        <div class="glossary-admin-content">
          <div class="glossary-admin-term">${key}</div>
          <div class="glossary-admin-def">${val.definition}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p style="opacity:0.5">Could not load glossary.</p>';
  }
}

// ─── Analyze Textbook ───────────────────────────────────────────
document.getElementById('analyzeTextBtn')?.addEventListener('click', () => {
  const text = document.getElementById('chTextbook').value;
  if (!text || text.length < 50) {
    alert('Please enter more textbook content to analyze.');
    return;
  }

  // Simple client-side NLP extraction
  const terms = extractKeyTerms(text);
  const events = extractEvents(text);
  const places = extractPlaces(text);

  const result = document.getElementById('analysisResult');
  result.style.display = 'block';
  result.innerHTML = `
    <h4>✅ Analysis Complete</h4>
    <p style="font-size:0.85rem;opacity:0.7;margin-bottom:12px">Found ${terms.length} key terms, ${events.length} events, ${places.length} geographic references.</p>
    <div style="margin-bottom:12px">
      <strong style="color:var(--gold);font-size:0.8rem;letter-spacing:1px">KEY TERMS:</strong>
      <div class="term-chips" style="margin-top:8px">${terms.map(t => `<span class="term-chip">${t}</span>`).join('')}</div>
    </div>
    ${events.length ? `<div style="margin-bottom:12px">
      <strong style="color:var(--gold);font-size:0.8rem;letter-spacing:1px">EVENTS/DATES:</strong>
      <div class="term-chips" style="margin-top:8px">${events.map(e => `<span class="term-chip" style="border-color:rgba(100,200,255,0.3);color:#93c5fd">${e}</span>`).join('')}</div>
    </div>` : ''}
    ${places.length ? `<div>
      <strong style="color:var(--gold);font-size:0.8rem;letter-spacing:1px">GEOGRAPHIC PLACES:</strong>
      <div class="term-chips" style="margin-top:8px">${places.map(p => `<span class="term-chip" style="border-color:rgba(100,255,100,0.3);color:#86efac">${p}</span>`).join('')}</div>
    </div>` : ''}
    <p style="font-size:0.8rem;opacity:0.5;margin-top:12px">These elements will become game scenarios, educational pop-ups, and quiz questions.</p>
  `;
});

function extractKeyTerms(text) {
  // Extract capitalized words and known historical pattern words
  const words = text.match(/\b[A-Z][a-z]{3,}\b/g) || [];
  const commonWords = new Set(['The', 'This', 'That', 'They', 'When', 'What', 'Where', 'Which', 'With', 'From', 'Into', 'Their', 'After', 'Before', 'During', 'Many', 'Some', 'Most', 'Such', 'Each', 'Also', 'Then', 'Thus', 'While', 'However', 'Although', 'Because', 'Therefore', 'Between', 'Through', 'Against', 'About', 'Under', 'Over', 'These', 'Those', 'There', 'Here']);
  const unique = [...new Set(words.filter(w => !commonWords.has(w)))];
  return unique.slice(0, 15);
}

function extractEvents(text) {
  const datePattern = /\b(\d{3,4}s?|[12]\d{3}\s*(?:BCE|CE|AD|BC)?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/g;
  const matches = text.match(datePattern) || [];
  return [...new Set(matches)].slice(0, 8);
}

function extractPlaces(text) {
  // Common geographic/place indicators
  const geoWords = text.match(/\b(?:River|Mountain|Valley|Island|Coast|Bay|Sea|Ocean|Lake|Plain|Desert|Forest|City|Empire|Kingdom|Province|Region|Territory)\b/gi) || [];
  return [...new Set(geoWords)].slice(0, 8);
}

// ─── Add Scene ──────────────────────────────────────────────────
let sceneCount = 1;

document.getElementById('addSceneBtn')?.addEventListener('click', () => {
  const container = document.getElementById('scenesContainer');
  const idx = sceneCount++;
  const div = document.createElement('div');
  div.className = 'scene-entry';
  div.dataset.scene = idx;
  div.innerHTML = `
    <div class="scene-entry-header">
      <span class="scene-entry-num">Scene ${idx + 1}</span>
      <button class="remove-scene" onclick="removeScene(${idx})">Remove</button>
    </div>
    <input type="text" class="form-input" placeholder="Scene title..." name="sceneTitle" />
    <textarea class="form-input" rows="3" placeholder="Describe the historical moment and context..." name="sceneContext"></textarea>
    <div class="scene-choices-label">Decision Point — 3 choices:</div>
    <div class="scene-choices">
      <input type="text" class="form-input choice-input" placeholder="Choice A: ..." />
      <input type="text" class="form-input choice-input" placeholder="Choice B: ..." />
      <input type="text" class="form-input choice-input" placeholder="Choice C: ..." />
    </div>
    <input type="text" class="form-input" placeholder="Key historical term to teach in this scene..." name="sceneTerm" />
  `;
  container.appendChild(div);
});

function removeScene(idx) {
  const el = document.querySelector(`[data-scene="${idx}"]`);
  if (el) el.remove();
}

// ─── Add Job ────────────────────────────────────────────────────
document.getElementById('addJobBtn')?.addEventListener('click', () => {
  const container = document.getElementById('jobsContainer');
  const div = document.createElement('div');
  div.className = 'job-entry';
  div.innerHTML = `
    <div class="form-grid">
      <input type="text" class="form-input" name="jobTitle" placeholder="Job title" />
      <input type="number" class="form-input" name="jobPay" placeholder="Pay" value="6" />
    </div>
    <input type="text" class="form-input" name="jobDesc" placeholder="Brief job description..." />
    <input type="text" class="form-input" name="jobNote" placeholder="Historical context note..." />
  `;
  container.appendChild(div);
});

// ─── Save Chapter ────────────────────────────────────────────────
document.getElementById('saveChapterBtn')?.addEventListener('click', async () => {
  const title = document.getElementById('chTitle').value.trim();
  const era = document.getElementById('chEra').value.trim();
  const region = document.getElementById('chRegion').value.trim();

  if (!title || !era || !region) {
    alert('Please fill in Title, Era, and Region at minimum.');
    return;
  }

  // Build scenes from form
  const sceneEntries = document.querySelectorAll('.scene-entry');
  const scenes = [
    {
      id: 'intro',
      type: 'narrative',
      background: 'market-street',
      title: 'Your Journey Begins',
      text: document.getElementById('chTextbook').value.substring(0, 600) || 'Your adventure begins...',
      next: 'scene_0'
    }
  ];

  sceneEntries.forEach((entry, i) => {
    const titleEl = entry.querySelector('[name="sceneTitle"]');
    const contextEl = entry.querySelector('[name="sceneContext"]');
    const choiceEls = entry.querySelectorAll('.choice-input');
    const termEl = entry.querySelector('[name="sceneTerm"]');

    const sceneId = `scene_${i}`;
    const nextId = i < sceneEntries.length - 1 ? `scene_${i + 1}` : 'chapter_end';

    const choices = Array.from(choiceEls)
      .map((c, ci) => ({
        text: c.value || `Option ${ci + 1}`,
        outcome: `${sceneId}_outcome_${ci}`,
        statChange: {}
      }))
      .filter(c => c.text && c.text !== `Option ${choices?.length || 0}`);

    // Add outcomes
    choices.forEach((c, ci) => {
      scenes.push({
        id: c.outcome,
        type: 'narrative',
        title: `You chose: ${c.text}`,
        text: 'Your choice echoes through history...',
        next: nextId
      });
    });

    scenes.push({
      id: sceneId,
      type: choices.length > 0 ? 'choice' : 'narrative',
      title: titleEl?.value || `Scene ${i + 1}`,
      text: contextEl?.value || '',
      educationalTerm: termEl?.value || undefined,
      choices: choices.length > 0 ? choices : undefined,
      next: choices.length > 0 ? undefined : nextId
    });
  });

  // Add jobs
  const jobEntries = document.querySelectorAll('.job-entry');
  const jobs = Array.from(jobEntries).map(entry => ({
    id: entry.querySelector('[name="jobTitle"]')?.value.toLowerCase().replace(/\s+/g, '_') || 'job',
    title: entry.querySelector('[name="jobTitle"]')?.value || 'Work',
    description: entry.querySelector('[name="jobDesc"]')?.value || '',
    pay: parseInt(entry.querySelector('[name="jobPay"]')?.value) || 6,
    time: 'half day',
    difficulty: 'medium',
    historicalNote: entry.querySelector('[name="jobNote"]')?.value || ''
  }));

  // Chapter end
  scenes.push({
    id: 'chapter_end',
    type: 'summary',
    background: 'sunset-plains',
    title: `Chapter Complete: ${title}`,
    summary: `You have completed your journey through ${era}.`,
    lessons: ['History is made of decisions — each choice has consequences.'],
    quiz: []
  });

  const chapter = {
    id: Date.now(),
    title,
    era,
    region,
    difficulty: document.getElementById('chDifficulty').value,
    thumbnail: document.getElementById('chIcon').value || '📜',
    description: document.getElementById('chDesc').value || `Explore ${era}`,
    theme: document.getElementById('chTheme').value,
    ambience: region.toLowerCase(),
    startingStats: {
      health: 100,
      money: parseInt(document.getElementById('chStartMoney').value) || 15,
      currency: document.getElementById('chCurrency').value || 'coins',
      inventory: ['travel pack']
    },
    characters: [
      {
        id: 'traveler',
        name: document.getElementById('char1Name').value || 'Traveller',
        description: document.getElementById('char1Desc').value || 'An outsider observing history.',
        avatar: document.getElementById('char1Avatar').value || '🧳',
        bonus: 'diplomatic'
      },
      {
        id: 'local',
        name: document.getElementById('char2Name').value || 'Local',
        description: document.getElementById('char2Desc').value || 'A local experiencing history firsthand.',
        avatar: document.getElementById('char2Avatar').value || '🌾',
        bonus: 'survival'
      }
    ],
    glossary: [],
    scenes: scenes.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i),
    jobs
  };

  try {
    const res = await fetch('/api/admin/chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter })
    });
    const data = await res.json();
    const status = document.getElementById('saveStatus');
    if (data.success) {
      status.textContent = '✓ Chapter saved successfully!';
      status.className = 'save-status success';
      loadOverviewStats();
      loadChaptersAdmin();
    } else {
      status.textContent = '✗ Error saving chapter';
      status.className = 'save-status error';
    }
  } catch (e) {
    const status = document.getElementById('saveStatus');
    status.textContent = '✗ Server error. Is the server running?';
    status.className = 'save-status error';
  }
});

// ─── Add Glossary Term ──────────────────────────────────────────
document.getElementById('addTermBtn')?.addEventListener('click', async () => {
  const key = document.getElementById('newTermKey').value.trim();
  const def = document.getElementById('newTermDef').value.trim();
  const icon = document.getElementById('newTermIcon').value.trim();
  const link = document.getElementById('newTermLink').value.trim();

  if (!key || !def) { alert('Term and definition required.'); return; }

  // We'd normally send to backend; for now just reload
  alert(`Term "${key}" noted! In a full deployment, this would be saved to the glossary. You can add it directly to src/data/glossary.json.`);
  document.getElementById('newTermKey').value = '';
  document.getElementById('newTermDef').value = '';
});

// ─── Init ──────────────────────────────────────────────────────
loadOverviewStats();
loadChaptersAdmin();
loadGlossaryAdmin();
