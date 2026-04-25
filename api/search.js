// Кеш токена и данных на уровне модуля — переживает между вызовами в рамках warm lambda
let _spotifyToken = null;
let _tokenExpiry = 0;
const _memCache = new Map(); // key -> { data, expiry }

function getCached(key) {
  const c = _memCache.get(key);
  if (c && Date.now() < c.expiry) return c.data;
  return null;
}
function setCached(key, data, ttlMs = 3600000) {
  _memCache.set(key, { data, expiry: Date.now() + ttlMs });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, action, artists, artist_ids, track, artist_id, album_id, limit = 20 } = req.query;

  // Кешируем на edge большинство запросов
  const cacheable = ['rec_albums', 'related', 'ai_recommend', 'new_releases', 'artist', 'album_tracks'];
  if (cacheable.includes(action)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
  }

  // ── SPOTIFY TOKEN (с кешем на уровне модуля) ──
  async function getSpotifyToken() {
    if (_spotifyToken && Date.now() < _tokenExpiry) return _spotifyToken;
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      },
      body: 'grant_type=client_credentials'
    });
    const d = await r.json();
    _spotifyToken = d.access_token;
    _tokenExpiry = Date.now() + 50 * 60 * 1000; // токен живёт 1 час, кешируем на 50 мин
    return _spotifyToken;
  }

  function mapTrack(t) {
    return {
      id: t.id,
      name: t.name,
      artist: t.artists[0].name,
      artist_id: t.artists[0].id,
      album: t.album?.name || '',
      album_id: t.album?.id || '',
      cover: t.album?.images?.[0]?.url || null,
      duration_ms: t.duration_ms || 0,
      dur: t.duration_ms
        ? Math.floor(t.duration_ms/60000)+':'+String(Math.floor((t.duration_ms%60000)/1000)).padStart(2,'0')
        : '0:00',
      track_number: t.track_number || 0,
    };
  }

  function mapAlbum(a) {
    return {
      id: a.id, name: a.name,
      cover: a.images[0]?.url || null,
      year: a.release_date?.slice(0, 4) || '',
      total_tracks: a.total_tracks,
      type: a.album_type,
    };
  }

  async function spFetch(path) {
    const token = await getSpotifyToken();
    const r = await fetch('https://api.spotify.com/v1' + path, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    return r.json();
  }

  async function getTopTracks(id) {
    const cacheKey = 'top:' + id;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Параллельно пробуем US и RU — берём первый непустой
    const [dUS, dRU] = await Promise.all([
      spFetch('/artists/' + id + '/top-tracks?market=US'),
      spFetch('/artists/' + id + '/top-tracks?market=RU'),
    ]);
    const d = dUS.tracks?.length ? dUS : dRU.tracks?.length ? dRU : null;
    if (d) {
      const tracks = (d.tracks || []).slice(0, 3).map(mapTrack);
      setCached(cacheKey, tracks, 6 * 3600000); // 6 часов
      return tracks;
    }

    // Фолбэк через поиск по artist ID
    try {
      const info = await spFetch('/artists/' + id);
      if (info.name) {
        const s = await spFetch('/search?q=' + encodeURIComponent('artist:"' + info.name + '"') + '&type=track&limit=5&market=RU');
        if (s.tracks?.items?.length) return s.tracks.items.slice(0, 3).map(mapTrack);
      }
    } catch(e) {}
    return [];
  }

  async function getRelated(id) {
    const d = await spFetch('/artists/' + id + '/related-artists');
    return (d.artists || []).slice(0, 8);
  }

  async function getArtistInfo(id) {
    const d = await spFetch('/artists/' + id);
    return d;
  }

  async function findArtistId(name) {
    // Используем точный поиск с кавычками
    const d = await spFetch('/search?q=' + encodeURIComponent('artist:"' + name + '"') + '&type=artist&limit=5&market=US');
    const items = d.artists?.items || [];
    // Ищем точное совпадение имени (case insensitive)
    const exact = items.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact.id;
    // Иначе берём самого популярного
    return items[0]?.id || null;
  }

  // ── CLAUDE HAIKU — экспертные рекомендации с кешированием ──
  const SYSTEM_PROMPT = `### ROLE
Ты — экспертный алгоритм музыкальных рекомендаций уровня Spotify и Яндекс.Музыка. Твоя задача: на основе входных данных о предпочтениях пользователя составить список из 15 максимально похожих композиций для бесшовного прослушивания.

### RECOMMENDATION LOGIC (Content-Based)
Используй следующие критерии для подбора:
- Совпадение поджанров (например, не просто "Rock", а "Post-Punk" или "Indie Surf").
- Сходство BPM (темпа) и ритмического рисунка.
- Сходство тембра голоса вокалиста и инструментального состава.
- Эмоциональный окрас (грустный/меланхоличный против энергичного/позитивного).
- "Эпоха" и качество продакшена (чтобы треки 70-х не шли вперемешку с современным гиперпопом, если это не задано явно).
- Язык: если пользователь слушает русскоязычную музыку — рекомендуй преимущественно русскоязычную.

### BATCHING & EFFICIENCY
- Генерируй ровно 15 треков за один раз.
- Первые 3 трека — максимально близки к вводным ("безопасные рекомендации").
- Следующие 7 треков — расширение границ (похожие по вайбу, но других исполнителей).
- Последние 5 треков — "Discovery" (новый опыт на основе косвенных признаков).

### OUTPUT FORMAT
Отвечай строго в формате JSON. Не пиши никакого вступительного или пояснительного текста.
{"recommendations":[{"artist":"string","track":"string","match_score":0.95}]}`;

  async function aiRecommend(artistsWithGenres, mode = 'discovery') {
    const userPrompt = mode === 'wave'
      ? `Пользователь слушает этих артистов: ${artistsWithGenres}.
Составь персональное радио — 15 треков от разных артистов, микс знакомого и нового. Используй логику BATCHING из системного промпта.`
      : `Пользователь слушает: ${artistsWithGenres}.
Подбери 15 треков для открытий — преимущественно от артистов, которых пользователь скорее всего не знает, но они в том же стиле и вайбе. Используй логику BATCHING из системного промпта.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    const d = await r.json();
    const text = d.content?.[0]?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : '{}');

    // Извлекаем из нового формата {recommendations: [{artist, track}]}
    if (parsed.recommendations) {
      return parsed.recommendations.map(r => ({
        artist: r.artist,
        track: r.track,
        match_score: r.match_score || 0,
      }));
    }
    // Фолбэк на старый формат {artists: [...]}
    if (parsed.artists) {
      return parsed.artists.map(name => ({ artist: name, track: null, match_score: 0 }));
    }
    return [];
  }

  try {

    // ── ПОИСК ──
    if (!action || action === 'search') {
      if (!q) return res.status(400).json({ error: 'Нет запроса' });
      const d = await spFetch('/search?q=' + encodeURIComponent(q) + '&type=track,artist&limit=8&market=US');
      const tracks = (d.tracks?.items || []).map(mapTrack);
      const foundArtists = (d.artists?.items || []).slice(0, 3).map(a => ({
        id: a.id, name: a.name,
        cover: a.images[0]?.url || null,
        genres: a.genres?.slice(0, 2) || [],
        followers: a.followers?.total || 0,
      }));
      return res.status(200).json({ tracks, artists: foundArtists });
    }

    // ── СТРАНИЦА АРТИСТА ──
    if (action === 'artist') {
      if (!artist_id) return res.status(400).json({ error: 'Нет artist_id' });

      // ВСЁ параллельно: инфо + топ треки (2 market) + альбомы (2 market)
      const [artistData, topUS, topRU, albumsUS, albumsRU] = await Promise.all([
        spFetch('/artists/' + artist_id),
        spFetch('/artists/' + artist_id + '/top-tracks?market=US'),
        spFetch('/artists/' + artist_id + '/top-tracks?market=RU'),
        spFetch('/artists/' + artist_id + '/albums?market=US&limit=20&include_groups=album,single,appears_on'),
        spFetch('/artists/' + artist_id + '/albums?market=RU&limit=20&include_groups=album,single,appears_on'),
      ]);

      let topTracks = topUS.tracks?.length ? topUS.tracks : topRU.tracks?.length ? topRU.tracks : [];

      // Фолбэк — ищем треки через search
      if (!topTracks.length && artistData.name) {
        const sf = await spFetch('/search?q=' + encodeURIComponent('artist:"' + artistData.name + '"') + '&type=track&limit=10&market=RU');
        topTracks = sf.tracks?.items || [];
      }

      let albumItems = albumsUS.items?.length ? albumsUS.items : albumsRU.items || [];

      const artist = {
        id: artistData.id, name: artistData.name,
        cover: artistData.images[0]?.url || null,
        genres: artistData.genres?.slice(0, 3) || [],
        followers: artistData.followers?.total || 0,
      };
      const mappedTop = topTracks.slice(0, 10).map(mapTrack);
      // Фильтруем топ треки — только от этого артиста
      const filteredTop = mappedTop.filter(t => t.artist_id === artist_id || t.artist.toLowerCase() === artistData.name?.toLowerCase());
      const allAlbums = albumItems.map(mapAlbum);
      return res.status(200).json({
        artist,
        topTracks: filteredTop.length ? filteredTop : mappedTop,
        albums: allAlbums.filter(a => a.type === 'album'),
        singles: allAlbums.filter(a => a.type === 'single').slice(0, 8),
        appearances: allAlbums.filter(a => a.type === 'compilation' || (a.type !== 'album' && a.type !== 'single')).slice(0, 6),
      });
    }

    // ── ТРЕКИ АЛЬБОМА ──
    if (action === 'album_tracks') {
      if (!album_id) return res.status(400).json({ error: 'Нет album_id' });
      const [albumData, tracksData] = await Promise.all([
        spFetch('/albums/' + album_id),
        spFetch('/albums/' + album_id + '/tracks?limit=50'),
      ]);
      const album = mapAlbum(albumData);
      album.cover = albumData.images[0]?.url || null;
      album.artist = albumData.artists[0]?.name || '';
      album.artist_id = albumData.artists[0]?.id || '';
      album.label = albumData.label || '';
      const tracks = (tracksData.items || []).map(t => ({
        id: t.id, name: t.name,
        artist: t.artists[0].name, artist_id: t.artists[0].id,
        album: albumData.name, album_id,
        cover: albumData.images[0]?.url || null,
        dur: Math.floor(t.duration_ms/60000)+':'+String(Math.floor((t.duration_ms%60000)/1000)).padStart(2,'0'),
        track_number: t.track_number,
      }));
      return res.status(200).json({ album, tracks });
    }

    // ── ВОЛНА — первый запуск (Claude 1 раз) ──
    if (action === 'wave') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        const names = artists.split(',').slice(0, 6).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(400).json({ error: 'Нет артистов' });

      // ПАРАЛЛЕЛЬНО: Claude (15-20 артистов) + Spotify related (8-12 артистов) + seed треки
      const [aiNames, relGroups, famTracks] = await Promise.all([
        // Claude — просим МНОГО артистов за 1 запрос
        (async () => {
          try {
            const infos = await Promise.all(seedIds.slice(0, 4).map(id => getArtistInfo(id).catch(() => null)));
            const desc = infos.filter(Boolean).map(a => `${a.name} (${(a.genres || []).slice(0,2).join(', ') || 'музыка'})`).join(', ');
            return await aiRecommend(desc, 'wave');
          } catch(e) { return []; }
        })(),
        // Spotify related от всех seed
        Promise.all(seedIds.slice(0, 4).map(id => getRelated(id).catch(() => []))),
        // Seed треки (знакомые)
        Promise.all(seedIds.slice(0, 4).map(id => getTopTracks(id))),
      ]);

      // Собираем огромный пул артистов: Claude + related + seed
      const allArtistIds = new Set(seedIds);
      const artistPool = [...seedIds];

      // Добавляем related
      for (const group of relGroups) {
        for (const a of group) {
          if (!allArtistIds.has(a.id)) { allArtistIds.add(a.id); artistPool.push(a.id); }
        }
      }

      // Claude вернул {artist, track} пары — ищем конкретные треки + artist IDs
      let aiTracks = [];
      if (aiNames.length) {
        // Параллельно ищем все треки от Claude
        const searchResults = await Promise.all(aiNames.slice(0, 15).map(async rec => {
          try {
            const q = rec.track
              ? `${rec.track} ${rec.artist}`
              : rec.artist;
            const s = await spFetch('/search?q=' + encodeURIComponent(q) + '&type=track&limit=2&market=RU');
            const found = s.tracks?.items?.[0];
            if (found) {
              // Добавляем артиста в пул
              const aid = found.artists[0]?.id;
              if (aid && !allArtistIds.has(aid)) { allArtistIds.add(aid); artistPool.push(aid); }
              return mapTrack(found);
            }
            return null;
          } catch(e) { return null; }
        }));
        aiTracks = searchResults.filter(Boolean);
      }

      // Берём треки от случайной выборки из пула (не от всех — слишком долго)
      const shuffledPool = artistPool.sort(() => Math.random() - 0.5);
      const trackBatch = await Promise.all(shuffledPool.slice(0, 10).map(id => getTopTracks(id)));

      // Собираем и перемешиваем: AI треки + пул + знакомые
      const seen = new Set();
      const artistCount = {};
      const waveTracks = [
        ...aiTracks,
        ...trackBatch.flat(),
        ...famTracks.flat(),
      ]
        .filter(t => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          const key = t.artist_id || t.artist;
          artistCount[key] = (artistCount[key] || 0) + 1;
          return artistCount[key] <= 2;
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 20);

      // Возвращаем треки + весь пул артистов для wave_more
      return res.status(200).json({
        tracks: waveTracks,
        artist_pool: [...allArtistIds], // клиент сохранит для дозагрузки
      });
    }

    // ── ВОЛНА — дозагрузка (БЕЗ Claude, только Spotify) ──
    if (action === 'wave_more') {
      // Клиент присылает пул артистов и уже проигранные track IDs
      const poolIds = (artist_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      const playedIds = new Set((req.query.played || '').split(',').filter(Boolean));
      if (!poolIds.length) return res.status(200).json({ tracks: [] });

      // Берём случайных 6 артистов из пула
      const shuffled = poolIds.sort(() => Math.random() - 0.5).slice(0, 6);
      const trackBatch = await Promise.all(shuffled.map(id => getTopTracks(id)));

      // Также расширяем пул через related (бесплатно)
      let newArtistIds = [];
      try {
        const randomSeed = shuffled[Math.floor(Math.random() * shuffled.length)];
        const rels = await getRelated(randomSeed);
        const poolSet = new Set(poolIds);
        for (const a of rels) {
          if (!poolSet.has(a.id) && newArtistIds.length < 4) {
            newArtistIds.push(a.id);
          }
        }
        // Берём треки от новых артистов
        if (newArtistIds.length) {
          const newTracks = await Promise.all(newArtistIds.slice(0, 3).map(id => getTopTracks(id)));
          trackBatch.push(...newTracks);
        }
      } catch(e) {}

      const seen = new Set();
      const artistCount = {};
      const moreTracks = trackBatch.flat()
        .filter(t => {
          if (seen.has(t.id) || playedIds.has(t.id)) return false;
          seen.add(t.id);
          const key = t.artist_id || t.artist;
          artistCount[key] = (artistCount[key] || 0) + 1;
          return artistCount[key] <= 2;
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);

      return res.status(200).json({
        tracks: moreTracks,
        new_artists: newArtistIds, // клиент добавит в пул
      });
    }

    // ── НОВИНКИ ЛЮБИМЫХ АРТИСТОВ (без Claude, только Spotify) ──
    if (action === 'new_releases') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
      }
      if (!seedIds.length) return res.status(200).json({ releases: [] });

      // Берём свежие релизы каждого артиста — сначала 90 дней, если пусто то год
      const results = await Promise.all(seedIds.map(async id => {
        try {
          const [dRU, dUS] = await Promise.all([
            spFetch('/artists/' + id + '/albums?market=RU&limit=10&include_groups=single,album'),
            spFetch('/artists/' + id + '/albums?market=US&limit=10&include_groups=single,album'),
          ]);
          const items = dRU.items?.length ? dRU.items : dUS.items || [];
          if (!items.length) return null;

          const now = Date.now();
          const sorted = items
            .filter(a => a.release_date)
            .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));

          // Сначала пробуем 90 дней, потом 365 дней как fallback
          let album = sorted.find(a => {
            const t = new Date(a.release_date).getTime();
            return (now - t) < 90 * 24 * 60 * 60 * 1000;
          });

          if (!album) {
            album = sorted.find(a => {
              const t = new Date(a.release_date).getTime();
              return (now - t) < 365 * 24 * 60 * 60 * 1000;
            });
          }

          if (!album) return null;

          return {
            id: album.id,
            name: album.name,
            artist: album.artists[0]?.name || '',
            artist_id: album.artists[0]?.id || id,
            requested_artist_id: id, // кто нас привёл
            cover: album.images?.[0]?.url || null,
            year: album.release_date?.slice(0, 4) || '',
            release_date: album.release_date || '',
            type: album.album_type,
            total_tracks: album.total_tracks,
          };
        } catch(e) { return null; }
      }));

      // Дедуплицируем по album_id И по artist_id (чтобы не было 3 релиза одного артиста)
      const seenAlbums = new Set();
      const seenArtists = new Set();
      const releases = results
        .filter(Boolean)
        .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
        .filter(r => {
          if (seenAlbums.has(r.id)) return false;
          if (seenArtists.has(r.artist_id)) return false;
          seenAlbums.add(r.id);
          seenArtists.add(r.artist_id);
          return true;
        });

      return res.status(200).json({ releases });
    }

    // ── AI РЕКОМЕНДАЦИИ (Открытия) — Claude 1 раз в день ──
    if (action === 'ai_recommend') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        const names = artists.split(',').slice(0, 4).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(200).json({ tracks: [] });

      // ПАРАЛЛЕЛЬНО: Claude (конкретные треки) + Spotify related (фолбэк)
      const [aiRecs, relTracks] = await Promise.all([
        // Claude путь — получаем конкретные artist+track пары
        (async () => {
          try {
            const infos = await Promise.all(seedIds.slice(0, 4).map(id => getArtistInfo(id).catch(() => null)));
            const desc = infos.filter(Boolean).map(a => `${a.name} (${(a.genres||[]).slice(0,2).join(', ')||'музыка'})`).join(', ');
            const recs = await aiRecommend(desc, 'discovery');
            if (!recs.length) return [];
            // Ищем конкретные треки на Spotify
            const found = await Promise.all(recs.slice(0, 15).map(async rec => {
              try {
                const q = rec.track ? `${rec.track} ${rec.artist}` : rec.artist;
                const s = await spFetch('/search?q=' + encodeURIComponent(q) + '&type=track&limit=1&market=RU');
                return s.tracks?.items?.[0] ? mapTrack(s.tracks.items[0]) : null;
              } catch(e) { return null; }
            }));
            return found.filter(Boolean);
          } catch(e) { return []; }
        })(),
        // Spotify related фолбэк
        (async () => {
          try {
            const rg = await Promise.all(seedIds.slice(0,2).map(id => getRelated(id)));
            const sf = new Set(seedIds);
            const relIds = [];
            for (const g of rg) for (const a of g) {
              if (!sf.has(a.id) && relIds.length < 4) { sf.add(a.id); relIds.push(a.id); }
            }
            return (await Promise.all(relIds.map(id => getTopTracks(id)))).flat();
          } catch(e) { return []; }
        })(),
      ]);

      const allTracks = aiRecs.length >= 5 ? aiRecs : [...aiRecs, ...relTracks];
      const seenT = new Set();
      const artistCount = {};
      const result = allTracks
        .filter(t => {
          if (seenT.has(t.id)) return false;
          seenT.add(t.id);
          const key = t.artist_id || t.artist;
          artistCount[key] = (artistCount[key] || 0) + 1;
          return artistCount[key] <= 2;
        })
        .slice(0, parseInt(limit));
      return res.status(200).json({ tracks: result });
    }

    // ── РЕКОМЕНДОВАННЫЕ АЛЬБОМЫ (без Claude, только Spotify) ──
    if (action === 'rec_albums') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
      } else if (artists) {
        const names = artists.split(',').slice(0, 6).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(200).json({ albums: [] });

      // Берём топ альбомы прямо от seed артистов (related API deprecated)
      const albumResults = await Promise.all(seedIds.slice(0, 6).map(async id => {
        try {
          const [dUS, dRU] = await Promise.all([
            spFetch('/artists/' + id + '/albums?market=US&limit=5&include_groups=album'),
            spFetch('/artists/' + id + '/albums?market=RU&limit=5&include_groups=album'),
          ]);
          const items = dUS.items?.length ? dUS.items : dRU.items || [];
          if (!items.length) return null;
          // Берём самый популярный (первый) альбом
          const album = items[0];
          return {
            id: album.id, name: album.name,
            artist: album.artists[0]?.name || '',
            artist_id: id,
            cover: album.images[0]?.url || null,
            year: album.release_date?.slice(0,4) || '',
            total_tracks: album.total_tracks,
          };
        } catch { return null; }
      }));

      const seenArtists = new Set();
      const filtered = albumResults.filter(a => {
        if (!a || seenArtists.has(a.artist_id)) return false;
        seenArtists.add(a.artist_id);
        return true;
      });
      return res.status(200).json({ albums: filtered });
    }

    // ── ПОХОЖИЕ ТРЕКИ (упрощено — топ треки от seed артистов) ──
    if (action === 'related') {
      // Если передан artist_ids — берём их топ треки
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
      }

      if (seedIds.length) {
        const groups = await Promise.all(seedIds.map(id => getTopTracks(id).catch(() => [])));
        const seen = new Set();
        const artistCount = {};
        const tracks = groups.flat()
          .sort(() => Math.random() - 0.5)
          .filter(t => {
            if (seen.has(t.id)) return false;
            seen.add(t.id);
            artistCount[t.artist] = (artistCount[t.artist] || 0) + 1;
            return artistCount[t.artist] <= 3;
          })
          .slice(0, parseInt(limit));
        return res.status(200).json({ tracks });
      }

      // Старый путь: поиск по названию трека
      if (!track) return res.status(400).json({ error: 'Нет трека' });
      const fb = await spFetch('/search?q=' + encodeURIComponent(track) + '&type=track&limit=' + limit + '&market=US');
      return res.status(200).json({ tracks: (fb.tracks?.items || []).map(mapTrack) });
    }

    // ── ДИАГНОСТИКА ──
    if (action === 'debug') {
      const results = {
        spotify_token: false,
        spotify_search: false,
        claude_api_key: false,
        claude_api: false,
        claude_response: null,
        claude_cached: false,
        errors: [],
      };

      // Проверяем Spotify
      try {
        const token = await getSpotifyToken();
        results.spotify_token = !!token;
        const s = await spFetch('/search?q=Drake&type=artist&limit=1');
        results.spotify_search = !!(s.artists?.items?.length);
      } catch(e) { results.errors.push('Spotify: ' + e.message); }

      // Проверяем Claude API
      results.claude_api_key = !!(process.env.ANTHROPIC_API_KEY);
      if (results.claude_api_key) {
        try {
          // Делаем тестовый запрос
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 256,
              system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: 'Пользователь слушает: Скриптонит (hip hop), SALUKI (hip hop). JSON: {"artists":["Имя1","Имя2","Имя3"]}' }]
            })
          });
          const d = await r.json();
          if (d.error) { results.errors.push('Claude error: ' + JSON.stringify(d.error)); }
          else {
            const text = d.content?.[0]?.text || '';
            const m2 = text.match(/\{[\s\S]*?\}/);
            const parsed = JSON.parse(m2 ? m2[0] : '{}');
            results.claude_api = (parsed.artists?.length || 0) > 0;
            results.claude_response = parsed.artists || text;
            // Проверяем кеширование
            results.claude_cached = d.usage?.cache_read_input_tokens > 0;
            results.usage = d.usage;
          }
        } catch(e) { results.errors.push('Claude: ' + e.message); }
      } else {
        results.errors.push('ANTHROPIC_API_KEY не установлен');
      }

      return res.status(200).json(results);
    }

    return res.status(400).json({ error: 'Неизвестный action' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
