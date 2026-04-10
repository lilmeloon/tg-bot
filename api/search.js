export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, action, artists, track, artist_id, album_id, limit = 10 } = req.query;

  // ── SPOTIFY TOKEN ──
  async function getSpotifyToken() {
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
    return d.access_token;
  }

  function mapTrack(t) {
    return {
      id: t.id,
      name: t.name,
      artist: t.artists[0].name,
      artist_id: t.artists[0].id,
      album: t.album?.name || '',
      album_id: t.album?.id || '',
      cover: t.album?.images[0]?.url || null,
      dur: `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}`,
      preview_url: t.preview_url,
      track_number: t.track_number || 0,
    };
  }

  function mapAlbum(a) {
    return {
      id: a.id,
      name: a.name,
      cover: a.images[0]?.url || null,
      year: a.release_date?.slice(0, 4) || '',
      total_tracks: a.total_tracks,
      type: a.album_type, // album | single | compilation
    };
  }

  async function searchSpotify(query, lim = 5) {
    const token = await getSpotifyToken();
    const r = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${lim}&market=US`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const d = await r.json();
    return d.tracks?.items?.map(mapTrack) || [];
  }

  try {

    // ── ПОИСК ──
    if (!action || action === 'search') {
      if (!q) return res.status(400).json({ error: 'Нет запроса' });
      const token = await getSpotifyToken();
      // Ищем и треки и артистов сразу
      const r = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track,artist&limit=8&market=US`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const d = await r.json();
      const tracks = d.tracks?.items?.map(mapTrack) || [];
      const artists = (d.artists?.items || []).slice(0, 3).map(a => ({
        id: a.id,
        name: a.name,
        cover: a.images[0]?.url || null,
        genres: a.genres?.slice(0, 2) || [],
        followers: a.followers?.total || 0,
      }));
      return res.status(200).json({ tracks, artists });
    }

    // ── СТРАНИЦА АРТИСТА ──
    if (action === 'artist') {
      if (!artist_id) return res.status(400).json({ error: 'Нет artist_id' });
      const token = await getSpotifyToken();

      const [artistRes, topTracksRes, albumsRes] = await Promise.all([
        fetch(`https://api.spotify.com/v1/artists/${artist_id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`https://api.spotify.com/v1/artists/${artist_id}/top-tracks?market=US`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`https://api.spotify.com/v1/artists/${artist_id}/albums?market=US&limit=20&include_groups=album,single`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);

      const artistData = await artistRes.json();
      const topData = await topTracksRes.json();
      const albumsData = await albumsRes.json();

      const artist = {
        id: artistData.id,
        name: artistData.name,
        cover: artistData.images[0]?.url || null,
        cover_sm: artistData.images[2]?.url || artistData.images[0]?.url || null,
        genres: artistData.genres?.slice(0, 3) || [],
        followers: artistData.followers?.total || 0,
      };

      const topTracks = (topData.tracks || []).slice(0, 10).map(mapTrack);

      // Группируем альбомы: сначала полные альбомы, потом синглы
      const allAlbums = (albumsData.items || []).map(mapAlbum);
      const albums = allAlbums.filter(a => a.type === 'album');
      const singles = allAlbums.filter(a => a.type === 'single').slice(0, 6);

      return res.status(200).json({ artist, topTracks, albums, singles });
    }

    // ── ТРЕКИ АЛЬБОМА ──
    if (action === 'album_tracks') {
      if (!album_id) return res.status(400).json({ error: 'Нет album_id' });
      const token = await getSpotifyToken();

      const [albumRes, tracksRes] = await Promise.all([
        fetch(`https://api.spotify.com/v1/albums/${album_id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`https://api.spotify.com/v1/albums/${album_id}/tracks?limit=50`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);

      const albumData = await albumRes.json();
      const tracksData = await tracksRes.json();

      const album = mapAlbum(albumData);
      album.cover = albumData.images[0]?.url || null;
      album.artist = albumData.artists[0]?.name || '';
      album.artist_id = albumData.artists[0]?.id || '';
      album.label = albumData.label || '';

      const tracks = (tracksData.items || []).map(t => ({
        id: t.id,
        name: t.name,
        artist: t.artists[0].name,
        artist_id: t.artists[0].id,
        album: albumData.name,
        album_id: album_id,
        cover: albumData.images[0]?.url || null,
        dur: `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}`,
        track_number: t.track_number,
      }));

      return res.status(200).json({ album, tracks });
    }

    // ── LIBAUD FM — улучшенная волна с альбомами ──
    if (action === 'wave') {
      if (!artists) return res.status(400).json({ error: 'Нет артистов' });
      const artistList = artists.split(',').slice(0, 8);

      // Claude анализирует вкусы и предлагает похожих артистов
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Пользователь слушает: ${artistList.join(', ')}.
Подбери персональное радио. Ответь ТОЛЬКО JSON объектом без объяснений:
{
  "similar": ["Artist1", "Artist2", "Artist3", "Artist4", "Artist5"],
  "discovery": ["Artist6", "Artist7", "Artist8"],
  "album_artists": ["Artist9", "Artist10"]
}
similar — похожие по стилю артисты.
discovery — неожиданные, малоизвестные открытия в схожем жанре.
album_artists — 2 артиста из списка, чьи альбомы стоит послушать целиком.`
          }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '{}';
      let claudeSuggestions = { similar: [], discovery: [], album_artists: [] };
      try {
        const match = text.match(/\{[\s\S]*?\}/);
        claudeSuggestions = JSON.parse(match ? match[0] : '{}');
      } catch (e) { }

      const token = await getSpotifyToken();
      let waveTracks = [];

      // Слой 1: Похожие артисты (40%)
      for (const artistName of (claudeSuggestions.similar || []).slice(0, 5)) {
        const found = await searchSpotify(`artist:${artistName}`, 3);
        waveTracks.push(...found.map(t => ({ ...t, _layer: 'similar' })));
      }

      // Слой 2: Открытия (25%)
      for (const artistName of (claudeSuggestions.discovery || []).slice(0, 3)) {
        const found = await searchSpotify(`artist:${artistName}`, 2);
        waveTracks.push(...found.map(t => ({ ...t, _layer: 'discovery' })));
      }

      // Слой 3: Альбомы целиком (25%) — NEW
      for (const artistName of (claudeSuggestions.album_artists || artistList).slice(0, 2)) {
        // Найдём артиста в Spotify
        const searchRes = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const searchData = await searchRes.json();
        const foundArtist = searchData.artists?.items?.[0];
        if (!foundArtist) continue;

        // Берём его топовый альбом
        const albumsRes = await fetch(
          `https://api.spotify.com/v1/artists/${foundArtist.id}/albums?market=US&limit=5&include_groups=album`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const albumsData = await albumsRes.json();
        const topAlbum = albumsData.items?.[0];
        if (!topAlbum) continue;

        // Берём первые 5 треков альбома
        const tracksRes = await fetch(
          `https://api.spotify.com/v1/albums/${topAlbum.id}/tracks?limit=5`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const tracksData = await tracksRes.json();
        const albumTracks = (tracksData.items || []).map(t => ({
          id: t.id,
          name: t.name,
          artist: t.artists[0].name,
          artist_id: t.artists[0].id,
          album: topAlbum.name,
          album_id: topAlbum.id,
          cover: topAlbum.images[0]?.url || null,
          dur: `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}`,
          _layer: 'album',
          _album_name: topAlbum.name,
        }));
        waveTracks.push(...albumTracks);
      }

      // Слой 4: Сами артисты из истории (10%)
      for (const artistName of artistList.slice(0, 2)) {
        const found = await searchSpotify(`artist:${artistName}`, 2);
        waveTracks.push(...found.map(t => ({ ...t, _layer: 'familiar' })));
      }

      // Убираем дубли и перемешиваем
      const seen = new Set();
      waveTracks = waveTracks
        .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
        .sort(() => Math.random() - 0.5)
        .slice(0, parseInt(limit));

      return res.status(200).json({ tracks: waveTracks });
    }

    // ── ПОХОЖИЕ ТРЕКИ ──
    if (action === 'related') {
      if (!track) return res.status(400).json({ error: 'Нет трека' });

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Пользователь слушает трек: "${track}".
Порекомендуй 5 похожих артистов или треков в том же стиле.
Отвечай ТОЛЬКО JSON массивом строк вида "Артист - Трек" без объяснений:
["Artist1 - Track1", "Artist2 - Track2", "Artist3 - Track3", "Artist4 - Track4", "Artist5 - Track5"]`
          }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '[]';
      let suggestions = [];
      try {
        const match = text.match(/\[[\s\S]*?\]/);
        suggestions = JSON.parse(match ? match[0] : '[]');
      } catch (e) { suggestions = []; }

      let related = [];
      for (const suggestion of suggestions.slice(0, 5)) {
        const found = await searchSpotify(suggestion, 2);
        related.push(...found);
      }

      const seen = new Set();
      related = related
        .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
        .slice(0, parseInt(limit));

      return res.status(200).json({ tracks: related });
    }

    // ── AI РЕКОМЕНДАЦИИ ──
    if (action === 'ai_recommend') {      if (!artists) return res.status(400).json({ error: 'Нет данных' });
      const historyArtists = artists.split(',').slice(0, 10);

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Пользователь слушает: ${historyArtists.join(', ')}.
Порекомендуй 6 неожиданных открытий — артистов которых он скорее всего не знает, но которые ему понравятся.
Выходи за рамки очевидного, удивляй.
Отвечай ТОЛЬКО JSON массивом имён артистов без объяснений:
["Artist1", "Artist2", "Artist3", "Artist4", "Artist5", "Artist6"]`
          }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '[]';
      let recommendedArtists = [];
      try {
        const match = text.match(/\[[\s\S]*?\]/);
        recommendedArtists = JSON.parse(match ? match[0] : '[]');
      } catch (e) { recommendedArtists = []; }

      let aiTracks = [];
      for (const artistName of recommendedArtists.slice(0, 6)) {
        const found = await searchSpotify(artistName, 2);
        aiTracks.push(...found);
      }

      return res.status(200).json({ tracks: aiTracks });
    }

    // ── РЕКОМЕНДОВАННЫЕ АЛЬБОМЫ — Claude подбирает альбомы по вкусу ──
    if (action === 'rec_albums') {
      if (!artists) return res.status(400).json({ error: 'Нет данных' });
      const historyArtists = artists.split(',').slice(0, 10);

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Пользователь слушает: ${historyArtists.join(', ')}.
Порекомендуй 6 альбомов которые ему точно понравятся — как классику жанра так и свежие релизы.
Отвечай ТОЛЬКО JSON массивом объектов без объяснений:
[{"artist":"Artist1","album":"Album1"},{"artist":"Artist2","album":"Album2"},{"artist":"Artist3","album":"Album3"},{"artist":"Artist4","album":"Album4"},{"artist":"Artist5","album":"Album5"},{"artist":"Artist6","album":"Album6"}]`
          }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '[]';
      let suggestions = [];
      try {
        const match = text.match(/\[[\s\S]*?\]/);
        suggestions = JSON.parse(match ? match[0] : '[]');
      } catch (e) { suggestions = []; }

      const token = await getSpotifyToken();
      const albums = [];

      for (const s of suggestions.slice(0, 6)) {
        try {
          const r = await fetch(
            `https://api.spotify.com/v1/search?q=album:${encodeURIComponent(s.album)}+artist:${encodeURIComponent(s.artist)}&type=album&limit=1&market=US`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          const d = await r.json();
          const a = d.albums?.items?.[0];
          if (a) albums.push({
            id: a.id,
            name: a.name,
            artist: a.artists[0]?.name || s.artist,
            artist_id: a.artists[0]?.id || '',
            cover: a.images[0]?.url || null,
            year: a.release_date?.slice(0, 4) || '',
            total_tracks: a.total_tracks,
          });
        } catch (e) { /* skip */ }
      }

      return res.status(200).json({ albums });
    }

    return res.status(400).json({ error: 'Неизвестный action' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
