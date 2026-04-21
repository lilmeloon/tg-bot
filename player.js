// player.js


function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

audio.addEventListener('timeupdate', () => {
  const dur = audio.duration;
  const isLive = !dur || !isFinite(dur);
  const pct = isLive ? 0 : (audio.currentTime / dur) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('fs-bar-fill').style.width = pct + '%';
  const cur = fmt(audio.currentTime);
  const durStr = isLive ? '∞' : fmt(dur);
  document.getElementById('time-label').textContent = isLive ? cur : `${cur} / ${durStr}`;
  document.getElementById('fs-cur').textContent = cur;
  document.getElementById('fs-dur').textContent = durStr;
  // Предзагрузка следующего трека когда осталось 20 сек
  if (audio.duration - audio.currentTime < 20) preloadNext();
  // Дозагрузка радио когда очередь заканчивается
  if (currentSource === 'wave' && currentIdx >= waveQueue.length - 5) waveLoadMore();
});

audio.addEventListener('ended', () => {
  if (currentSource === 'wave') {
    // Отмечаем проигранный трек
    const t = waveQueue[currentIdx];
    if (t) wavePlayedIds.add(t.id);
    // Дозагрузка когда осталось мало треков
    if (currentIdx >= waveQueue.length - 5) waveLoadMore();
    // Если есть следующий — играем, иначе ждём загрузки
    if (currentIdx < waveQueue.length - 1) {
      nextTrack();
    } else {
      // Ждём загрузки новых треков
      const waitForMore = setInterval(() => {
        if (waveQueue.length > currentIdx + 1) {
          clearInterval(waitForMore);
          nextTrack();
        }
      }, 500);
      setTimeout(() => clearInterval(waitForMore), 10000); // таймаут 10с
    }
  } else {
    nextTrack();
  }
});
audio.addEventListener('playing', updatePlayBtn);
audio.addEventListener('pause', updatePlayBtn);

function seekAudio(e) {
  if (!audio.duration) return;
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : (e.changedTouches ? e.changedTouches[0].clientX : e.clientX);
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
}

// ── OPFS ──
const OPFS_SUPPORTED = 'storage' in navigator && 'getDirectory' in navigator.storage;
let opfsRoot = null;

async function initOPFS() {
  if (!OPFS_SUPPORTED) return;
  try { opfsRoot = await navigator.storage.getDirectory(); } catch(e) { console.warn('OPFS init failed:', e); }
}
initOPFS();

async function opfsSave(trackId, arrayBuffer) {
  if (!opfsRoot) return false;
  try {
    const file = await opfsRoot.getFileHandle(trackId + '.mp3', { create: true });
    const writable = await file.createWritable();
    await writable.write(arrayBuffer);
    await writable.close();
    return true;
  } catch(e) { console.error('OPFS save error:', e); return false; }
}

async function opfsLoad(trackId) {
  if (!opfsRoot) return null;
  try {
    const file = await opfsRoot.getFileHandle(trackId + '.mp3');
    const f = await file.getFile();
    return URL.createObjectURL(f);
  } catch(e) { return null; }
}

async function opfsDelete(trackId) {
  if (!opfsRoot) return;
  try { await opfsRoot.removeEntry(trackId + '.mp3'); } catch(e) {}
}

async function opfsExists(trackId) {
  if (!opfsRoot) return false;
  try { await opfsRoot.getFileHandle(trackId + '.mp3'); return true; } catch(e) { return false; }
}

// ── PLAY ──
async function playTrack(idx, source = 'all') {
  const list = source === 'fav' ? favorites : source === 'history' ? history : source === 'offline' ? offlineTracks : source === 'wave' ? waveQueue : tracks;
  if (idx < 0 || idx >= list.length) return;
  currentIdx = idx; currentSource = source;
  nextPreloaded = false;
  const t = list[idx];

  // Если следующий трек уже предзагружен — используем его
  const nextList = source === 'fav' ? favorites : source === 'history' ? history : tracks;
  const nextT = nextList[idx + 1];
  let usePreloaded = nextPreloaded && audioNext.src.includes(encodeURIComponent(t.name));

  updateMiniPlayer(t);
  updateFsPlayer(t);
  updatePlayerFavBtn(t.id);
  // Обновляем подсветку трека на странице альбома
  updateAlbumTrackHighlight();

  if (!history.find(h => h.id === t.id)) {
    history.unshift(t);
    if (history.length > 50) history.pop();
    localStorage.setItem('history', JSON.stringify(history));
  }
  // Счётчик артистов
  artistPlayCount[t.artist] = (artistPlayCount[t.artist] || 0) + 1;
  localStorage.setItem('artistPlayCount', JSON.stringify(artistPlayCount));

  // Проверяем OPFS или R2 — если скачан, играем быстро
  const offlineUrl = await opfsLoad(t.id);
  const r2Url = t.file_url || null;
  const streamUrl = `${RAILWAY_URL}/stream?artist=${encodeURIComponent(t.artist)}&name=${encodeURIComponent(t.name)}`;
  const playUrl = offlineUrl || r2Url || streamUrl;
  
  if (offlineUrl) showToast('▶ Офлайн');
  else if (r2Url) showToast('▶ Быстрый доступ');
  else showToast('⏳ Загружаю...');
  
  audio.pause();
  audio.src = playUrl;
  audio.load();
  try {
    await audio.play();
    showToast('');
    updateMediaSession(t);
    if (typeof socialNowPlaying !== 'undefined') socialNowPlaying(t, true);
    // Показываем album hint если трек из Волны и из альбома

  } catch(e) {
    if (e.name === 'AbortError') return;
    console.error('Play error:', e);
    showToast('Ошибка: ' + e.message);
  }
  renderAll();
  // Обновляем подсветку в альбоме если открыт
  if (document.getElementById('album-page').classList.contains('open') && currentAlbumTracks.length) {
    renderAlbumTracks(currentAlbumTracks);
  }
}

function preloadNext() {
  if (nextPreloaded) return;
  const list = currentSource === 'fav' ? favorites : currentSource === 'history' ? history : tracks;
  const nextT = list[currentIdx + 1];
  if (!nextT) return;
  nextPreloaded = true;
  audioNext.src = `${RAILWAY_URL}/stream?artist=${encodeURIComponent(nextT.artist)}&name=${encodeURIComponent(nextT.name)}`;
  audioNext.load();
}

function updateMiniPlayer(t) {
  document.getElementById('player').classList.add('visible');
  document.getElementById('player-name').textContent = t.name;
  document.getElementById('player-artist').textContent = t.artist;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('time-label').textContent = '0:00 / 0:00';
  const coverEl = document.getElementById('player-cover');
  coverEl.innerHTML = t.cover ? `<img src="${t.cover}" style="width:100%;height:100%;object-fit:cover;">` : '';
}

function updateFsPlayer(t) {
  document.getElementById('fs-name').textContent = t.name;
  document.getElementById('fs-artist').textContent = t.artist;
  // Обновляем кнопку скачать — галочка если уже скачан
  const fsMenuBtn = document.getElementById('fs-menu-btn');
  if (fsMenuBtn) {
    if (downloaded.has(t.id)) {
      fsMenuBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else {
      fsMenuBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    }
  }
  document.getElementById('fs-bar-fill').style.width = '0%';
  document.getElementById('fs-cur').textContent = '0:00';
  document.getElementById('fs-dur').textContent = '0:00';
  const img = document.getElementById('fs-cover-img');
  if (t.cover) { img.src = t.cover; img.style.display = 'block'; }
  else img.style.display = 'none';
}

function togglePlay() {
  if (!audio.src) return;
  audio.paused ? audio.play() : audio.pause();
}

function updatePlayBtn() {
  const paused = audio.paused;
  const pi = document.getElementById('play-icon'), pa = document.getElementById('pause-icon');
  const fpi = document.getElementById('fs-play-icon'), fpa = document.getElementById('fs-pause-icon');
  if (pi) pi.style.display = paused ? 'block' : 'none';
  if (pa) pa.style.display = paused ? 'none' : 'block';
  if (fpi) fpi.style.display = paused ? 'block' : 'none';
  if (fpa) fpa.style.display = paused ? 'none' : 'block';
  const fsCover = document.getElementById('fs-cover');
  if (fsCover) { fsCover.classList.toggle('playing', !paused); fsCover.classList.toggle('paused', paused); }
  if (typeof socialNowPlaying !== 'undefined') {
    const _l = currentSource === 'wave' ? waveQueue : currentSource === 'fav' ? favorites : tracks;
    const _t = _l?.[currentIdx]; if (_t) socialNowPlaying(_t, !paused);
  }
}

function prevTrack() {
  const list = currentSource === 'fav' ? favorites : currentSource === 'history' ? history : currentSource === 'offline' ? offlineTracks : currentSource === 'wave' ? waveQueue : tracks;
  if (currentIdx > 0) playTrack(currentIdx - 1, currentSource);
}

function nextTrack() {
  const list = currentSource === 'fav' ? favorites : currentSource === 'history' ? history : currentSource === 'offline' ? offlineTracks : currentSource === 'wave' ? waveQueue : tracks;
  if (isRepeat) { audio.currentTime = 0; audio.play(); return; }
  if (isShuffle) { playTrack(Math.floor(Math.random() * list.length), currentSource); return; }
  if (currentIdx < list.length - 1) playTrack(currentIdx + 1, currentSource);
}

// ── FULLSCREEN ──
function openFullscreen() {
  document.getElementById('fs-player').classList.add('open');
}
function closeFullscreen() {
  document.getElementById('fs-player').classList.remove('open');
}

// ── DOWNLOAD via R2 + Supabase ──
const USER_ID = tg?.initDataUnsafe?.user?.id || null;

async function downloadCurrent() {
  const list = currentSource === 'fav' ? favorites : currentSource === 'history' ? history : currentSource === 'offline' ? offlineTracks : tracks;
  const t = list[currentIdx];
  if (!t) return;
  if (downloaded.has(t.id)) { showToast('Уже скачан ✓'); return; }

  const fsMenuBtn = document.getElementById('fs-menu-btn');
  if (fsMenuBtn) fsMenuBtn.innerHTML = '<div class="dl-spinner"></div>';
  showToast('⏳ Скачиваю...');

  try {
    if (USER_ID) {
      // Основной путь — R2 + Supabase
      const params = new URLSearchParams({
        user_id: USER_ID,
        track_id: t.id,
        artist: t.artist,
        name: t.name,
        cover: t.cover || '',
        album: t.album || '',
        duration: t.dur || '',
      });
      const res = await fetch(`${RAILWAY_URL}/download?${params}`, { method: 'POST' });
      if (!res.ok) throw new Error('Ошибка сервера');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Ошибка');

      // Также сохраняем в OPFS для быстрого доступа
      const audioRes = await fetch(data.file_url);
      const buffer = await audioRes.arrayBuffer();
      await opfsSave(t.id, buffer);

      markDownloaded(t);
    } else {
      // Фолбэк — только OPFS (без user_id)
      const url = `${RAILWAY_URL}/stream?artist=${encodeURIComponent(t.artist)}&name=${encodeURIComponent(t.name)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Ошибка загрузки');
      const buffer = await res.arrayBuffer();
      const saved = await opfsSave(t.id, buffer);
      if (!saved) throw new Error('Ошибка сохранения');
      markDownloaded(t);
    }
  } catch(e) {
    console.error('Download error:', e);
    showToast('Ошибка: ' + e.message);
    if (fsMenuBtn) resetDlBtn();
  }
}

function markDownloaded(t) {
  downloaded.add(t.id);
  localStorage.setItem('downloaded', JSON.stringify([...downloaded]));
  if (!offlineTracks.find(o => o.id === t.id)) {
    offlineTracks.unshift({ id: t.id, name: t.name, artist: t.artist, album: t.album || '', cover: t.cover, dur: t.dur });
    localStorage.setItem('offlineTracks', JSON.stringify(offlineTracks));
  }
  showToast('Скачано ✓');
  const fsMenuBtn = document.getElementById('fs-menu-btn');
  if (fsMenuBtn) fsMenuBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  renderAll();
  renderOffline();
}

function resetDlBtn() {
  const btn = document.getElementById('fs-menu-btn');
  if (btn) btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
}

async function deleteDownload(trackId) {
  // Удаляем из OPFS
  await opfsDelete(trackId);
  // Удаляем из Supabase
  if (USER_ID) {
    fetch(`${RAILWAY_URL}/download?user_id=${USER_ID}&track_id=${trackId}`, { method: 'DELETE' }).catch(e => console.warn(e));
  }
  downloaded.delete(trackId);
  localStorage.setItem('downloaded', JSON.stringify([...downloaded]));
  offlineTracks = offlineTracks.filter(t => t.id !== trackId);
  localStorage.setItem('offlineTracks', JSON.stringify(offlineTracks));
  showToast('Удалено');
  renderAll();
  renderOffline();
}

// Загружаем скачанные треки с сервера при старте
async function loadDownloadsFromServer() {
  if (!USER_ID) return;
  try {
    const res = await fetch(`${RAILWAY_URL}/downloads?user_id=${USER_ID}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.downloads || !data.downloads.length) return;
    // Синхронизируем с локальным состоянием
    for (const d of data.downloads) {
      downloaded.add(d.track_id);
      if (!offlineTracks.find(o => o.id === d.track_id)) {
        offlineTracks.push({
          id: d.track_id, name: d.name, artist: d.artist,
          album: d.album || '', cover: d.cover_url, dur: d.duration,
          file_url: d.file_url
        });
      }
    }
    localStorage.setItem('downloaded', JSON.stringify([...downloaded]));
    localStorage.setItem('offlineTracks', JSON.stringify(offlineTracks));
    renderAll();
    renderOffline();
  } catch(e) { console.warn('Load downloads error:', e); }
}

function renderOffline() {
  const list = document.getElementById('offline-list');
  if (!list) return;
  if (!offlineTracks.length) {
    list.innerHTML = '<div class="empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><p>Нет скачанных треков.<br>Нажми ↓ чтобы скачать</p></div>';
    return;
  }
  list.innerHTML = offlineTracks.map((t, i) => {
    const isNow = currentSource === 'offline' && currentIdx === i;
    const coverHtml = t.cover ? `<img src="${t.cover}" loading="lazy">` : '<div class="cover-placeholder"></div>';
    return `
    <div class="track-item ${isNow ? 'playing' : ''}" onclick="playTrack(${i},'offline')">
      <div class="cover">${coverHtml}<div class="playing-indicator"><div class="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div></div>
      <div class="track-info"><div class="track-name">${t.name}</div><div class="track-meta">${t.artist}</div></div>
      <div class="track-actions">
        <div class="track-dur">${t.dur || ''}</div>
        <div class="dl-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        <button class="fav-btn" onclick="event.stopPropagation();deleteDownload('${t.id}')" title="Удалить">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ── DISLIKE / BLOCK ──
function dislikeCurrent() {
  const list = currentSource === 'wave' ? waveQueue : currentSource === 'fav' ? favorites : currentSource === 'offline' ? offlineTracks : tracks;
  const t = list[currentIdx];
  if (!t) return;
  blockedArtists.add(t.artist);
  localStorage.setItem('blockedArtists', JSON.stringify([...blockedArtists]));
  showToast(`🚫 ${t.artist} заблокирован`);
  nextTrack();
}

// ── SHUFFLE / REPEAT ──
function toggleShuffle() {
  isShuffle = !isShuffle;
  document.getElementById('fs-shuffle').classList.toggle('highlight', isShuffle);
}
function toggleRepeat() {
  isRepeat = !isRepeat;
  document.getElementById('fs-repeat').classList.toggle('highlight', isRepeat);
}

// ── FAVORITES ──
function toggleFav(id, source, idx) {
  const list = source === 'fav' ? favorites : source === 'history' ? history : tracks;
  const track = list[idx];
  if (!track) return;
  const fi = favorites.findIndex(f => f.id === id);
  if (fi === -1) { favorites.unshift(track); showToast('Добавлено в избранное'); }
  else { favorites.splice(fi, 1); showToast('Удалено из избранного'); }
  localStorage.setItem('favs', JSON.stringify(favorites));
  updatePlayerFavBtn(id);
  renderAll();
}

function toggleFavCurrent() {
  const list = currentSource === 'fav' ? favorites : currentSource === 'history' ? history : currentSource === 'wave' ? waveQueue : currentSource === 'offline' ? offlineTracks : tracks;
  if (currentIdx < 0 || !list[currentIdx]) return;
  const t = list[currentIdx];
  const fi = favorites.findIndex(f => f.id === t.id);
  if (fi === -1) { favorites.unshift(t); showToast('Добавлено в избранное'); }
  else { favorites.splice(fi, 1); showToast('Удалено из избранного'); }
  localStorage.setItem('favs', JSON.stringify(favorites));
  updatePlayerFavBtn(t.id);
  renderAll();
}

function updatePlayerFavBtn(id) {
  const isFaved = favorites.some(f => f.id === id);
  const btn = document.getElementById('player-fav-btn');
  const fsBtn = document.getElementById('fs-fav-btn');
  if (btn) { btn.classList.toggle('active', isFaved); btn.querySelector('svg')?.setAttribute('fill', isFaved ? 'currentColor' : 'none'); }
  if (fsBtn) { fsBtn.classList.toggle('active', isFaved); fsBtn.querySelector('svg')?.setAttribute('fill', isFaved ? 'currentColor' : 'none'); }
}

// ── MEDIA SESSION ──
function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.name,
    artist: t.artist,
    album: t.album || '',
    artwork: t.cover ? [{ src: t.cover, sizes: '512x512', type: 'image/jpeg' }] : []
  });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
  navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
}
