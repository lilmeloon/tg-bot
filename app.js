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
  document.getElementById('track-list').innerHTML = '<div class="empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>Введи название трека<br>или исполнителя</p></div>';
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
const OB_SEED_ARTISTS = [
  'Drake','The Weeknd','Kendrick Lamar','Taylor Swift','Post Malone',
  'Billie Eilish','Travis Scott','Bad Bunny','Saluki','Скриптонит',
  'MORGENSHTERN','Playboi Carti','SZA','Future','Kanye West',
  'Фараон','Oxxxymiron','Miyagi','Eminem','Coldplay',
  'Lil Baby','Doja Cat','Metro Boomin','Rod Wave','Juice WRLD',
  'Harry Styles','Lil Uzi Vert','Ariana Grande',
];

let obSelectedArtists = new Set(); // Set имён
let obArtistData = {};             // {name: {id, cover, genres}}
let obSearchTimer = null;
let obSuggestionLoading = new Set(); // предотвращаем дубли

function checkOnboarding() {
  const done = localStorage.getItem('ob_done');
  if (!done) {
    document.getElementById('onboarding').classList.remove('hidden');
    loadObGrid();
  } else {
    document.getElementById('onboarding').classList.add('hidden');
  }
}

// ── Рендер сетки ──
async function loadObGrid() {
  const grid = document.getElementById('ob-grid');
  grid.innerHTML = OB_SEED_ARTISTS.map(name => makeObCard(name)).join('');
  // Загружаем фото батчами
  for (let i = 0; i < OB_SEED_ARTISTS.length; i += 8) {
    await Promise.all(OB_SEED_ARTISTS.slice(i, i+8).map(name => loadObPhoto(name)));
  }
}

function makeObCard(name) {
  const esc = CSS.escape(name);
  const safeName = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return `<div class="ob-artist-card" id="ob-card-${esc}" onclick="toggleObArtist('${safeName}')">
    <div style="width:100%;height:100%;background:var(--bg3);display:flex;align-items:center;justify-content:center;">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
    </div>
    <div class="ob-card-grad"><div class="ob-card-name">${name}</div></div>
    <div class="ob-card-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
  </div>`;
}

async function loadObPhoto(name) {
  if (obArtistData[name]) return; // уже загружено
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(name) + '&action=search');
    const data = await res.json();
    const artist = data.artists?.[0];
    if (!artist) return;
    obArtistData[name] = { id: artist.id, cover: artist.cover, genres: artist.genres || [] };
    updateObCardPhoto(name);
  } catch(e) {}
}

function updateObCardPhoto(name) {
  const card = document.getElementById('ob-card-' + CSS.escape(name));
  if (!card) return;
  const d = obArtistData[name];
  if (!d?.cover) return;
  card.innerHTML = `
    <img class="ob-card-img" src="${d.cover}" loading="lazy">
    <div class="ob-card-grad"><div class="ob-card-name">${name}</div></div>
    <div class="ob-card-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
  if (obSelectedArtists.has(name)) card.classList.add('selected');
}

// ── Выбор артиста + подгрузка похожих ──
async function toggleObArtist(name) {
  if (obSelectedArtists.has(name)) {
    obSelectedArtists.delete(name);
    document.getElementById('ob-card-' + CSS.escape(name))?.classList.remove('selected');
    // Убираем строку похожих
    document.getElementById('ob-sugg-' + CSS.escape(name))?.remove();
  } else {
    obSelectedArtists.add(name);
    document.getElementById('ob-card-' + CSS.escape(name))?.classList.add('selected');
    // Подгружаем фото если нет
    if (!obArtistData[name]) await loadObPhoto(name);
    // Показываем похожих артистов под карточкой
    loadObSuggestions(name);
  }
  updateObBtn();
}

async function loadObSuggestions(name) {
  if (obSuggestionLoading.has(name)) return;
  obSuggestionLoading.add(name);

  const artistId = obArtistData[name]?.id;
  if (!artistId) return;

  try {
    // Получаем related artists через API
    const res = await fetch('/api/search?action=artist&artist_id=' + encodeURIComponent(artistId));
    const data = await res.json();

    // Ищем related через поиск (используем топ треки артиста как источник)
    const relRes = await fetch('/api/search?action=related&track=id:' + encodeURIComponent(artistId + '|' + name) + '&limit=8');
    const relData = await relRes.json();

    // Берём уникальных артистов из related треков
    const relArtists = [];
    const seenIds = new Set([artistId]);
    for (const t of (relData.tracks || [])) {
      if (!seenIds.has(t.artist_id) && relArtists.length < 5) {
        seenIds.add(t.artist_id);
        relArtists.push({ id: t.artist_id, name: t.artist, cover: t.cover });
      }
    }

    if (!relArtists.length) return;

    // Сохраняем данные
    relArtists.forEach(a => {
      if (!obArtistData[a.name]) {
        obArtistData[a.name] = { id: a.id, cover: a.cover, genres: [] };
      }
    });

    // Вставляем строку похожих после карточки артиста
    const card = document.getElementById('ob-card-' + CSS.escape(name));
    if (!card) return;

    // Удаляем старую строку если есть
    document.getElementById('ob-sugg-' + CSS.escape(name))?.remove();

    // Создаём строку с чипсами похожих
    const grid = document.getElementById('ob-grid');
    const row = document.createElement('div');
    row.className = 'ob-suggestion-row';
    row.id = 'ob-sugg-' + CSS.escape(name);
    row.style.gridColumn = '1 / -1'; // на всю ширину сетки
    row.innerHTML = relArtists.map(a => {
      const safeName = a.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const isSelected = obSelectedArtists.has(a.name);
      return `<div class="ob-suggestion-chip ${isSelected ? 'selected' : ''}" onclick="addObSuggestion('${a.id}','${safeName}','${(a.cover||'').replace(/'/g,"\\'")}',this)">
        <div class="ob-chip-avatar">${a.cover ? `<img src="${a.cover}" loading="lazy">` : ''}</div>
        <span class="ob-chip-name">${a.name}</span>
        <span class="ob-chip-plus">${isSelected ? '✓' : '+'}</span>
      </div>`;
    }).join('');

    // Вставляем после карточки
    card.after(row);

  } catch(e) {}
  obSuggestionLoading.delete(name);
}

function addObSuggestion(id, name, cover, el) {
  obArtistData[name] = { id, cover, genres: [] };
  if (obSelectedArtists.has(name)) {
    obSelectedArtists.delete(name);
    el.classList.remove('selected');
    el.querySelector('.ob-chip-plus').textContent = '+';
  } else {
    obSelectedArtists.add(name);
    el.classList.add('selected');
    el.querySelector('.ob-chip-plus').textContent = '✓';
    // Добавляем в сетку если нет
    if (!document.getElementById('ob-card-' + CSS.escape(name))) {
      const grid = document.getElementById('ob-grid');
      const div = document.createElement('div');
      div.className = 'ob-artist-card selected';
      div.id = 'ob-card-' + CSS.escape(name);
      const safeName2 = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      div.onclick = () => toggleObArtist(name);
      div.innerHTML = `${cover ? `<img class="ob-card-img" src="${cover}">` : '<div style="width:100%;height:100%;background:var(--bg3)"></div>'}
        <div class="ob-card-grad"><div class="ob-card-name">${name}</div></div>
        <div class="ob-card-check" style="opacity:1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
      grid.prepend(div);
    } else {
      document.getElementById('ob-card-' + CSS.escape(name))?.classList.add('selected');
    }
  }
  updateObBtn();
}

function updateObBtn() {
  const count = obSelectedArtists.size;
  const btn = document.getElementById('ob-btn');
  const countEl = document.getElementById('ob-selected-count');
  btn.classList.toggle('active', count >= 3);
  countEl.textContent = count >= 3
    ? `Выбрано ${count} артист${count < 5 ? 'а' : 'ов'} — готово!`
    : `Ещё ${3 - count} — и можно продолжить`;
}

// ── Поиск в онбординге ──
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('ob-search-input');
  if (!inp) return;

  inp.addEventListener('input', () => {
    clearTimeout(obSearchTimer);
    const q = inp.value.trim();
    if (!q) { document.getElementById('ob-search-results').style.display = 'none'; return; }
    obSearchTimer = setTimeout(() => searchObArtists(q), 400);
  });

  // Увеличенный таймаут — iOS нужно время чтобы зарегистрировать tap до blur
  inp.addEventListener('blur', () => {
    setTimeout(() => {
      const results = document.getElementById('ob-search-results');
      if (results) results.style.display = 'none';
    }, 400);
  });

  // Когда фокус на поиске — скроллим онбординг вверх чтобы результаты были видны
  inp.addEventListener('focus', () => {
    setTimeout(() => {
      inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  });
});

async function searchObArtists(q) {
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&action=search');
    const data = await res.json();
    const results = document.getElementById('ob-search-results');
    const foundArtists = (data.artists || []).slice(0, 6);
    if (!foundArtists.length) { results.style.display = 'none'; return; }
    results.style.display = 'block';
    results.innerHTML = foundArtists.map(a => {
      const safeName = a.name.replace(/'/g,"\'");
      const safeCover = (a.cover||'').replace(/'/g,"\'");
      return `<div class="ob-search-result-item" onclick="addObArtistFromSearch('${a.id}','${safeName}','${safeCover}')">
        <div class="ob-result-cover">${a.cover ? `<img src="${a.cover}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : ''}</div>
        <div><div class="ob-result-name">${a.name}</div><div class="ob-result-genre">${a.genres?.[0]||''}</div></div>
        ${obSelectedArtists.has(a.name) ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </div>`;
    }).join('');
  } catch(e) {}
}

function addObArtistFromSearch(id, name, cover) {
  obArtistData[name] = { id, cover, genres: [] };
  document.getElementById('ob-search-results').style.display = 'none';
  document.getElementById('ob-search-input').value = '';
  if (!document.getElementById('ob-card-' + CSS.escape(name))) {
    const grid = document.getElementById('ob-grid');
    const div = document.createElement('div');
    div.className = 'ob-artist-card';
    div.id = 'ob-card-' + CSS.escape(name);
    div.onclick = () => toggleObArtist(name);
    div.innerHTML = `${cover ? `<img class="ob-card-img" src="${cover}">` : '<div style="width:100%;height:100%;background:var(--bg3)"></div>'}
      <div class="ob-card-grad"><div class="ob-card-name">${name}</div></div>
      <div class="ob-card-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`;
    grid.prepend(div);
  }
  // Эмулируем клик для выбора + загрузки похожих
  if (!obSelectedArtists.has(name)) toggleObArtist(name);
}

async function finishOnboarding() {
  if (obSelectedArtists.size < 3) return;
  const selected = [...obSelectedArtists];
  localStorage.setItem('ob_done', '1');
  localStorage.setItem('ob_artists', JSON.stringify(selected));
  // Сохраняем точные Spotify ID
  const obIds = {};
  selected.forEach(name => {
    if (obArtistData[name]?.id) obIds[name] = obArtistData[name].id;
  });
  localStorage.setItem('ob_artist_ids', JSON.stringify(obIds));
  document.getElementById('onboarding').classList.add('hidden');
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
function resetAllData() {
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

// ── ARTIST PAGE ──
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
