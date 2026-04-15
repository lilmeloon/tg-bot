export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, action, artists, artist_ids, track, artist_id, album_id, limit = 20 } = req.query;

  // ── SPOTIFY TOKEN ──
  let _token = null;
  async function getSpotifyToken() {
    if (_token) return _token;
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
    _token = d.access_token;
    return _token;
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
    // Параллельно пробуем US и RU — берём первый непустой
    const [dUS, dRU] = await Promise.all([
      spFetch('/artists/' + id + '/top-tracks?market=US'),
      spFetch('/artists/' + id + '/top-tracks?market=RU'),
    ]);
    const d = dUS.tracks?.length ? dUS : dRU.tracks?.length ? dRU : null;
    if (d) return (d.tracks || []).slice(0, 3).map(mapTrack);

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

  // ── GEMINI — контентная фильтрация ──
  // Принимает список артистов с жанрами, возвращает похожих
  async function aiRecommend(artistsWithGenres, mode = 'discovery') {
    const prompt = mode === 'wave'
      ? `Пользователь слушает этих артистов: ${artistsWithGenres}.
Подбери персональное радио — ТОЛЬКО артистов в том же стиле, жанре и языке. Если пользователь слушает русский рэп — рекомендуй русских рэперов. Если слушает поп — рекомендуй поп. Не смешивай языки и жанры.
Ответь ТОЛЬКО JSON без объяснений: {"artists":["Имя1","Имя2","Имя3","Имя4","Имя5","Имя6","Имя7","Имя8"]}`
      : `Пользователь слушает: ${artistsWithGenres}.
Порекомендуй артистов для открытий — СТРОГО в том же жанре и на том же языке. Если пользователь слушает русский рэп, рекомендуй ТОЛЬКО русских рэперов. Не рекомендуй артистов из совершенно других жанров.
Ответь ТОЛЬКО JSON: {"artists":["Имя1","Имя2","Имя3","Имя4","Имя5","Имя6"]}`;

    const apiKey = process.env.GEMINI_API_KEY || '';
    const model = 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 256,
        }
      })
    });
    const d = await r.json();
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const m = text.match(/\{[\s\S]*?\}/);
    const parsed = JSON.parse(m ? m[0] : '{}');
    return parsed.artists || [];
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

    // ── ВОЛНА — быстрый старт ──
    if (action === 'wave') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        const names = artists.split(',').slice(0, 6).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(400).json({ error: 'Нет артистов' });

      // ПАРАЛЛЕЛЬНО: знакомые треки + Gemini рекомендации + Spotify related
      const [famTracks, aiResult, relResult] = await Promise.all([
        // 1. Знакомые треки (сразу начинаем)
        Promise.all(seedIds.slice(0, 3).map(id => getTopTracks(id))),
        // 2. Gemini рекомендации
        (async () => {
          try {
            const infos = await Promise.all(seedIds.slice(0, 3).map(id => getArtistInfo(id).catch(() => null)));
            const desc = infos.filter(Boolean).map(a => `${a.name} (${(a.genres || []).slice(0,2).join(', ') || 'музыка'})`).join(', ');
            const names = await aiRecommend(desc, 'wave');
            if (!names.length) return [];
            const ids = (await Promise.all(names.slice(0, 6).map(findArtistId))).filter(Boolean);
            return (await Promise.all(ids.map(id => getTopTracks(id)))).flat();
          } catch(e) { return []; }
        })(),
        // 3. Spotify related (быстрый фолбэк)
        (async () => {
          try {
            const rels = await Promise.all(seedIds.slice(0, 2).map(id => getRelated(id)));
            const seen = new Set(seedIds);
            const relIds = [];
            for (const group of rels) {
              for (const a of group) {
                if (!seen.has(a.id) && relIds.length < 6) { seen.add(a.id); relIds.push(a.id); }
              }
            }
            return (await Promise.all(relIds.slice(0, 4).map(id => getTopTracks(id)))).flat();
          } catch(e) { return []; }
        })(),
      ]);

      // Собираем: AI рекомендации > Spotify related > знакомые
      const recTracks = aiResult.length ? aiResult : relResult;
      const seen = new Set();
      const artistCount = {};
      let waveTracks = [
        ...recTracks.map(t => ({ ...t, _layer: 'discovery' })),
        ...famTracks.flat().map(t => ({ ...t, _layer: 'familiar' })),
      ].filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        const key = t.artist_id || t.artist;
        artistCount[key] = (artistCount[key] || 0) + 1;
        return artistCount[key] <= 3;
      })
       .sort(() => Math.random() - 0.5)
       .slice(0, parseInt(limit));

      return res.status(200).json({ tracks: waveTracks });
    }

    // ── AI РЕКОМЕНДАЦИИ — быстрые ──
    if (action === 'ai_recommend') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        const names = artists.split(',').slice(0, 4).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(200).json({ tracks: [] });

      // ПАРАЛЛЕЛЬНО: Gemini + Spotify related
      const [aiTracks, relTracks] = await Promise.all([
        // Gemini путь
        (async () => {
          try {
            const infos = await Promise.all(seedIds.slice(0, 3).map(id => getArtistInfo(id).catch(() => null)));
            const desc = infos.filter(Boolean).map(a => `${a.name} (${(a.genres||[]).slice(0,2).join(', ')||'музыка'})`).join(', ');
            const recNames = await aiRecommend(desc, 'discovery');
            if (!recNames.length) return [];
            const recIds = (await Promise.all(recNames.slice(0,6).map(findArtistId))).filter(Boolean);
            return (await Promise.all(recIds.map(id => getTopTracks(id)))).flat();
          } catch(e) { return []; }
        })(),
        // Spotify related путь (быстрый фолбэк)
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

      // Предпочитаем Gemini, фолбэк на related
      const allTracks = aiTracks.length >= 3 ? aiTracks : [...aiTracks, ...relTracks];
      const seenT = new Set();
      const artistCount = {};
      const result = allTracks
        .sort(() => Math.random() - 0.5)
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

    // ── РЕКОМЕНДОВАННЫЕ АЛЬБОМЫ — быстрые ──
    if (action === 'rec_albums') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
      } else if (artists) {
        const names = artists.split(',').slice(0, 3).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(200).json({ albums: [] });

      // ПАРАЛЛЕЛЬНО: Gemini + related для альбомов
      const [aiIds, relIds] = await Promise.all([
        (async () => {
          try {
            const infos = await Promise.all(seedIds.slice(0,3).map(id => getArtistInfo(id).catch(()=>null)));
            const desc = infos.filter(Boolean).map(a => `${a.name} (${(a.genres||[]).slice(0,2).join(', ')||'музыка'})`).join(', ');
            const recNames = await aiRecommend(desc, 'discovery');
            return (await Promise.all(recNames.slice(0,6).map(findArtistId))).filter(Boolean);
          } catch(e) { return []; }
        })(),
        (async () => {
          try {
            const rg = await Promise.all(seedIds.slice(0,2).map(id=>getRelated(id)));
            const sf = new Set(seedIds);
            const ids = [];
            for (const g of rg) for (const a of g) {
              if (!sf.has(a.id) && ids.length < 4) { sf.add(a.id); ids.push(a.id); }
            }
            return ids;
          } catch(e) { return []; }
        })(),
      ]);

      const allIds = aiIds.length >= 3 ? aiIds : [...new Set([...aiIds, ...relIds])];
      const albumResults = await Promise.all(allIds.slice(0, 6).map(async id => {
        try {
          const [dUS, dRU] = await Promise.all([
            spFetch('/artists/' + id + '/albums?market=US&limit=3&include_groups=album'),
            spFetch('/artists/' + id + '/albums?market=RU&limit=3&include_groups=album'),
          ]);
          const items = dUS.items?.length ? dUS.items : dRU.items || [];
          const album = items[0];
          if (!album) return null;
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

      // Фильтруем дубли по артисту
      const seenArtists = new Set();
      const filtered = albumResults.filter(a => {
        if (!a || seenArtists.has(a.artist_id)) return false;
        seenArtists.add(a.artist_id);
        return true;
      });
      return res.status(200).json({ albums: filtered });
    }

    // ── ПОХОЖИЕ ТРЕКИ ──
    if (action === 'related') {
      if (!track) return res.status(400).json({ error: 'Нет трека' });
      let targetId = null;
      if (track.startsWith('id:')) {
        targetId = track.slice(3).split('|')[0];
      } else {
        targetId = await findArtistId(track.split(' - ')[0].trim());
      }
      if (!targetId) {
        const fb = await spFetch('/search?q='+encodeURIComponent(track)+'&type=track&limit=10&market=US');
        return res.status(200).json({ tracks: (fb.tracks?.items||[]).map(mapTrack) });
      }
      const related = await getRelated(targetId);
      if (!related.length) {
        // Фолбэк — ищем по жанрам артиста
        try {
          const info = await getArtistInfo(targetId);
          if (info.genres?.length) {
            const genreQ = info.genres.slice(0, 2).join(' ');
            const gs = await spFetch('/search?q=' + encodeURIComponent(genreQ) + '&type=track&limit=' + limit + '&market=US');
            return res.status(200).json({ tracks: (gs.tracks?.items||[]).map(mapTrack) });
          }
        } catch(e) {}
        return res.status(200).json({ tracks: [] });
      }
      const groups = await Promise.all(related.slice(0,6).map(a=>getTopTracks(a.id)));
      const seen = new Set();
      const artistCount = {};
      return res.status(200).json({
        tracks: groups.flat()
          .sort(() => Math.random() - 0.5)
          .filter(t=>{
            if(seen.has(t.id)) return false;
            seen.add(t.id);
            artistCount[t.artist] = (artistCount[t.artist]||0)+1;
            return artistCount[t.artist] <= 2;
          })
          .slice(0, parseInt(limit))
      });
    }

    // ── ДИАГНОСТИКА ──
    if (action === 'debug') {
      const results = {
        spotify_token: false,
        spotify_search: false,
        gemini_api_key: false,
        gemini_api: false,
        gemini_response: null,
        errors: [],
      };

      // Проверяем Spotify
      try {
        const token = await getSpotifyToken();
        results.spotify_token = !!token;
        const s = await spFetch('/search?q=Drake&type=artist&limit=1');
        results.spotify_search = !!(s.artists?.items?.length);
      } catch(e) { results.errors.push('Spotify: ' + e.message); }

      // Проверяем Gemini API
      results.gemini_api_key = !!(process.env.GEMINI_API_KEY);
      if (results.gemini_api_key) {
        try {
          const testNames = await aiRecommend('Drake (hip hop, rap), The Weeknd (r&b, pop)', 'discovery');
          results.gemini_api = testNames.length > 0;
          results.gemini_response = testNames;
        } catch(e) { results.errors.push('Gemini: ' + e.message); }
      } else {
        results.errors.push('GEMINI_API_KEY не установлен. Получи бесплатный ключ на https://aistudio.google.com/apikey');
      }

      return res.status(200).json(results);
    }

    return res.status(400).json({ error: 'Неизвестный action' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
