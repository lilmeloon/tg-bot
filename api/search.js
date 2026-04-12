export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, action, artists, artist_ids, track, artist_id, album_id, limit = 10 } = req.query;

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
    const album = t.album;
    return {
      id: t.id,
      name: t.name,
      artist: t.artists[0].name,
      artist_id: t.artists[0].id,
      album: album?.name || '',
      album_id: album?.id || '',
      cover: album?.images?.[0]?.url || null,
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

  // Топ-3 трека артиста по его Spotify ID
  async function getTopTracks(id) {
    const d = await spFetch('/artists/' + id + '/top-tracks?market=US');
    return (d.tracks || []).slice(0, 3).map(mapTrack);
  }

  // Related artists по Spotify ID — точно, без текстового поиска
  async function getRelated(id) {
    const d = await spFetch('/artists/' + id + '/related-artists');
    return (d.artists || []).slice(0, 8);
  }

  // Поиск ID по имени — только как последний фолбэк
  async function findArtistId(name) {
    const d = await spFetch('/search?q=' + encodeURIComponent(name) + '&type=artist&limit=1&market=US');
    return d.artists?.items?.[0]?.id || null;
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
      const [artistData, topData, albumsData] = await Promise.all([
        spFetch('/artists/' + artist_id),
        spFetch('/artists/' + artist_id + '/top-tracks?market=US'),
        spFetch('/artists/' + artist_id + '/albums?market=US&limit=20&include_groups=album,single'),
      ]);
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
        singles: allAlbums.filter(a => a.type === 'single').slice(0, 6),
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

    // ── ПОХОЖИЕ ТРЕКИ — по точному artist_id если есть, иначе поиск ──
    if (action === 'related') {
      if (!track) return res.status(400).json({ error: 'Нет трека' });

      // track формат: "artist_id:ArtistName - TrackName" или просто "ArtistName - TrackName"
      let targetId = null;
      let artistName = track;

      if (track.startsWith('id:')) {
        // Новый формат: передаём точный ID
        const parts = track.slice(3).split('|');
        targetId = parts[0];
        artistName = parts[1] || '';
      } else {
        artistName = track.split(' - ')[0].trim();
        targetId = await findArtistId(artistName);
      }

      if (!targetId) {
        const fallback = await spFetch('/search?q=' + encodeURIComponent(track) + '&type=track&limit=10&market=US');
        return res.status(200).json({ tracks: (fallback.tracks?.items || []).map(mapTrack) });
      }

      const related = await getRelated(targetId);
      const trackGroups = await Promise.all(related.slice(0, 4).map(a => getTopTracks(a.id)));
      const seen = new Set();
      const result = trackGroups.flat()
        .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
        .slice(0, parseInt(limit));
      return res.status(200).json({ tracks: result });
    }

    // ── AI РЕКОМЕНДАЦИИ — используем точные Spotify IDs из онбординга ──
    if (action === 'ai_recommend') {
      // Принимаем либо artist_ids (точные ID через запятую) либо artists (имена — фолбэк)
      let seedIds = [];

      if (artist_ids) {
        // Точные ID — используем напрямую без поиска
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        // Имена — ищем ID (медленнее, менее точно)
        const names = artists.split(',').slice(0, 4).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }

      if (!seedIds.length) return res.status(200).json({ tracks: [], _debug: 'no seed ids' });

      // Related artists для первых 3 seed артистов параллельно
      const relatedGroups = await Promise.all(seedIds.slice(0, 3).map(id => getRelated(id)));

      // Собираем уникальных артистов которых нет в seed
      const seen = new Set(seedIds);
      const discovery = [];
      for (const group of relatedGroups) {
        for (const a of group) {
          if (!seen.has(a.id) && discovery.length < 8) {
            seen.add(a.id);
            discovery.push(a);
          }
        }
      }

      // Топ треки discovery артистов параллельно
      const trackGroups = await Promise.all(discovery.slice(0, 8).map(a => getTopTracks(a.id)));
      const seenT = new Set();
      const result = trackGroups.flat()
        .sort(() => Math.random() - 0.5)
        .filter(t => { if (seenT.has(t.id)) return false; seenT.add(t.id); return true; })
        .slice(0, parseInt(limit));
      return res.status(200).json({ tracks: result });
    }

    // ── РЕКОМЕНДОВАННЫЕ АЛЬБОМЫ — по точным IDs ──
    if (action === 'rec_albums') {
      let seedIds = [];

      if (artist_ids) {
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
      } else if (artists) {
        const names = artists.split(',').slice(0, 3).map(s => s.trim());
        seedIds = (await Promise.all(names.map(findArtistId))).filter(Boolean);
      }

      if (!seedIds.length) return res.status(200).json({ albums: [] });

      // Related для первых 2 seed артистов
      const relatedGroups = await Promise.all(seedIds.slice(0, 2).map(id => getRelated(id)));
      const seen = new Set(seedIds);
      const targets = [];
      for (const group of relatedGroups) {
        for (const a of group) {
          if (!seen.has(a.id) && targets.length < 6) {
            seen.add(a.id);
            targets.push(a);
          }
        }
      }

      // Последний альбом каждого артиста параллельно
      const albumResults = await Promise.all(targets.slice(0, 6).map(async a => {
        try {
          const d = await spFetch('/artists/' + a.id + '/albums?market=US&limit=3&include_groups=album');
          const album = d.items?.[0];
          if (!album) return null;
          return {
            id: album.id, name: album.name,
            artist: album.artists[0]?.name || a.name,
            artist_id: a.id,
            cover: album.images[0]?.url || null,
            year: album.release_date?.slice(0, 4) || '',
            total_tracks: album.total_tracks,
          };
        } catch { return null; }
      }));
      return res.status(200).json({ albums: albumResults.filter(Boolean) });
    }

    // ── ВОЛНА — по точным IDs, Claude Haiku для разнообразия ──
    if (action === 'wave') {
      let seedIds = [];
      let artistNames = [];

      if (artist_ids) {
        // Точные IDs — используем напрямую
        seedIds = artist_ids.split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
      } else if (artists) {
        artistNames = artists.split(',').slice(0, 6).map(s => s.trim());
        // Ищем IDs по именам (фолбэк)
        seedIds = (await Promise.all(artistNames.map(findArtistId))).filter(Boolean);
      }

      if (!seedIds.length) return res.status(400).json({ error: 'Нет артистов' });

      // Related artists для всех seed параллельно
      const relatedGroups = await Promise.all(seedIds.slice(0, 4).map(id => getRelated(id)));

      // Собираем discovery (не входят в seed)
      const seen = new Set(seedIds);
      const discovery = [];
      for (const group of relatedGroups) {
        for (const a of group) {
          if (!seen.has(a.id) && discovery.length < 10) {
            seen.add(a.id);
            discovery.push(a);
          }
        }
      }

      // Треки: seed артисты (familiar) + discovery параллельно
      const [familiarTracks, discoveryTracks] = await Promise.all([
        Promise.all(seedIds.slice(0, 3).map(id => getTopTracks(id))),
        Promise.all(discovery.slice(0, 7).map(a => getTopTracks(a.id))),
      ]);

      let waveTracks = [
        ...familiarTracks.flat().map(t => ({ ...t, _layer: 'familiar' })),
        ...discoveryTracks.flat().map(t => ({ ...t, _layer: 'discovery' })),
      ];

      // Перемешиваем — больше discovery, меньше familiar
      const seenW = new Set();
      waveTracks = waveTracks
        .filter(t => { if (seenW.has(t.id)) return false; seenW.add(t.id); return true; })
        .sort(() => Math.random() - 0.5)
        .slice(0, parseInt(limit) || 20);

      return res.status(200).json({ tracks: waveTracks });
    }

    return res.status(400).json({ error: 'Неизвестный action' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
