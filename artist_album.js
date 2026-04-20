// artist_album.js

// ── ARTIST PAGE ──
let currentArtistData = null;
let currentArtistTopTracks = [];
let artistShowAllTracks = false;
let albumPageHistory = [];

async function openArtistPage(artistId, artistName) {
  const page = document.getElementById('artist-page');
  const header = document.getElementById('artist-header');
  document.getElementById('artist-page-name').textContent = artistName || '...';
  document.getElementById('artist-page-img').src = '';
  document.getElementById('artist-page-meta').textContent = '';
  document.getElementById('artist-top-tracks').innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Загружаю...</div>';
  document.getElementById('artist-music-grid').innerHTML = '';
  header.style.setProperty('--artist-color', '#111');
  artistShowAllTracks = false;
  page.classList.add('open');

  try {
    const res = await fetch(`/api/search?action=artist&artist_id=${encodeURIComponent(artistId)}`);
    const data = await res.json();
    currentArtistData = data;
    currentArtistTopTracks = data.topTracks || [];

    // Фото + извлекаем цвет для градиента
    const img = document.getElementById('artist-page-img');
    if (data.artist?.cover) {
      img.src = data.artist.cover;
      extractArtistColor(data.artist.cover);
    }

    // Мета
    const followers = data.artist?.followers ? formatFollowers(data.artist.followers) + ' слушателей' : '';
    const genres = data.artist?.genres?.join(', ') || '';
    document.getElementById('artist-page-meta').textContent = [followers, genres].filter(Boolean).join(' · ');

    // Топ треки
    renderArtistTopTracks(data.topTracks || []);

    // Музыка — показываем первый таб
    switchArtistMusicTab('popular', document.querySelector('.artist-music-tab'));

  } catch (e) {
    document.getElementById('artist-top-tracks').innerHTML = '<div style="color:#999;padding:20px">Ошибка загрузки</div>';
  }
}

function extractArtistColor(coverUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = data[i] + data[i+1] + data[i+2];
        if (brightness > 30 && brightness < 700) {
          r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
      }
      if (count > 0) {
        r = Math.round(r / count * 0.5);
        g = Math.round(g / count * 0.5);
        b = Math.round(b / count * 0.5);
        document.getElementById('artist-header').style.setProperty('--artist-color', `rgb(${r},${g},${b})`);
      }
    } catch(e) {}
  };
  img.src = coverUrl;
}

function closeArtistPage() {
  document.getElementById('artist-page').classList.remove('open');
  albumPageHistory = [];
}

function formatFollowers(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return n;
}

function renderArtistTopTracks(topTracks) {
  const list = document.getElementById('artist-top-tracks');
  const moreBtn = document.getElementById('artist-tracks-more');
  if (!topTracks.length) { list.innerHTML = '<div style="color:#999;font-size:13px;padding:12px 0">Нет треков</div>'; if(moreBtn) moreBtn.style.display='none'; return; }

  const showCount = artistShowAllTracks ? topTracks.length : Math.min(5, topTracks.length);
  list.innerHTML = topTracks.slice(0, showCount).map((t, i) => {
    const isPlaying = currentSource === 'all' && tracks === currentArtistTopTracks && currentIdx === i;
    return `
    <div class="artist-track ${isPlaying ? 'playing' : ''}" onclick="playArtistTrack(${i})">
      <div class="artist-track-num">${isPlaying ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="#1db954"><polygon points="5 3 19 12 5 21"/></svg>' : (i + 1)}</div>
      <div class="artist-track-cover">${t.cover ? `<img src="${t.cover}" loading="lazy">` : '<div style="width:100%;height:100%;background:#1e1e1e"></div>'}</div>
      <div class="artist-track-info">
        <div class="artist-track-name">${t.name}</div>
        <div class="artist-track-meta">${t.album || ''}</div>
      </div>
      <div class="artist-track-dur">${t.dur || ''}</div>
    </div>`;
  }).join('');

  if (moreBtn) {
    moreBtn.style.display = topTracks.length > 5 ? 'block' : 'none';
    moreBtn.textContent = artistShowAllTracks ? 'Свернуть' : 'Ещё';
  }
}

function toggleArtistTracksMore() {
  artistShowAllTracks = !artistShowAllTracks;
  renderArtistTopTracks(currentArtistTopTracks);
}

function playArtistTrack(idx) {
  tracks = currentArtistTopTracks;
  currentSource = 'all';
  playTrack(idx, 'all');
  renderArtistTopTracks(currentArtistTopTracks);
}

function playArtistTopTracks() {
  if (!currentArtistTopTracks.length) return;
  tracks = currentArtistTopTracks;
  currentSource = 'all';
  playTrack(0, 'all');
  renderArtistTopTracks(currentArtistTopTracks);
}

function shuffleArtistTopTracks() {
  if (!currentArtistTopTracks.length) return;
  tracks = [...currentArtistTopTracks].sort(() => Math.random() - 0.5);
  currentSource = 'all';
  playTrack(0, 'all');
  showToast('🔀 Shuffle');
}

function switchArtistMusicTab(tab, el) {
  document.querySelectorAll('.artist-music-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');

  const grid = document.getElementById('artist-music-grid');
  if (!currentArtistData) return;

  let items = [];
  if (tab === 'popular') {
    // Все альбомы + синглы по популярности
    items = [...(currentArtistData.albums || []), ...(currentArtistData.singles || [])];
  } else if (tab === 'albums') {
    items = currentArtistData.albums || [];
  } else if (tab === 'singles') {
    items = currentArtistData.singles || [];
  }

  if (!items.length) {
    grid.innerHTML = '<div style="color:#555;font-size:13px;padding:12px 0">Ничего не найдено</div>';
    return;
  }

  grid.innerHTML = items.map(a => `
    <div class="h-card" onclick="openAlbumPage('${a.id}', '${escapeAttr(a.name)}')" style="width:140px;">
      <div class="h-card-cover" style="width:140px;height:140px;">
        ${a.cover ? `<img src="${a.cover}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">` : '<div style="width:100%;height:100%;background:#111;"></div>'}
      </div>
      <div class="h-card-name">${a.name}</div>
      <div class="h-card-artist">${a.year || ''}${a.type ? ' · ' + (a.type === 'single' ? 'Сингл' : 'Альбом') : ''}</div>
    </div>`).join('');
}

function escapeAttr(s) {
  return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ── ALBUM PAGE ──
let currentAlbumTracks = [];
let currentAlbumArtistId = null;

async function openAlbumPage(albumId, albumName) {
  const page = document.getElementById('album-page');
  const header = document.getElementById('album-header');
  document.getElementById('album-page-title').textContent = albumName || '...';
  document.getElementById('album-page-artist').textContent = '...';
  document.getElementById('album-page-meta').textContent = '';
  document.getElementById('album-page-cover').src = '';
  document.getElementById('album-tracks-list').innerHTML = '<div style="color:#999;font-size:13px;padding:20px">Загружаю...</div>';
  header.style.setProperty('--album-color', '#1a1a1a');
  page.classList.add('open');

  try {
    const res = await fetch(`/api/search?action=album_tracks&album_id=${encodeURIComponent(albumId)}`);
    const data = await res.json();
    currentAlbumTracks = data.tracks || [];
    currentAlbumArtistId = data.album?.artist_id || null;

    const album = data.album;
    if (album?.cover) {
      document.getElementById('album-page-cover').src = album.cover;
      // Извлекаем доминантный цвет из обложки
      extractAlbumColor(album.cover);
    }
    document.getElementById('album-page-title').textContent = album?.name || albumName;
    document.getElementById('album-page-artist').textContent = album?.artist || '';
    document.getElementById('album-page-meta').textContent = [
      album?.year,
      album?.total_tracks ? album.total_tracks + ' треков' : '',
      album?.label,
    ].filter(Boolean).join(' · ');

    renderAlbumTracks(currentAlbumTracks);
    // Обновляем кнопку избранного
    const favBtn = document.getElementById('album-fav-btn');
    if (favBtn && currentAlbumTracks.length) {
      const allFaved = currentAlbumTracks.every(t => favorites.some(f => f.id === t.id));
      favBtn.classList.toggle('active', allFaved);
      favBtn.querySelector('svg')?.setAttribute('fill', allFaved ? 'currentColor' : 'none');
    }
  } catch (e) {
    document.getElementById('album-tracks-list').innerHTML = '<div style="color:#999;padding:20px">Ошибка загрузки</div>';
  }
}

// Извлекаем доминантный цвет из обложки альбома
function extractAlbumColor(coverUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Пропускаем слишком тёмные и слишком светлые пиксели
        const brightness = data[i] + data[i+1] + data[i+2];
        if (brightness > 30 && brightness < 700) {
          r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
      }
      if (count > 0) {
        r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
        // Затемняем для фона
        r = Math.round(r * 0.4); g = Math.round(g * 0.4); b = Math.round(b * 0.4);
        document.getElementById('album-header').style.setProperty('--album-color', `rgb(${r},${g},${b})`);
      }
    } catch(e) {}
  };
  img.src = coverUrl;
}

function closeAlbumPage() {
  document.getElementById('album-page').classList.remove('open');
}

function goBackToArtist() {
  const artistPage = document.getElementById('artist-page');
  if (artistPage.classList.contains('open')) {
    closeAlbumPage();
  } else if (currentAlbumArtistId) {
    const artistName = document.getElementById('album-page-artist').textContent;
    closeAlbumPage();
    openArtistPage(currentAlbumArtistId, artistName);
  }
}

function renderAlbumTracks(trackList) {
  const list = document.getElementById('album-tracks-list');
  if (!trackList.length) { list.innerHTML = '<div style="color:#999;padding:20px">Треков не найдено</div>'; return; }
  list.innerHTML = trackList.map((t, i) => {
    const isPlaying = currentSource === 'all' && tracks === currentAlbumTracks && currentIdx === i;
    return `
    <div class="album-track-item ${isPlaying ? 'playing' : ''}" id="album-track-${i}" onclick="playAlbumTrack(${i})">
      <div class="album-track-num">${isPlaying ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="#1db954"><polygon points="5 3 19 12 5 21"/></svg>' : (t.track_number || i + 1)}</div>
      <div class="track-info">
        <div class="track-name">${t.name}</div>
        <div class="track-meta">${t.artist || ''} · ${t.dur || ''}</div>
      </div>
    </div>`;
  }).join('');
}

function playAlbumTrack(idx) {
  tracks = currentAlbumTracks;
  currentSource = 'all';
  playTrack(idx, 'all');
}

function updateAlbumTrackHighlight() {
  const albumPage = document.getElementById('album-page');
  if (!albumPage || !albumPage.classList.contains('open')) return;
  document.querySelectorAll('.album-track-item').forEach((el, i) => {
    const isPlaying = currentSource === 'all' && tracks === currentAlbumTracks && currentIdx === i;
    el.classList.toggle('playing', isPlaying);
    const numEl = el.querySelector('.album-track-num');
    if (numEl) {
      numEl.innerHTML = isPlaying
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="#1db954"><polygon points="5 3 19 12 5 21"/></svg>'
        : (currentAlbumTracks[i]?.track_number || i + 1);
    }
  });
}

function playAlbumAll() {
  if (!currentAlbumTracks.length) return;
  tracks = currentAlbumTracks;
  currentSource = 'all';
  playTrack(0, 'all');
  showToast('▶ Слушаю альбом');
}

function playAlbumShuffle() {
  if (!currentAlbumTracks.length) return;
  tracks = [...currentAlbumTracks].sort(() => Math.random() - 0.5);
  currentAlbumTracks = tracks;
  currentSource = 'all';
  playTrack(0, 'all');
  renderAlbumTracks(currentAlbumTracks);
  showToast('🔀 Shuffle');
}

// Избранное для альбома — сохраняем все треки в избранное
function toggleAlbumFav() {
  if (!currentAlbumTracks.length) return;
  const btn = document.getElementById('album-fav-btn');
  const allFaved = currentAlbumTracks.every(t => favorites.some(f => f.id === t.id));
  if (allFaved) {
    // Убираем все треки альбома из избранного
    currentAlbumTracks.forEach(t => {
      const idx = favorites.findIndex(f => f.id === t.id);
      if (idx !== -1) favorites.splice(idx, 1);
    });
    if (btn) { btn.classList.remove('active'); btn.querySelector('svg').setAttribute('fill', 'none'); }
    showToast('Удалено из избранного');
  } else {
    // Добавляем все треки альбома
    currentAlbumTracks.forEach(t => {
      if (!favorites.some(f => f.id === t.id)) favorites.push(t);
    });
    if (btn) { btn.classList.add('active'); btn.querySelector('svg').setAttribute('fill', 'currentColor'); }
    showToast('Альбом добавлен в избранное');
  }
  localStorage.setItem('favs', JSON.stringify(favorites));
}

// Скачать весь альбом
async function downloadAlbum() {
  if (!currentAlbumTracks.length) return;
  const toDownload = currentAlbumTracks.filter(t => !downloaded.has(t.id));
  if (!toDownload.length) { showToast('Все треки уже скачаны ✓'); return; }
  showToast(`⏳ Скачиваю ${toDownload.length} треков...`);
  let done = 0;
  for (const t of toDownload) {
    try {
      const url = `${RAILWAY_URL}/stream?artist=${encodeURIComponent(t.artist)}&name=${encodeURIComponent(t.name)}`;
      const res = await fetch(url);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const saved = await opfsSave(t.id, buffer);
        if (saved) markDownloaded(t);
        done++;
      }
    } catch(e) {}
  }
  showToast(`Скачано ${done}/${toDownload.length} треков ✓`);
}

// ── Клик на имя артиста в треке → открыть страницу ──
// ── Артист кликабелен — добавляем обработчики после рендера треков ──
function addArtistClickHandlers(containerId, items) {
  const list = document.getElementById(containerId);
  if (!list) return;
  list.querySelectorAll('.track-meta').forEach((el, i) => {
    const t = items[i];
    if (t?.artist_id) {
      el.style.cursor = 'pointer';
      el.onclick = (e) => { e.stopPropagation(); openArtistPage(t.artist_id, t.artist); };
    }
  });
}

