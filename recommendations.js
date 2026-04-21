// recommendations.js


async function startWave() {
  if (waveIsPlaying && waveTracks.length > 0) {
    togglePlay();
    waveIsPlaying = audio.paused ? false : true;
    updateWaveBtn();
    return;
  }
  document.getElementById('wave-status').textContent = 'Подбираю треки...';
  const seedIds3 = getSeedIds();
  if (!seedIds3.length) {
    document.getElementById('wave-status').textContent = 'Выбери артистов в настройках';
    return;
  }
  try {
    const waveParams = `artist_ids=${encodeURIComponent(seedIds3.join(','))}`;
    const res = await fetch(`/api/search?action=wave&${waveParams}&limit=20`);
    const data = await res.json();
    if (!data.tracks?.length) { document.getElementById('wave-status').textContent = 'Не удалось загрузить'; return; }
    waveTracks = data.tracks;
    waveQueue = data.tracks;
    waveArtistPool = data.artist_pool || seedIds3;
    wavePlayedIds = new Set();
    currentSource = 'wave';
    waveIsPlaying = true;
    updateWaveBtn();
    document.getElementById('wave-status').textContent = `LIBAUD FM · Бесконечное радио`;
    await playTrack(0, 'wave');
  } catch(e) {
    document.getElementById('wave-status').textContent = 'Ошибка загрузки';
  }
}

// Дозагрузка треков для радио (без Claude — только Spotify)
async function waveLoadMore() {
  if (waveLoadingMore || !waveArtistPool.length) return;
  waveLoadingMore = true;
  try {
    const playedStr = [...wavePlayedIds].slice(-50).join(','); // последние 50
    const poolStr = waveArtistPool.join(',');
    const res = await fetch(`/api/search?action=wave_more&artist_ids=${encodeURIComponent(poolStr)}&played=${encodeURIComponent(playedStr)}`);
    const data = await res.json();
    if (data.tracks?.length) {
      waveQueue.push(...data.tracks);
      // Добавляем новых артистов в пул
      if (data.new_artists?.length) {
        const poolSet = new Set(waveArtistPool);
        for (const id of data.new_artists) {
          if (!poolSet.has(id)) { poolSet.add(id); waveArtistPool.push(id); }
        }
      }
    }
  } catch(e) {}
  waveLoadingMore = false;
}

function updateWaveBtn() {
  const pi = document.getElementById('wave-play-icon');
  const pa = document.getElementById('wave-pause-icon');
  const btnInner = document.getElementById('wave-play-btn-inner');
  if (pi) pi.style.display = waveIsPlaying ? 'none' : 'block';
  if (pa) pa.style.display = waveIsPlaying ? 'block' : 'none';
  if (btnInner) btnInner.classList.toggle('hidden', waveIsPlaying);
  // Ускоряем/замедляем canvas анимацию
  if (window._waveAnim) window._waveAnim.setPlaying(waveIsPlaying);
}

// ── CANVAS ВОЛНА ──
(function initWaveCanvas() {
  const canvas = document.getElementById('waveCanvas');
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  function resize() {
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  resize();
  window.addEventListener('resize', resize);

  const ctx = canvas.getContext('2d');
  let playing = false;
  let animFrame;

  // Параметры лучей
  const RAY_COUNT = 80;
  const rays = Array.from({ length: RAY_COUNT }, (_, i) => ({
    angle: (i / RAY_COUNT) * Math.PI * 2,
    baseLen: 0.12 + Math.random() * 0.18,
    speed: 0.3 + Math.random() * 1.2,
    phase: Math.random() * Math.PI * 2,
    width: 0.4 + Math.random() * 1.2,
    chaos: Math.random() * 0.6,
    secondary: Math.random() > 0.6, // вторичный луч (короче)
  }));

  // Внутренние частицы
  const PARTICLE_COUNT = 30;
  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    angle: Math.random() * Math.PI * 2,
    r: 0.02 + Math.random() * 0.06,
    speed: 0.5 + Math.random() * 1.5,
    phase: Math.random() * Math.PI * 2,
    size: 0.5 + Math.random() * 1.5,
  }));

  let t = 0;
  let energyTarget = 0, energy = 0;

  function draw() {
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.38; // базовый радиус

    ctx.clearRect(0, 0, W, H);

    // Фон — чёрный
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Плавное изменение energy
    energy += (energyTarget - energy) * 0.04;
    const e = energy;

    const speed = playing ? 1.0 : 0.25;
    t += 0.016 * speed;

    // Центральное свечение
    if (e > 0.05) {
      const glowR = R * (0.25 + e * 0.15);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0, `rgba(255,255,255,${0.08 * e})`);
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Лучи
    rays.forEach(ray => {
      const chaos = Math.sin(t * ray.speed + ray.phase) * 0.5 +
                    Math.sin(t * ray.speed * 1.7 + ray.phase * 1.3) * 0.3 +
                    Math.sin(t * ray.speed * 0.4 + ray.phase * 2.1) * 0.2;

      const lenMult = 0.3 + e * 0.7 + chaos * ray.chaos;
      const len = R * ray.baseLen * lenMult * (playing ? 1.0 : 0.5);
      const startR = R * (0.18 + e * 0.05);

      const angleJitter = Math.sin(t * ray.speed * 0.8 + ray.phase) * 0.04 * e;
      const angle = ray.angle + angleJitter;

      const x1 = cx + Math.cos(angle) * startR;
      const y1 = cy + Math.sin(angle) * startR;
      const x2 = cx + Math.cos(angle) * (startR + len);
      const y2 = cy + Math.sin(angle) * (startR + len);

      const alpha = (0.15 + e * 0.7) * (0.5 + chaos * 0.5);
      const w = ray.width * (0.5 + e * 0.8) * dpr;

      // Основной луч
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, `rgba(255,255,255,${Math.min(1, alpha * 1.2)})`);
      grad.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.6})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(0.5, w);
      ctx.lineCap = 'round';
      ctx.stroke();

      // Вторичный луч (тонкий, длиннее)
      if (ray.secondary && e > 0.2) {
        const len2 = len * (1.2 + Math.random() * 0.3);
        const x2b = cx + Math.cos(angle + 0.02) * (startR + len2);
        const y2b = cy + Math.sin(angle + 0.02) * (startR + len2);
        const grad2 = ctx.createLinearGradient(x1, y1, x2b, y2b);
        grad2.addColorStop(0, `rgba(255,255,255,${alpha * 0.5})`);
        grad2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2b, y2b);
        ctx.strokeStyle = grad2;
        ctx.lineWidth = Math.max(0.3, w * 0.4);
        ctx.stroke();
      }
    });

    // Центральный круг
    const coreR = R * (0.16 + e * 0.04 + Math.sin(t * 1.2) * 0.01 * e);
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    coreGrad.addColorStop(0, `rgba(255,255,255,${0.5 + e * 0.4})`);
    coreGrad.addColorStop(0.5, `rgba(200,200,200,${0.2 + e * 0.3})`);
    coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // Частицы вокруг ядра
    if (e > 0.1) {
      particles.forEach(p => {
        const pr = R * (p.r + 0.05 * e) + Math.sin(t * p.speed + p.phase) * R * 0.03 * e;
        const pa2 = p.angle + t * p.speed * 0.3;
        const px = cx + Math.cos(pa2) * pr;
        const py = cy + Math.sin(pa2) * pr;
        const palpha = (0.3 + e * 0.6) * (0.5 + Math.sin(t * p.speed * 2 + p.phase) * 0.5);
        ctx.beginPath();
        ctx.arc(px, py, p.size * dpr * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${palpha})`;
        ctx.fill();
      });
    }

    animFrame = requestAnimationFrame(draw);
  }

  // Слушаем аудио для energy
  function syncEnergy() {
    if (window.audio) {
      const isPlaying = !window.audio.paused;
      energyTarget = isPlaying ? 1.0 : 0.15;
    } else {
      energyTarget = 0.15;
    }
    setTimeout(syncEnergy, 200);
  }
  syncEnergy();

  draw();

  window._waveAnim = {
    setPlaying(p) {
      playing = p;
      energyTarget = p ? 1.0 : 0.15;
    }
  };
})();

const MIXES = [
  { id: 'mix_hiphop_ru',   title: 'Русский рэп',      sub: 'Лучшее',      color: '#1a1a1a', query: 'русский рэп хиты', emoji: '🎤' },
  { id: 'mix_chill',       title: 'Chill вечер',      sub: 'Расслабься',  color: '#0d1f2d', query: 'chill lo-fi beats', emoji: '🌙' },
  { id: 'mix_hype',        title: 'Энергия',          sub: 'Заряжайся',   color: '#1a0a00', query: 'trap hype bangers 2024', emoji: '⚡' },
  { id: 'mix_rnb',         title: 'R&B Vibes',        sub: 'Smooth',      color: '#1a0d1a', query: 'rnb soul smooth 2024', emoji: '✨' },
  { id: 'mix_indie',       title: 'Инди',             sub: 'Открытия',    color: '#0a1a0a', query: 'indie альтернатива хиты', emoji: '🎸' },
  { id: 'mix_workout',     title: 'Тренировка',       sub: 'Не останавливайся', color: '#1a0a0a', query: 'workout gym motivation', emoji: '🏋️' },
];


function renderMixes() {
  const container = document.getElementById('mixes-list');
  if (!container) return;
  container.innerHTML = MIXES.map(m => `
    <div class="mix-card" onclick="playMix('${m.id}')">
      <div class="mix-cover" style="background:${m.color};">
        <div class="mix-cover-grad">
          <div style="font-size:28px;margin-bottom:4px;">${m.emoji}</div>
          <div class="mix-cover-title">${m.title}</div>
          <div class="mix-cover-sub">${m.sub}</div>
        </div>
      </div>
    </div>`).join('');
}

async function playMix(mixId) {
  const mix = MIXES.find(m => m.id === mixId);
  if (!mix) return;
  showToast('⏳ Загружаю сборник...');
  if (mixTracks[mixId]) {
    tracks = mixTracks[mixId];
    currentSource = 'all';
    playTrack(0, 'all');
    showToast(`▶ ${mix.title}`);
    return;
  }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(mix.query)}&action=search`);
    const data = await res.json();
    const t = data.tracks || [];
    if (!t.length) { showToast('Ничего не найдено'); return; }
    mixTracks[mixId] = t.sort(() => Math.random() - 0.5);
    tracks = mixTracks[mixId];
    currentSource = 'all';
    playTrack(0, 'all');
    showToast(`▶ ${mix.title}`);
  } catch(e) {
    showToast('Ошибка загрузки');
  }
}

// ── РЕКОМЕНДОВАННЫЕ АЛЬБОМЫ ──
async function loadRecAlbums(force = false) {
  const container = document.getElementById('rec-albums-list');
  if (!container) return;

  // Дневной кэш
  if (!force) {
    const cached = getCachedRecs('albums');
    if (cached && cached.length) { renderRecAlbums(cached); return; }
  }

  // Собираем seed: онбординг + история + лайки
  const seedIds2 = getSeedIds();
  const historyArtists = [...new Set(history.slice(0, 15).map(t => t.artist))];

  if (!seedIds2.length && !historyArtists.length) {
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Слушай музыку чтобы появились рекомендации</div>';
    return;
  }

  container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Подбираю альбомы...</div>';
  try {
    const albumParams = seedIds2.length
      ? 'artist_ids=' + encodeURIComponent(seedIds2.join(','))
      : 'artists=' + encodeURIComponent(historyArtists.slice(0, 8).join(','));
    const res = await fetch('/api/search?action=rec_albums&' + albumParams);
    const data = await res.json();
    const albums = data.albums || [];
    if (!albums.length) throw new Error('empty');
    setCachedRecs('albums', albums);
    renderRecAlbums(albums);
  } catch(e) {
    // Фолбэк — собираем альбомы из related треков
    try {
      const ids = seedIds2.length ? seedIds2.slice(0, 3) : [];
      const fallbackAlbums = [];
      const seenAlbumIds = new Set();
      const seenArtists = new Set();

      if (ids.length) {
        const promises = ids.map(id =>
          fetch(`/api/search?action=related&track=${encodeURIComponent('id:' + id + '|artist')}&limit=8`)
            .then(r => r.json()).catch(() => ({ tracks: [] }))
        );
        const results = await Promise.all(promises);
        for (const d of results) {
          for (const t of (d.tracks || [])) {
            if (t.album_id && !seenAlbumIds.has(t.album_id) && !seenArtists.has(t.artist)) {
              seenAlbumIds.add(t.album_id);
              seenArtists.add(t.artist);
              fallbackAlbums.push({
                id: t.album_id, name: t.album,
                artist: t.artist, artist_id: t.artist_id,
                cover: t.cover, year: '', total_tracks: 0,
              });
            }
          }
        }
      }

      // Ещё фолбэк — поиск альбомов артистов из истории
      if (!fallbackAlbums.length && historyArtists.length) {
        const shuffled = [...historyArtists].sort(() => Math.random() - 0.5).slice(0, 3);
        const promises = shuffled.map(name =>
          fetch(`/api/search?q=${encodeURIComponent(name)}&action=search`)
            .then(r => r.json()).catch(() => ({ tracks: [] }))
        );
        const results = await Promise.all(promises);
        for (const d of results) {
          for (const t of (d.tracks || [])) {
            if (t.album_id && !seenAlbumIds.has(t.album_id) && !seenArtists.has(t.artist)) {
              seenAlbumIds.add(t.album_id);
              seenArtists.add(t.artist);
              fallbackAlbums.push({
                id: t.album_id, name: t.album,
                artist: t.artist, artist_id: t.artist_id,
                cover: t.cover, year: '', total_tracks: 0,
              });
            }
          }
        }
      }

      if (fallbackAlbums.length) {
        const sliced = fallbackAlbums.slice(0, 6);
        setCachedRecs('albums', sliced);
        renderRecAlbums(sliced);
        return;
      }
    } catch(_) {}
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Не удалось загрузить</div>';
  }
}

function renderRecAlbums(albums) {
  const container = document.getElementById('rec-albums-list');
  if (!container) return;
  container.innerHTML = albums.map(a => `
    <div class="rec-album-card" onclick="openAlbumPage('${a.id}','${escapeAttr(a.name)}')">
      <div class="rec-album-cover">
        ${a.cover ? `<img src="${a.cover}" loading="lazy">` : '<div style="width:100%;height:100%;background:#111;"></div>'}
      </div>
      <div class="rec-album-name">${a.name}</div>
      <div class="rec-album-artist">${a.artist || ''} · ${a.year || ''}</div>
    </div>`).join('');
}


// Получаем точные Spotify IDs сохранённых артистов
function getObArtistIds() {
  try { return JSON.parse(localStorage.getItem('ob_artist_ids') || '{}'); } catch { return {}; }
}

// Собираем IDs из истории прослушиваний (artist_id поле)
function getHistoryArtistIds() {
  const ids = [...new Set(
    history.filter(t => t.artist_id && !t.id?.startsWith('seed_'))
           .map(t => t.artist_id)
  )].slice(0, 6);
  return ids;
}

// Главная функция — возвращает лучший набор IDs для рекомендаций
function getSeedIds() {
  const histIds = getHistoryArtistIds();
  const obIds = Object.values(getObArtistIds());
  const favIds = [...new Set(favorites.map(t => t.artist_id).filter(Boolean))].slice(0, 3);
  // Приоритет: избранное > история > онбординг
  return [...new Set([...favIds, ...histIds, ...obIds])].slice(0, 6);
}

async function loadAiRecs(force = false) {
  const container = document.getElementById('ai-recs-list');
  if (!container) return;

  // Дневной кэш
  if (!force) {
    const cached = getCachedRecs('ai');
    if (cached && cached.length) { renderHScroll('ai-recs-list', cached); return; }
  }

  const seedIds = getSeedIds();
  const historyArtists = [...new Set(history.slice(0, 15).map(t => t.artist))];

  if (!seedIds.length && !historyArtists.length) {
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Слушай музыку чтобы появились рекомендации</div>';
    return;
  }

  container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Подбираю открытия...</div>';
  try {
    const params = seedIds.length
      ? `artist_ids=${encodeURIComponent(seedIds.join(','))}`
      : `artists=${encodeURIComponent(historyArtists.slice(0, 6).join(','))}`;
    const res = await fetch(`/api/search?action=ai_recommend&${params}&limit=12`);
    const data = await res.json();
    if (data.tracks && data.tracks.length > 0) {
      // Фильтруем: макс 2 трека от одного артиста + убираем из истории
      const artistCount = {};
      const diversified = data.tracks.filter(t => {
        artistCount[t.artist] = (artistCount[t.artist] || 0) + 1;
        return artistCount[t.artist] <= 2;
      });
      const fresh = diversified.filter(t => !history.some(h => h.id === t.id));
      const result = fresh.length >= 3 ? fresh : diversified;
      setCachedRecs('ai', result);
      renderHScroll('ai-recs-list', result);
      return;
    }
    throw new Error('empty');
  } catch(e) {
    // Фолбэк — related по seed артистам
    try {
      if (seedIds.length) {
        const relPromises = seedIds.slice(0, 3).map(id =>
          fetch(`/api/search?action=related&track=${encodeURIComponent('id:' + id + '|artist')}&limit=8`)
            .then(r => r.json()).catch(() => ({ tracks: [] }))
        );
        const results = await Promise.all(relPromises);
        const seen = new Set();
        const artistCount = {};
        const fallback = [];
        for (const d of results) {
          for (const t of (d.tracks || [])) {
            if (!seen.has(t.id) && !history.some(h => h.id === t.id)) {
              artistCount[t.artist] = (artistCount[t.artist] || 0) + 1;
              if (artistCount[t.artist] <= 2) {
                seen.add(t.id);
                fallback.push(t);
              }
            }
          }
        }
        if (fallback.length >= 3) {
          fallback.sort(() => Math.random() - 0.5);
          setCachedRecs('ai', fallback);
          renderHScroll('ai-recs-list', fallback);
          return;
        }
      }
      // Ещё фолбэк — поиск по артистам из истории
      if (historyArtists.length) {
        const shuffled = [...historyArtists].sort(() => Math.random() - 0.5).slice(0, 3);
        const searchPromises = shuffled.map(name =>
          fetch(`/api/search?q=${encodeURIComponent(name)}`).then(r => r.json()).catch(() => ({ tracks: [] }))
        );
        const results2 = await Promise.all(searchPromises);
        const seen2 = new Set();
        const ac2 = {};
        const fallback2 = [];
        for (const d of results2) {
          for (const t of (d.tracks || [])) {
            if (!seen2.has(t.id) && !history.some(h => h.id === t.id)) {
              ac2[t.artist] = (ac2[t.artist] || 0) + 1;
              if (ac2[t.artist] <= 2) { seen2.add(t.id); fallback2.push(t); }
            }
          }
        }
        if (fallback2.length) {
          fallback2.sort(() => Math.random() - 0.5);
          renderHScroll('ai-recs-list', fallback2);
          return;
        }
      }
    } catch(_) {}
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Не удалось загрузить</div>';
  }
}

// ── ПОХОЖИЕ ТРЕКИ ── (на основе любимых артистов, не последнего трека)
async function loadRelated(force = false) {
  const container = document.getElementById('related-list');
  if (!container) return;

  // Дневной кэш
  if (!force) {
    const cached = getCachedRecs('related');
    if (cached && cached.length) { renderHScroll('related-list', cached); return; }
  }

  // Берём seed артистов: онбординг + история + избранное
  const seedIds = getSeedIds();
  const historyArtists = [...new Set(history.slice(0, 10).map(t => t.artist))];

  if (!seedIds.length && !historyArtists.length) {
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Слушай музыку чтобы появились рекомендации</div>';
    return;
  }

  container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Ищу похожее...</div>';
  try {
    // Используем related action напрямую по каждому seed артисту
    const ids = seedIds.length ? seedIds.slice(0, 3) : [];
    let relatedTracks = [];

    if (ids.length) {
      const promises = ids.map(id =>
        fetch(`/api/search?action=related&track=${encodeURIComponent('id:' + id + '|artist')}&limit=8`)
          .then(r => r.json()).catch(() => ({ tracks: [] }))
      );
      const results = await Promise.all(promises);
      const seen = new Set();
      const artistCount = {};
      for (const data of results) {
        for (const t of (data.tracks || [])) {
          if (!seen.has(t.id)) {
            artistCount[t.artist] = (artistCount[t.artist] || 0) + 1;
            if (artistCount[t.artist] <= 2) {
              seen.add(t.id);
              relatedTracks.push(t);
            }
          }
        }
      }
    }

    // Фолбэк через поиск по артистам из истории
    if (!relatedTracks.length && historyArtists.length) {
      const shuffled = [...historyArtists].sort(() => Math.random() - 0.5).slice(0, 3);
      const promises = shuffled.map(name =>
        fetch(`/api/search?q=${encodeURIComponent(name)}&action=search`)
          .then(r => r.json()).catch(() => ({ tracks: [] }))
      );
      const results = await Promise.all(promises);
      const seen = new Set();
      for (const data of results) {
        for (const t of (data.tracks || [])) {
          if (!seen.has(t.id) && !history.some(h => h.id === t.id)) {
            seen.add(t.id);
            relatedTracks.push(t);
          }
        }
      }
    }

    if (relatedTracks.length > 0) {
      relatedTracks.sort(() => Math.random() - 0.5);
      const sliced = relatedTracks.slice(0, 15);
      setCachedRecs('related', sliced);
      renderHScroll('related-list', sliced);
      return;
    }
    throw new Error('empty');
  } catch(e) {
    // Последний фолбэк
    try {
      const lastTrack = history[0];
      if (lastTrack && lastTrack.artist_id) {
        const res2 = await fetch(`/api/search?action=related&track=${encodeURIComponent('id:' + lastTrack.artist_id + '|' + lastTrack.artist)}&limit=12`);
        const data2 = await res2.json();
        if (data2.tracks?.length) { renderHScroll('related-list', data2.tracks); return; }
      }
    } catch(_) {}
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Не удалось загрузить</div>';
  }
}

function renderHScroll(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Ничего не найдено</div>';
    return;
  }
  // Добавляем треки во временный список
  const tempIdx = 9000;
  container.innerHTML = items.map((t, i) => {
    const coverHtml = t.cover ? `<img src="${t.cover}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">` : '<div style="width:100%;height:100%;background:#111;"></div>';
    return `
    <div class="h-card" onclick="playFromHome(${i}, '${containerId}')">
      <div class="h-card-cover">
        ${coverHtml}
        <div class="h-card-play">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
      </div>
      <div class="h-card-name">${t.name}</div>
      <div class="h-card-artist" style="${t.artist_id ? 'cursor:pointer;' : ''}" ${t.artist_id ? `onclick="event.stopPropagation();openArtistPage('${t.artist_id}','${escapeAttr(t.artist)}')"` : ''}>${t.artist}</div>
    </div>`;
  }).join('');
  // Сохраняем треки для воспроизведения
  container._tracks = items;
}

function playFromHome(idx, containerId) {
  const container = document.getElementById(containerId);
  if (!container || !container._tracks) return;
  tracks = container._tracks;
  currentSource = 'all';
  playTrack(idx, 'all');
}

// ── ПЛЕЙЛИСТЫ ──

function renderPlaylists() {
  const grid = document.getElementById('playlist-grid');
  if (!grid) return;
  const items = playlists.map((p, i) => `
    <div class="playlist-card" onclick="openPlaylist(${i})">
      <div class="playlist-name">${p.name}</div>
      <div class="playlist-count">${p.tracks.length} треков</div>
    </div>`).join('');
  grid.innerHTML = items + `
    <div class="playlist-add" onclick="createPlaylist()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>Создать</span>
    </div>`;
}

function createPlaylist() {
  const name = prompt('Название плейлиста:');
  if (!name) return;
  playlists.unshift({ name, tracks: [] });
  localStorage.setItem('playlists', JSON.stringify(playlists));
  renderPlaylists();
  showToast('Плейлист создан');
}

function openPlaylist(idx) {
  const p = playlists[idx];
  if (!p) return;
  tracks = p.tracks;
  currentSource = 'all';
  renderList('track-list', tracks);
  switchTab('all', null, document.getElementById('nav-all'));
  document.querySelectorAll('.tab').forEach((t, i) => { if (i === 1) t.classList.add('active'); else t.classList.remove('active'); });
  showToast(`📂 ${p.name}`);
}

// ════════════════════════════════════════════
// ── УМНОЕ КЕШИРОВАНИЕ ──
// ════════════════════════════════════════════

function getCachedRecs(key) {
  try {
    const raw = localStorage.getItem('recs_cache_' + key);
    if (!raw) return null;
    const { data, expires } = JSON.parse(raw);
    if (Date.now() > expires) return null;
    return data;
  } catch { return null; }
}

function setCachedRecs(key, data, ttlHours = 24) {
  try {
    localStorage.setItem('recs_cache_' + key, JSON.stringify({
      data, expires: Date.now() + ttlHours * 60 * 60 * 1000
    }));
  } catch {}
}

// Кеш до следующей пятницы
function setCachedUntilFriday(key, data) {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=вс, 5=пт
    let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    if (daysUntilFriday === 0) daysUntilFriday = 7; // если сегодня пятница — до следующей
    const friday = new Date(now);
    friday.setDate(friday.getDate() + daysUntilFriday);
    friday.setHours(0, 0, 0, 0);
    localStorage.setItem('recs_cache_' + key, JSON.stringify({
      data, expires: friday.getTime()
    }));
  } catch {}
}

function invalidateDailyRecs() {
  ['ai', 'related', 'albums'].forEach(k => localStorage.removeItem('recs_cache_' + k));
}

// ── НОВИНКИ ЛЮБИМЫХ АРТИСТОВ ──
async function loadNewReleases(force = false) {
  const container = document.getElementById('new-releases-list');
  if (!container) return;
  if (!force) {
    const cached = getCachedRecs('new_releases');
    if (cached && cached.length) { renderNewReleases(cached); return; }
  }
  const seedIds = getSeedIds();
  if (!seedIds.length) {
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Слушай музыку чтобы появились новинки</div>';
    return;
  }
  container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Ищу новинки...</div>';
  try {
    const res = await fetch(`/api/search?action=new_releases&artist_ids=${encodeURIComponent(seedIds.join(','))}`);
    const data = await res.json();
    if (data.releases?.length) {
      setCachedUntilFriday('new_releases', data.releases);
      renderNewReleases(data.releases);
    } else {
      container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Нет свежих релизов</div>';
    }
  } catch(e) {
    container.innerHTML = '<div style="color:#999;font-size:13px;padding:20px 0">Не удалось загрузить</div>';
  }
}

function renderNewReleases(releases) {
  const container = document.getElementById('new-releases-list');
  if (!container || !releases.length) return;
  container.innerHTML = releases.map(r => {
    const safeName = (r.name || '').replace(/'/g, "\'");
    const isSingle = r.type === 'single';
    return '<div class="h-card" onclick="openAlbumPage(\'' + r.id + '\',\'' + safeName + '\')">' +
      '<div class="h-card-cover" style="' + (isSingle ? 'border-radius:50%;overflow:hidden;' : '') + '">' +
      (r.cover ? '<img src="' + r.cover + '" loading="lazy">' : '<div class="h-card-cover-placeholder"></div>') +
      '</div>' +
      '<div class="h-card-name">' + (r.name || '') + '</div>' +
      '<div class="h-card-artist">' + (r.artist || '') + ' · ' + (isSingle ? 'Сингл' : 'Альбом') + '</div>' +
      '</div>';
  }).join('');
}

