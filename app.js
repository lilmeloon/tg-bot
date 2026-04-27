// app.js

const searchInput = document.getElementById('search-input');
document.getElementById('app').addEventListener('touchstart', (e) => {
  if (!e.target.closest('.search-wrap') && !e.target.closest('#sec-all')) {
    if (searchInput) searchInput.blur();
  }
}, { passive: true });

if (searchInput) {
  searchInput.addEventListener('input', () => {
    document.getElementById('clear-btn').classList.toggle('visible', searchInput.value.length > 0);
    clearTimeout(searchTimer);
    const val = searchInput.value.trim();
    if (!val) { showSearchEmpty(); return; }
    if (val.length < 2) return;
    searchTimer = setTimeout(() => doSearch(val), 500);
  });
}

function clearSearch() {
  if (searchInput) searchInput.value = '';
  document.getElementById('clear-btn').classList.remove('visible');
  showSearchEmpty();
}


function showSearchEmpty() {
  historyVisible = false;
  const labelWrap = document.getElementById('search-label-wrap');
  if (labelWrap) labelWrap.style.display = 'none';
  const histBtn = document.getElementById('history-btn');
  if (histBtn) histBtn.style.color = '#555';
  document.getElementById('search-browse').style.display = 'block';
  document.getElementById('search-suggestions').style.display = 'none';
  document.getElementById('track-list').innerHTML = '';
  renderBrowseGrid();
}

// Рендер сетки жанров/настроений на странице поиска
const BROWSE_CATEGORIES = [
  { id: 'rus_rap', name: 'Русский рэп', emoji: '🎤', grad: 'linear-gradient(135deg,#ff5722,#c2185b)' },
  { id: 'chill', name: 'Chill', emoji: '🌙', grad: 'linear-gradient(135deg,#1a237e,#283593)' },
  { id: 'energy', name: 'Энергия', emoji: '⚡', grad: 'linear-gradient(135deg,#ff6f00,#bf360c)' },
  { id: 'romance', name: 'Романтика', emoji: '💕', grad: 'linear-gradient(135deg,#ad1457,#6a1b9a)' },
  { id: 'hip_hop', name: 'Хип-хоп', emoji: '🎧', grad: 'linear-gradient(135deg,#1b5e20,#004d40)' },
  { id: 'pop', name: 'Поп', emoji: '🌸', grad: 'linear-gradient(135deg,#e91e63,#9c27b0)' },
  { id: 'workout', name: 'Тренировка', emoji: '💪', grad: 'linear-gradient(135deg,#d32f2f,#f57c00)' },
  { id: 'focus', name: 'Фокус', emoji: '🧠', grad: 'linear-gradient(135deg,#1565c0,#0277bd)' },
  { id: 'dance', name: 'Танцы', emoji: '💃', grad: 'linear-gradient(135deg,#c2185b,#ad1457)' },
  { id: 'sad', name: 'Грусть', emoji: '🌧️', grad: 'linear-gradient(135deg,#37474f,#263238)' },
  { id: 'phonk', name: 'Фонк', emoji: '🏎️', grad: 'linear-gradient(135deg,#212121,#424242)' },
  { id: 'rock', name: 'Рок', emoji: '🎸', grad: 'linear-gradient(135deg,#5d4037,#3e2723)' },
];

function renderBrowseGrid() {
  const grid = document.getElementById('browse-grid');
  if (!grid) return;
  grid.innerHTML = BROWSE_CATEGORIES.map(c => `
    <div class="browse-card" style="background:${c.grad};" onclick="playMix('${c.id}')">
      <div class="browse-card-title">${c.name}</div>
      <div class="browse-card-deco" style="background:rgba(255,255,255,0.15);">${c.emoji}</div>
    </div>`).join('');
}

function toggleHistoryInSearch() {
  if (historyVisible) {
    showSearchEmpty();
  } else {
    historyVisible = true;
    const labelWrap = document.getElementById('search-label-wrap');
    if (labelWrap) labelWrap.style.display = 'flex';
    const label = document.getElementById('search-label');
    if (label) label.textContent = 'История';
    const histBtn = document.getElementById('history-btn');
    if (histBtn) histBtn.style.color = '#fff';
    renderList('track-list', history.slice(0, 20));
  }
}

function showHistoryInSearch() {
  showSearchEmpty();
}

async function doSearch(query) {
  return doSearchWithArtists(query);
}

// ── RENDER ──
function renderList(containerId, items) {
  const list = document.getElementById(containerId);
  if (!list) return;
  const msgs = { 'track-list': 'Введи название трека<br>или исполнителя', 'liked-tracks-list': 'Нет любимых треков', 'history-list': 'История пуста' };
  if (!items.length) { list.innerHTML = `<div class="empty"><p>${msgs[containerId]}</p></div>`; return; }
  const source = containerId === 'liked-tracks-list' ? 'fav' : containerId === 'history-list' ? 'history' : 'all';
  list.innerHTML = items.map((t, i) => {
    const isFaved = favorites.some(f => f.id === t.id);
    const isNow = currentSource === source && currentIdx === i;
    const coverHtml = t.cover ? `<img src="${t.cover}" loading="lazy">` : `<div class="cover-placeholder"></div>`;
    return `
    <div class="track-item ${isNow ? 'playing' : ''}" onclick="playTrack(${i},'${source}')">
      <div class="cover">${coverHtml}<div class="playing-indicator"><div class="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div></div>
      <div class="track-info"><div class="track-name">${t.name}</div><div class="track-meta" style="${t.artist_id ? 'cursor:pointer;' : ''}" ${t.artist_id ? `onclick="event.stopPropagation();openArtistPage('${t.artist_id}','${escapeAttr(t.artist)}')"` : ''}>${t.artist}${t.album ? ' · ' + t.album : ''}</div></div>
      <div class="track-actions">
        <div class="track-dur">${t.dur || ''}</div>
        ${downloaded.has(t.id) ? '<div class="dl-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' : ''}
        <button class="fav-btn ${isFaved ? 'active' : ''}" onclick="event.stopPropagation();toggleFav('${t.id}','${source}',${i})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════
// ── ОНБОРДИНГ ──
// ════════════════════════════════════════════

// Популярные артисты для сетки онбординга (смесь жанров)
// ════════════════════════════════════════════
// ── ОНБОРДИНГ — выбор артистов с похожими ──
// ════════════════════════════════════════════

// Начальная сетка — популярные артисты разных жанров
// ════════════════════════════════════════════
// ── ОНБОРДИНГ: Динамический (снежный ком) ──
// ════════════════════════════════════════════

// Состояние онбординга
let obPool = [];           // все артисты в пуле [{id, name, cover, genres}]
let obPoolIds = new Set(); // быстрая проверка дублей
let obSelected = new Map(); // id -> {id, name, cover, genres}
let obCardCount = 0;
let obSearchTimer = null;
let obLoadingExpand = new Set(); // защита от двойного expand

async function checkOnboarding() {
  dlog('checkOnboarding start');
  // 1. Локальная проверка
  if (localStorage.getItem('ob_done') || localStorage.getItem('ob_artists_v2')) {
    dlog('  → already done locally');
    return;
  }
  dlog('  → no local data, checking server...');

  // 2. Проверяем сервер если есть Telegram initData
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    try {
      const res = await Promise.race([
        fetch(RAILWAY_URL + '/api/onboarding/check', {
          headers: { 'X-Telegram-Init-Data': initData }
        }),
        new Promise((_, reject) => setTimeout(() => reject(), 2000))
      ]);
      const data = await res.json();
      if (data.completed && data.artist_ids?.length >= 3) {
        // Восстанавливаем профиль локально и не показываем онбординг
        localStorage.setItem('ob_done', '1');
        localStorage.setItem('ob_artists_v2', JSON.stringify(data.artist_ids));
        localStorage.setItem('ob_artist_ids', JSON.stringify(
          Object.fromEntries(data.artist_ids.map((id, i) => [`a${i}`, id]))
        ));
        return;
      }
    } catch(e) {}
  }

  // 3. Показываем онбординг
  const ob = document.getElementById('onboarding');
  ob.classList.add('active');
  ob.classList.remove('hidden');
  loadObSeeds();
}

// Загружаем начальный набор — сначала фолбэк мгновенно, потом обогащаем с бэка
async function loadObSeeds() {
  dlog('loadObSeeds start');
  const grid = document.getElementById('ob-grid');
  if (!grid) { dlog('  ❌ ob-grid not found!'); return; }
  dlog('  ✓ ob-grid found');

  // 1. Сразу показываем фолбэк (не ждём сеть)
  await loadObFallback();
  dlog('  ✓ fallback rendered, pool size:', obPool.length);

  // 2. Пробуем обогатить с Railway (в фоне)
  try {
    const res = await Promise.race([
      fetch(RAILWAY_URL + '/api/onboarding/seeds'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
    const data = await res.json();
    const artists = data.artists || [];
    if (!artists.length) return;

    // Обновляем пул новыми данными (сохраняем уже выбранных)
    const newPool = artists.filter(a => a.cover); // только с фото
    if (!newPool.length) return;

    // Добавляем новых в пул не дублируя
    newPool.forEach(a => {
      if (!obPoolIds.has(a.id)) { obPoolIds.add(a.id); obPool.push(a); }
      else {
        // Обновляем фото у существующих
        const idx = obPool.findIndex(p => p.id === a.id);
        if (idx >= 0 && a.cover) obPool[idx].cover = a.cover;
      }
    });
    renderObGrid();
  } catch(e) {
    // Railway недоступен — фолбэк уже показан, всё ок
    console.warn('Railway seeds unavailable, using fallback');
  }
}

// Фолбэк с мгновенным отображением + загрузкой фото
async function loadObFallback() {
  const FALLBACK = [
    {id:'3TVXtAsR1Inumwj472S9r4', name:'Drake'},
    {id:'1Xyo4u8uXC1ZmMpatF05PJ', name:'The Weeknd'},
    {id:'2YZyLoL8N0Wb9xBt1NhZWg', name:'Kendrick Lamar'},
    {id:'06HL4z0CvFAxyc27GXpf02', name:'Taylor Swift'},
    {id:'246dkjvS1zLTtiykXe5h60', name:'Post Malone'},
    {id:'6qqNVTkY8uBg9cP3Jd7DAH', name:'Billie Eilish'},
    {id:'0Y5tJX1MQlPlqiwlOH1tJY', name:'Travis Scott'},
    {id:'4q3ewBCX7sLwd24euuV69X', name:'Bad Bunny'},
    {id:'5LHRHt1k9lMyONurDHEdrp', name:'Eminem'},
    {id:'0C8ZW7ezQVs4URX5aX7Kqx', name:'Coldplay'},
    {id:'2A7Ch1dIhGMz3EWyxbNWBo', name:'Скриптонит'},
    {id:'4lGnEkKKONfFpJfcJDWV3w', name:'Oxxxymiron'},
    {id:'0HiLKNOkpGYkH6Mwe9YZEM', name:'PHARAOH'},
    {id:'1SqNqMmwGJXr9EkAHjifqD', name:'MORGENSHTERN'},
    {id:'3JRMkSBcnAXlmGMBnYsV3c', name:'Miyagi'},
    {id:'53XhwfbYqKCa1cC15pYq2q', name:'Imagine Dragons'},
    {id:'7n2Ycct7Beij7Dj7meI4X0', name:'Rammstein'},
    {id:'1vCWHaC5f2uS3yhpwWbIA6', name:'Avicii'},
    {id:'4MCBfE4596Uoi2O4DtmEMz', name:'Juice WRLD'},
    {id:'699OTQXzgjhIYAHMy9RyPD', name:'Playboi Carti'},
  ].map(a => ({...a, cover: null}));

  obPool = FALLBACK;
  obPoolIds = new Set(FALLBACK.map(a => a.id));
  renderObGrid(); // Показываем сразу с иконками-заглушками

  // Загружаем фото параллельно через Vercel /api/search
  await loadObPhotos(FALLBACK);
}

// Рендер сетки из пула
function renderObGrid() {
  const grid = document.getElementById('ob-grid');
  if (!grid) return;
  // Показываем весь пул
  grid.innerHTML = obPool.map((a, i) => makeObCard(a, i)).join('');
  // Восстанавливаем состояние выбранных
  obSelected.forEach((_, id) => {
    const card = document.querySelector(`[data-ob-id="${id}"]`);
    if (card) card.classList.add('selected');
  });
}

function makeObCard(a, idx) {
  const isSelected = obSelected.has(a.id);
  return `<div class="ob-artist-card ${isSelected ? 'selected' : ''}"
    data-ob-id="${a.id}"
    onclick="toggleObArtist('${a.id}')">
    <div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;" id="ob-img-${a.id}">
      ${a.cover
        ? `<img class="ob-card-img" src="${a.cover}" loading="lazy" onerror="this.style.display='none'">`
        : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`}
    </div>
    <div class="ob-card-grad"><div class="ob-card-name">${a.name}</div></div>
    <div class="ob-card-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
  </div>`;
}

// Загружаем фото через Spotify (Vercel /api/search)
async function loadObPhotos(artists) {
  const batches = [];
  for (let i = 0; i < artists.length; i += 6) batches.push(artists.slice(i, i+6));

  for (const batch of batches) {
    await Promise.all(batch.map(async a => {
      try {
        const r = await fetch(`/api/search?action=search&q=${encodeURIComponent(a.name)}&limit=3`);
        const d = await r.json();
        // Ищем точное совпадение по ID
        const found = d.artists?.find(ar => ar.id === a.id) || d.artists?.[0];
        if (found?.cover) {
          const idx = obPool.findIndex(p => p.id === a.id);
          if (idx >= 0) {
            obPool[idx].cover = found.cover;
            // Обновляем карточку без перерендера всей сетки
            const imgEl = document.getElementById('ob-img-' + a.id);
            if (imgEl) {
              imgEl.innerHTML = `<img class="ob-card-img" src="${found.cover}" loading="lazy" onerror="this.style.display='none'">`;
            }
          }
        }
      } catch(e) {}
    }));
  }
}

// Выбор/снятие артиста
async function toggleObArtist(id) {
  dlog('toggleObArtist:', id);
  const artist = obPool.find(a => a.id === id);
  if (!artist) { dlog('  ❌ artist not in pool'); return; }

  const card = document.querySelector(`[data-ob-id="${id}"]`);

  if (obSelected.has(id)) {
    // Снимаем выбор
    obSelected.delete(id);
    if (card) card.classList.remove('selected');
  } else {
    // Выбираем
    obSelected.set(id, artist);
    if (card) card.classList.add('selected');

    // Снежный ком: подгружаем похожих
    if (!obLoadingExpand.has(id)) {
      obLoadingExpand.add(id);
      expandObPool(id);
    }
  }
  updateObBtn();
}

// Расширяем пул похожими артистами
async function expandObPool(artistId) {
  dlog('expandObPool:', artistId);
  try {
    let newArtists = [];

    // 1. Пробуем Vercel /api/search?action=expand_artist (надёжно)
    try {
      const r = await fetch(`/api/search?action=expand_artist&artist_id=${artistId}`);
      const d = await r.json();
      newArtists = (d.artists || []).filter(a => !obPoolIds.has(a.id));
      dlog('  Vercel expand →', d.artists?.length || 0, 'artists,', newArtists.length, 'new');
    } catch(e) {
      dlog('  Vercel expand FAILED:', e.message);
    }

    // 2. Фолбэк через Railway если Vercel ничего не дал
    if (!newArtists.length) {
      try {
        const res = await Promise.race([
          fetch(RAILWAY_URL + `/api/onboarding/expand?artist_id=${artistId}`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        const data = await res.json();
        newArtists = (data.artists || []).filter(a => !obPoolIds.has(a.id));
      } catch(e) {}
    }

    if (!newArtists.length) {
      console.warn('[expand] No new artists for', artistId);
      return;
    }

    console.log('[expand] Got', newArtists.length, 'new artists');

    newArtists.forEach(a => { obPoolIds.add(a.id); });
    obPool.splice(0, 0, ...newArtists);
    renderObGridAnimated(newArtists.map(a => a.id));

    const noPhoto = newArtists.filter(a => !a.cover);
    if (noPhoto.length) loadObPhotos(noPhoto);
  } catch(e) {
    console.warn('expand failed:', e);
  }
}

// Рендер с анимацией новых карточек
function renderObGridAnimated(newIds) {
  const grid = document.getElementById('ob-grid');
  if (!grid) return;

  // Добавляем новые карточки в начало
  const newHtml = obPool.slice(0, newIds.length).map((a, i) => makeObCard(a, i)).join('');
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;

  // Анимируем появление
  [...temp.children].forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'scale(0.8)';
    grid.insertBefore(card, grid.firstChild);
    requestAnimationFrame(() => {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';
    });
  });
}

// Поиск артиста в онбординге
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('ob-search-input');
  if (!inp) return;

  inp.addEventListener('input', () => {
    clearTimeout(obSearchTimer);
    const q = inp.value.trim();
    if (!q) { document.getElementById('ob-search-results').style.display = 'none'; return; }
    obSearchTimer = setTimeout(() => searchObArtists(q), 400);
  });

  inp.addEventListener('blur', () => {
    setTimeout(() => {
      const results = document.getElementById('ob-search-results');
      if (results) results.style.display = 'none';
    }, 400);
  });

  inp.addEventListener('focus', () => {
    setTimeout(() => inp.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  });
});

async function searchObArtists(q) {
  const results = document.getElementById('ob-search-results');
  if (!results) return;
  try {
    const r = await fetch(`/api/search?action=search&q=${encodeURIComponent(q)}&limit=5`);
    const d = await r.json();
    const artists = d.artists || [];
    if (!artists.length) {
      results.style.display = 'block';
      results.innerHTML = '<div style="color:#555;font-size:13px;padding:12px;">Не найдено</div>';
      return;
    }
    results.style.display = 'block';
    results.innerHTML = artists.map(a => {
      const safeId = a.id;
      const safeName = (a.name || '').replace(/'/g, "\'");
      const safeCover = (a.cover || '').replace(/'/g, "\'");
      return `<div class="ob-search-result-item"
        onclick="addObArtistFromSearch('${safeId}','${safeName}','${safeCover}')">
        <div class="ob-search-avatar">
          ${a.cover ? `<img src="${a.cover}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : ''}
        </div>
        <div>
          <div style="font-size:14px;font-weight:600;color:#fff;">${a.name}</div>
          <div style="font-size:11px;color:#555;">${(a.genres || []).slice(0,2).join(', ') || 'Артист'}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {}
}

function addObArtistFromSearch(id, name, cover) {
  // Скрываем результаты
  document.getElementById('ob-search-results').style.display = 'none';
  document.getElementById('ob-search-input').value = '';

  // Если уже в пуле — просто выбираем
  if (obPoolIds.has(id)) {
    const card = document.querySelector(`[data-ob-id="${id}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (!obSelected.has(id)) toggleObArtist(id);
    return;
  }

  // Добавляем в начало пула
  const artist = { id, name, cover };
  obPool.unshift(artist);
  obPoolIds.add(id);

  // Вставляем карточку в начало грида
  const grid = document.getElementById('ob-grid');
  const card = document.createElement('div');
  card.innerHTML = makeObCard(artist, 0);
  const newCard = card.firstElementChild;
  newCard.style.opacity = '0';
  newCard.style.transform = 'scale(0.8)';
  grid.insertBefore(newCard, grid.firstChild);
  requestAnimationFrame(() => {
    newCard.style.transition = 'opacity 0.3s, transform 0.3s';
    newCard.style.opacity = '1';
    newCard.style.transform = 'scale(1)';
  });

  // Выбираем
  obSelected.set(id, artist);
  newCard.classList.add('selected');
  expandObPool(id);
  updateObBtn();
}

function updateObBtn() {
  const btn = document.getElementById('ob-btn');
  const cnt = document.getElementById('ob-selected-count');
  const count = obSelected.size;
  const ready = count >= 3;
  if (btn) {
    btn.style.opacity = ready ? '1' : '0.4';
    btn.style.pointerEvents = ready ? 'all' : 'none';
  }
  if (cnt) {
    cnt.textContent = ready
      ? `Выбрано: ${count} · Можно продолжить`
      : `Выбери ещё ${3 - count}`;
  }
}

async function finishOnboarding() {
  if (obSelected.size < 3) return;

  const artistIds = [...obSelected.keys()];
  const artistNames = [...obSelected.values()].map(a => a.name);

  // Сохраняем локально (для рекомендаций)
  localStorage.setItem('ob_done', '1');
  localStorage.setItem('ob_artist_ids', JSON.stringify(
    Object.fromEntries([...obSelected.entries()].map(([id, a]) => [a.name, id]))
  ));
  localStorage.setItem('ob_artists_v2', JSON.stringify(artistIds)); // чистый массив IDs

  // Сохраняем профиль на бэке (с Telegram auth)
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    try {
      fetch(RAILWAY_URL + '/api/onboarding/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({ artist_ids: artistIds }),
      }).catch(() => {});
    } catch(e) {}
  }

  const _ob = document.getElementById('onboarding'); _ob.classList.add('hidden'); _ob.classList.remove('active');
  showToast('🎵 Подбираю музыку для тебя...');
  ['ai','related','albums','new_releases'].forEach(k => localStorage.removeItem('recs_cache_' + k));
  setTimeout(() => { loadNewReleases(true); loadRelated(true); loadAiRecs(true); loadRecAlbums(true); }, 300);
}

// ── СБРОС ДАННЫХ ──
function openResetModal() {
  document.getElementById('reset-modal').classList.add('open');
}
function closeResetModal() {
  document.getElementById('reset-modal').classList.remove('open');
}
async function resetAllData() {
  // Стираем серверный профиль чтобы онбординг показался заново
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) {
    try {
      await fetch(RAILWAY_URL + '/api/onboarding/reset', {
        method: 'POST',
        headers: { 'X-Telegram-Init-Data': initData },
      });
    } catch(e) {}
  }
  localStorage.clear();
  if (window.audio) { audio.pause(); audio.src = ''; }
  showToast('Данные сброшены');
  setTimeout(() => location.reload(), 800);
}

// ── TABS ──
function switchFavTab(tab, el) {
  const offlineContent = document.getElementById('offline-content');
  if (tab === 'offline') {
    if (offlineContent) offlineContent.style.display = 'block';
    renderOffline();
  } else {
    if (offlineContent) offlineContent.style.display = 'none';
    renderLibrary();
  }
}

function renderLibrary() {
  const cnt = favorites.length;
  const label = cnt === 1 ? 'трек' : cnt < 5 ? 'трека' : 'треков';
  const el1 = document.getElementById('liked-count');
  const el2 = document.getElementById('liked-count-2');
  if (el1) el1.textContent = cnt + ' ' + label;
  if (el2) el2.textContent = cnt + ' ' + label;
  const grid = document.getElementById('fav-playlists-list');
  if (!grid) return;
  if (!playlists.length) {
    grid.innerHTML = '<div style="color:#555;font-size:13px;padding:8px 0 20px;">Нет плейлистов — создай первый!</div>';
    return;
  }
  grid.innerHTML = playlists.map((p, i) => `
    <div onclick="openPlaylist(${i})" style="display:flex;align-items:center;gap:12px;padding:10px 0;cursor:pointer;">
      <div style="width:52px;height:52px;background:var(--bg3);border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
        <div style="font-size:12px;color:#555;margin-top:2px;">Плейлист · ${p.tracks.length} тр.</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`).join('');
}

function openLikedTracks() {
  const page = document.getElementById('liked-tracks-page');
  if (!page) return;
  page.style.transform = 'translateX(0)';
  const cnt = favorites.length;
  const label = cnt === 1 ? 'трек' : cnt < 5 ? 'трека' : 'треков';
  const el = document.getElementById('liked-count-2');
  if (el) el.textContent = cnt + ' ' + label;
  renderList('liked-tracks-list', favorites);
}

function closeLikedTracks() {
  const page = document.getElementById('liked-tracks-page');
  if (page) page.style.transform = 'translateX(100%)';
}

function playAllFavorites() {
  if (!favorites.length) return;
  tracks = [...favorites];
  currentSource = 'fav';
  playTrack(0, 'fav');
  closeLikedTracks();
}

function switchFavSub(sub) {
  document.getElementById('fav-sub-fav').style.display = sub === 'fav' ? 'block' : 'none';
  document.getElementById('fav-sub-offline').style.display = sub === 'offline' ? 'block' : 'none';
  document.getElementById('fav-tab-fav').style.color = sub === 'fav' ? '#000' : '#888';
  document.getElementById('fav-tab-offline').style.color = sub === 'offline' ? '#000' : '#888';
  if (sub === 'fav') renderList('fav-list', favorites);
  if (sub === 'offline') renderOffline();
}

function switchTab(tab, tabEl, navEl) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + tab).classList.add('active');
  if (tabEl) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); tabEl.classList.add('active'); }
  if (navEl) { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); navEl.classList.add('active'); }
  if (tab === 'fav') { renderLibrary(); }
  if (tab === 'all') {
    const inp = document.getElementById('search-input');
    if (!inp || !inp.value.trim()) showSearchEmpty();
  }
  if (tab === 'home') {
    renderPlaylists();
    renderMixes();
    loadNewReleases();
    loadRelated();
    loadAiRecs();
    loadRecAlbums();
  }
  if (tab === 'social') { loadSocialFriends(); }
}

function renderAll() {
  renderList('track-list', tracks);
  if (document.getElementById('liked-tracks-page')?.style.transform === 'translateX(0)') {
    renderList('liked-tracks-list', favorites);
  }
  const cnt = favorites.length;
  const label = cnt === 1 ? 'трек' : cnt < 5 ? 'трека' : 'треков';
  const el1 = document.getElementById('liked-count');
  const el2 = document.getElementById('liked-count-2');
  if (el1) el1.textContent = cnt + ' ' + label;
  if (el2) el2.textContent = cnt + ' ' + label;
  renderList('history-list', history);
  renderOffline();
}

// ── TOAST ──
let toastTimer;
function showToast(msg) {
  if (!msg) return;
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Поиск — отображаем артистов вверху ──
async function doSearchWithArtists(query) {
  const list = document.getElementById('track-list');
  const label = document.getElementById('search-label');
  const browse = document.getElementById('search-browse');
  const sugg = document.getElementById('search-suggestions');
  if (browse) browse.style.display = 'none';
  if (sugg) sugg.style.display = 'none';
  if (label) label.textContent = 'Результаты';
  list.innerHTML = '<div class="empty"><p>Ищу...</p></div>';
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    let html = '';

    // Блок артистов
    if (data.artists?.length) {
      html += `<div class="section-label" style="margin-top:8px;margin-bottom:8px;">Исполнители</div>
        <div class="h-scroll" style="margin-bottom:16px;">
          ${data.artists.map(a => `
            <div class="h-card" onclick="openArtistPage('${a.id}','${escapeAttr(a.name)}')">
              <div class="h-card-cover" style="${a.cover ? '' : 'background:#111;'}">
                ${a.cover ? `<img src="${a.cover}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">` : ''}
              </div>
              <div class="h-card-name">${a.name}</div>
              <div class="h-card-artist">${a.genres?.[0] || ''}</div>
            </div>`).join('')}
        </div>
        <div class="section-label" style="margin-bottom:8px;">Треки</div>`;
    }

    if (!data.tracks?.length && !data.artists?.length) {
      list.innerHTML = '<div class="empty"><p>Ничего не найдено</p></div>';
      return;
    }

    tracks = data.tracks || [];
    html += tracks.map((t, i) => {
      const isFaved = favorites.some(f => f.id === t.id);
      const coverHtml = t.cover ? `<img src="${t.cover}" loading="lazy">` : '<div class="cover-placeholder"></div>';
      const artistClick = t.artist_id ? `onclick="event.stopPropagation();openArtistPage('${t.artist_id}','${escapeAttr(t.artist)}')"` : '';
      return `
      <div class="track-item" onclick="playTrack(${i},'all')">
        <div class="cover">${coverHtml}<div class="playing-indicator"><div class="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div></div>
        <div class="track-info">
          <div class="track-name">${t.name}</div>
          <div class="track-meta" style="${t.artist_id ? 'cursor:pointer;' : ''}" ${artistClick}>${t.artist}${t.album ? ' · ' + t.album : ''}</div>
        </div>
        <div class="track-actions">
          <div class="track-dur">${t.dur || ''}</div>
          <button class="fav-btn ${isFaved ? 'active' : ''}" onclick="event.stopPropagation();toggleFav('${t.id}','all',${i})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = `<div class="empty"><p>Ошибка: ${e.message}</p></div>`;
  }
}


// ── FIX: скрываем мини-плеер и nav когда открыта клавиатура (iOS/Telegram) ──
(function fixPlayerKeyboard() {
  const player = document.getElementById('player');
  const nav = document.querySelector('.nav');
  const content = document.querySelector('.content');
  if (!player) return;

  let isKbOpen = false;

  function hidePlayerNav() {
    if (isKbOpen) return;
    isKbOpen = true;
    player.style.setProperty('display', 'none', 'important');
    if (nav) nav.style.setProperty('transform', 'translateY(100%)', 'important');
    if (content) content.style.paddingBottom = '8px';
  }

  function showPlayerNav() {
    if (!isKbOpen) return;
    isKbOpen = false;
    if (player.classList.contains('visible')) player.style.removeProperty('display');
    if (nav) nav.style.removeProperty('transform');
    if (content) content.style.paddingBottom = '';
  }

  document.addEventListener('focusin', (e) => {
    if (e.target.matches('input, textarea')) setTimeout(hidePlayerNav, 100);
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || !active.matches('input, textarea')) showPlayerNav();
    }, 150);
  });

  if (window.visualViewport) {
    let baseH = window.visualViewport.height;
    window.visualViewport.addEventListener('resize', () => {
      const h = window.visualViewport.height;
      if (h < baseH * 0.75) hidePlayerNav();
      else if (h > baseH * 0.85 && isKbOpen) { showPlayerNav(); baseH = h; }
    });
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('SW registered:', reg.scope);
    }).catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ── ИНИЦИАЛИЗАЦИЯ ──
function initApp() {
  loadDownloadsFromServer();
  checkOnboarding();
  setTimeout(() => {
    renderPlaylists();
    renderMixes();
    if (history.length > 0 || getSeedIds().length > 0) {
      loadNewReleases();
      loadRelated();
      loadAiRecs();
      loadRecAlbums();
    }
  }, 300);

  // Telegram аватар
  if (tgUser) {
    const letter = document.getElementById('avatar-letter');
    const img = document.getElementById('avatar-img');
    if (letter) letter.textContent = (tgUser.first_name || 'U')[0].toUpperCase();
    if (tgUser.photo_url && img) {
      img.src = tgUser.photo_url;
      img.style.display = 'block';
      if (letter) letter.style.display = 'none';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
