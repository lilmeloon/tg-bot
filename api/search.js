export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, action, artists, track, limit = 10 } = req.query;

  // ── SPOTIFY TOKEN (только для поиска треков) ──
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
      album: t.album.name,
      cover: t.album.images[0]?.url || null,
      dur: `${Math.floor(t.duration_ms/60000)}:${String(Math.floor((t.duration_ms%60000)/1000)).padStart(2,'0')}`,
      preview_url: t.preview_url
    };
  }

  // ── ПОИСК треков через Spotify ──
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
      const tracks = await searchSpotify(q, 8);
      return res.status(200).json({ tracks });
    }

    // ── LIBAUD FM — Claude подбирает артистов → Spotify ищет треки ──
    if (action === 'wave') {
      if (!artists) return res.status(400).json({ error: 'Нет артистов' });
      const artistList = artists.split(',').slice(0, 8);

      // Claude анализирует вкусы и предлагает похожих артистов
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Пользователь слушает: ${artistList.join(', ')}.
Подбери 8 артистов для персонального радио — похожих по стилю и жанру, но не тех же самых.
Включи как популярных так и малоизвестных.
Отвечай ТОЛЬКО JSON массивом имён артистов без объяснений:
["Artist1", "Artist2", "Artist3", "Artist4", "Artist5", "Artist6", "Artist7", "Artist8"]`
          }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '[]';
      let recommendedArtists = [];
      try {
        const match = text.match(/\[[\s\S]*?\]/);
        recommendedArtists = JSON.parse(match ? match[0] : '[]');
      } catch(e) { recommendedArtists = []; }

      // Для каждого артиста ищем треки в Spotify
      let waveTracks = [];
      for (const artistName of recommendedArtists.slice(0, 8)) {
        const found = await searchSpotify(`artist:${artistName}`, 3);
        waveTracks.push(...found);
      }

      // Добавляем немного треков самих артистов из истории
      for (const artistName of artistList.slice(0, 3)) {
        const found = await searchSpotify(`artist:${artistName}`, 2);
        waveTracks.push(...found);
      }

      // Убираем дубли и перемешиваем
      const seen = new Set();
      waveTracks = waveTracks
        .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
        .sort(() => Math.random() - 0.5)
        .slice(0, parseInt(limit));

      return res.status(200).json({ tracks: waveTracks });
    }

    // ── ПОХОЖИЕ ТРЕКИ — Claude предлагает похожих артистов ──
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
      } catch(e) { suggestions = []; }

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

    // ── AI РЕКОМЕНДАЦИИ — другие жанры и открытия ──
    if (action === 'ai_recommend') {
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
      } catch(e) { recommendedArtists = []; }

      let aiTracks = [];
      for (const artistName of recommendedArtists.slice(0, 6)) {
        const found = await searchSpotify(artistName, 2);
        aiTracks.push(...found);
      }

      return res.status(200).json({ tracks: aiTracks });
    }

    return res.status(400).json({ error: 'Неизвестный action' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
