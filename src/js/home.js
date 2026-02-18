/* ============================================================
   CHRONOQUEST — HOME PAGE JS
   ============================================================ */

// ─── Particle System ──────────────────────────────────────────
function initParticles() {
  const container = document.getElementById('particles');
  const symbols = ['⚔️', '🏯', '📜', '⛩️', '🦅', '🏛️', '🌿', '🗡️', '🌾', '⭐', '🔱', '🌊'];
  const count = 18;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    p.style.left = `${Math.random() * 100}%`;
    p.style.fontSize = `${Math.random() * 16 + 10}px`;
    p.style.animationDuration = `${Math.random() * 15 + 10}s`;
    p.style.animationDelay = `${Math.random() * 10}s`;
    container.appendChild(p);
  }
}

// ─── Load Chapters ─────────────────────────────────────────────
async function loadChapters() {
  const grid = document.getElementById('chaptersGrid');
  try {
    const res = await fetch('/api/chapters');
    const chapters = await res.json();

    grid.innerHTML = '';
    chapters.forEach((ch, i) => {
      const card = document.createElement('div');
      card.className = 'chapter-card';
      card.style.animationDelay = `${i * 0.1}s`;
      card.innerHTML = `
        <span class="chapter-thumb">${ch.thumbnail || '📜'}</span>
        <div class="chapter-meta">
          <span class="chapter-era-tag">${ch.region}</span>
          <span class="chapter-difficulty">${ch.difficulty}</span>
        </div>
        <h3 class="chapter-title">${ch.title}</h3>
        <p class="chapter-desc">${ch.description}</p>
        <div class="chapter-play-btn">Begin Chapter</div>
      `;
      card.addEventListener('click', () => startChapter(ch.id));
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = '<div class="loading-chapters"><p>Could not load chapters. Make sure the server is running.</p></div>';
    console.error('Failed to load chapters:', err);
  }
}

// ─── Start Chapter ─────────────────────────────────────────────
function startChapter(id) {
  const name = localStorage.getItem('chronoquest_player') || 'Traveller';
  window.location.href = `/game.html?chapter=${id}&player=${encodeURIComponent(name)}`;
}

// ─── Login Modal ───────────────────────────────────────────────
document.getElementById('loginBtn')?.addEventListener('click', () => {
  document.getElementById('loginModal').style.display = 'flex';
  const savedName = localStorage.getItem('chronoquest_player');
  if (savedName) document.getElementById('playerName').value = savedName;
});

document.getElementById('closeLogin')?.addEventListener('click', () => {
  document.getElementById('loginModal').style.display = 'none';
});

document.getElementById('startGameBtn')?.addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim() || 'Traveller';
  localStorage.setItem('chronoquest_player', name);
  document.getElementById('loginModal').style.display = 'none';
  const firstChapter = document.querySelector('.chapter-card');
  if (firstChapter) firstChapter.click();
});

document.getElementById('playerName')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('startGameBtn')?.click();
});

// Close modal on overlay click
document.getElementById('loginModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('loginModal')) {
    document.getElementById('loginModal').style.display = 'none';
  }
});

// ─── Smooth scroll for anchor links ───────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ─── Init ──────────────────────────────────────────────────────
initParticles();
loadChapters();
