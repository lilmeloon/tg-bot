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
    let d = await spFetch('/artists/' + id + '/top-tracks?market=US');
    if (!d.tracks?.length) {
      d = await spFetch('/artists/' + id + '/top-tracks?market=RU');
    }
    if (!d.tracks?.length) {
      d = await spFetch('/artists/' + id + '/top-tracks?market=KZ');
    }
    return (d.tracks || []).slice(0, 3).map(mapTrack);
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
    const d = await spFetch('/search?q=' + encodeURIComponent(name) + '&type=artist&limit=1&market=US');
    return d.artists?.items?.[0]?.id || null;
  }

  // ── CLAUDE — контентная фильтрация ──
  // Принимает список артистов с жанрами, возвращает похожих
  async function claudeRecommend(artistsWithGenres, mode = 'discovery') {
    const prompt = mode === 'wave'
      ? `Пользователь слушает этих артистов: ${artistsWithGenres}.
Подбери персональное радио — похожих артистов в том же стиле и жанре, включая малоизвестных.
Ответь ТОЛЬКО JSON без объяснений: {"artists":["Имя1","Имя2","Имя3","Имя4","Имя5","Имя6","Имя7","Имя8"]}`
      : `Пользователь слушает: ${artistsWithGenres}.
Порекомендуй артистов для открытий — похожий стиль но другие имена, которые он скорее всего не слышал.
Ответь ТОЛЬКО JSON: {"artists":["Имя1","Имя2","Имя3","Имя4","Имя5","Имя6"]}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await r.json();
    const text = d.content?.[0]?.text || '{}';
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
      const [artistData, albumsData] = await Promise.all([
        spFetch('/artists/' + artist_id),
        spFetch('/artists/' + artist_id + '/albums?market=US&limit=20&include_groups=album,single,appears_on'),
      ]);

      // Топ треки — пробуем несколько рынков
      let topData = await spFetch('/artists/' + artist_id + '/top-tracks?market=US');
      if (!topData.tracks?.length) topData = await spFetch('/artists/' + artist_id + '/top-tracks?market=RU');
      if (!topData.tracks?.length) topData = await spFetch('/artists/' + artist_id + '/top-tracks?market=KZ');

      const artist = {
        id: artistData.id, name: artistData.name,
        cover: artistData.images[0]?.url || null,
        genres: artistData.genres?.slice(0, 3) || [],
        followers: artistData.followers?.total || 0,
      };
      const topTracks = (topData.tracks || []).slice(0, 10).map(mapTrack);
      const allAlbums = (albumsData.items || []).map(mapAlbum);
      return res.status(200).json({
        artist, topTracks,
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

    // ── ВОЛНА — контентная фильтрация через Claude + Spotify ──
    if (action === 'wave') {
      // Получаем seed IDs (точные) или имена
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        const names = artists.split(',').slice(0, 6).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }

      if (!seedIds.length) return res.status(400).json({ error: 'Нет артистов' });

      // Получаем инфо об артистах (жанры) для Claude
      const artistInfos = await Promise.all(seedIds.slice(0, 4).map(id => getArtistInfo(id).catch(() => null)));
      const artistsDesc = artistInfos
        .filter(Boolean)
        .map(a => `${a.name} (${(a.genres || []).slice(0,2).join(', ') || 'музыка'})`)
        .join(', ');

      // Claude подбирает похожих артистов по контенту
      let claudeNames = [];
      try {
        claudeNames = await claudeRecommend(artistsDesc, 'wave');
      } catch(e) {}

      // Фолбэк — Spotify related если Claude не ответил
      if (!claudeNames.length) {
        const relGroups = await Promise.all(seedIds.slice(0, 3).map(id => getRelated(id)));
        const seenF = new Set(seedIds);
        for (const group of relGroups) {
          for (const a of group) {
            if (!seenF.has(a.id) && claudeNames.length < 8) {
              seenF.add(a.id);
              claudeNames.push(a.name);
            }
          }
        }
      }

      // Ищем ID рекомендованных артистов параллельно
      const recIds = (await Promise.all(claudeNames.slice(0, 8).map(findArtistId))).filter(Boolean);

      // Берём треки: seed (familiar) + recommended (discovery) параллельно
      const [famTracks, recTracks] = await Promise.all([
        Promise.all(seedIds.slice(0, 3).map(id => getTopTracks(id))),
        Promise.all(recIds.slice(0, 8).map(id => getTopTracks(id))),
      ]);

      const seen = new Set();
      let waveTracks = [
        ...recTracks.flat().map(t => ({ ...t, _layer: 'discovery' })),
        ...famTracks.flat().map(t => ({ ...t, _layer: 'familiar' })),
      ].filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
       .sort(() => Math.random() - 0.5)
       .slice(0, parseInt(limit));

      return res.status(200).json({ tracks: waveTracks });
    }

    // ── AI РЕКОМЕНДАЦИИ — контентная фильтрация ──
    if (action === 'ai_recommend') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        const names = artists.split(',').slice(0, 4).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(200).json({ tracks: [] });

      // Получаем жанры для точного анализа
      const infos = await Promise.all(seedIds.slice(0, 4).map(id => getArtistInfo(id).catch(() => null)));
      const desc = infos.filter(Boolean)
        .map(a => `${a.name} (${(a.genres||[]).slice(0,2).join(', ')||'музыка'})`)
        .join(', ');

      // Claude подбирает открытия
      let recNames = [];
      try { recNames = await claudeRecommend(desc, 'discovery'); } catch(e) {}

      // Фолбэк
      if (!recNames.length) {
        const rg = await Promise.all(seedIds.slice(0,2).map(id => getRelated(id)));
        const sf = new Set(seedIds);
        for (const g of rg) for (const a of g) {
          if (!sf.has(a.id) && recNames.length < 6) { sf.add(a.id); recNames.push(a.name); }
        }
      }

      const recIds = (await Promise.all(recNames.slice(0,6).map(findArtistId))).filter(Boolean);
      const trackGroups = await Promise.all(recIds.map(id => getTopTracks(id)));
      const seenT = new Set();
      const artistCount = {};
      const result = trackGroups.flat()
        .sort(() => Math.random() - 0.5)
        .filter(t => {
          if (seenT.has(t.id)) return false;
          seenT.add(t.id);
          // Максимум 2 трека от одного артиста
          artistCount[t.artist] = (artistCount[t.artist] || 0) + 1;
          return artistCount[t.artist] <= 2;
        })
        .slice(0, parseInt(limit));
      return res.status(200).json({ tracks: result });
    }

    // ── РЕКОМЕНДОВАННЫЕ АЛЬБОМЫ ──
    if (action === 'rec_albums') {
      let seedIds = [];
      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
      } else if (artists) {
        const names = artists.split(',').slice(0, 3).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }
      if (!seedIds.length) return res.status(200).json({ albums: [] });

      const infos = await Promise.all(seedIds.slice(0,3).map(id => getArtistInfo(id).catch(()=>null)));
      const desc = infos.filter(Boolean)
        .map(a => `${a.name} (${(a.genres||[]).slice(0,2).join(', ')||'музыка'})`)
        .join(', ');

      let recNames = [];
      try { recNames = await claudeRecommend(desc, 'discovery'); } catch(e) {}
      if (!recNames.length) {
        const rg = await Promise.all(seedIds.slice(0,2).map(id=>getRelated(id)));
        const sf = new Set(seedIds);
        for (const g of rg) for (const a of g) {
          if (!sf.has(a.id) && recNames.length < 6) { sf.add(a.id); recNames.push(a.name); }
        }
      }

      const recIds = (await Promise.all(recNames.slice(0,6).map(findArtistId))).filter(Boolean);
      const albumResults = await Promise.all(recIds.map(async id => {
        try {
          const d = await spFetch('/artists/' + id + '/albums?market=US&limit=3&include_groups=album');
          const album = d.items?.[0];
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
      return res.status(200).json({ albums: albumResults.filter(Boolean) });
    }

    // ── ПОХОЖИЕ ТРЕКИ ──
    if (action === 'related') {
      if (!track) return res.status(400).json({ error: 'Нет трека' });
      let targetId = null;
      if (track.startsWith('id:')) {
        // Формат: id:ARTIST_ID|name
        targetId = track.slice(3).split('|')[0];
      } else {
        // Формат: "Artist - Track"
        const artistName = track.split(' - ')[0].trim();
        // Сначала ищем артиста
        const searchData = await spFetch('/search?q=' + encodeURIComponent(artistName) + '&type=artist&limit=1&market=US');
        targetId = searchData.artists?.items?.[0]?.id || null;
      }
      if (!targetId) {
        // Последний фолбэк — ищем как трек
        const fb = await spFetch('/search?q='+encodeURIComponent(track)+'&type=track&limit=10&market=US');
        return res.status(200).json({ tracks: (fb.tracks?.items||[]).map(mapTrack) });
      }
      const related = await getRelated(targetId);
      if (!related.length) {
        // Если нет related, ищем по жанрам артиста
        const artistInfo = await getArtistInfo(targetId).catch(() => null);
        if (artistInfo?.genres?.length) {
          const genre = artistInfo.genres[0];
          const genreSearch = await spFetch('/search?q=' + encodeURIComponent('genre:' + genre) + '&type=track&limit=' + limit + '&market=US');
          return res.status(200).json({ tracks: (genreSearch.tracks?.items||[]).map(mapTrack) });
        }
        return res.status(200).json({ tracks: [] });
      }
      const groups = await Promise.all(related.slice(0,6).map(a=>getTopTracks(a.id)));
      const seen = new Set();
      return res.status(200).json({
        tracks: groups.flat()
          .filter(t=>{ if(seen.has(t.id)) return false; seen.add(t.id); return true; })
          .sort(() => Math.random() - 0.5)
          .slice(0, parseInt(limit))
      });
    }

    return res.status(400).json({ error: 'Неизвестный action' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
