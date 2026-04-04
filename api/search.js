export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q, action, artists, track, limit = 10 } = req.query;

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
      album: t.album.name,
      cover: t.album.images[0]?.url || null,
      dur: `${Math.floor(t.duration_ms/60000)}:${String(Math.floor((t.duration_ms%60000)/1000)).padStart(2,'0')}`,
      preview_url: t.preview_url
    };
  }

  try {
    const token = await getSpotifyToken();

    // ── ПОИСК ──
    if (!action || action === 'search') {
      if (!q) return res.status(400).json({ error: 'Нет запроса' });
      const r = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=8`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const d = await r.json();
      return res.status(200).json({ tracks: d.tracks.items.map(mapTrack) });
    }

    // ── МОЯ ВОЛНА — похожие треки через related artists ──
    if (action === 'wave') {
      if (!artists) return res.status(400).json({ error: 'Нет артистов' });

      const artistList = artists.split(',').slice(0, 3);
      let waveTracks = [];

      for (const artistName of artistList) {
        // Ищем артиста
        const searchR = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const searchD = await searchR.json();
        const foundArtist = searchD.artists?.items[0];
        if (!foundArtist) continue;

        // Похожие артисты
        const relR = await fetch(
          `https://api.spotify.com/v1/artists/${foundArtist.id}/related-artists`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const relD = await relR.json();
        const relArtists = relD.artists?.slice(0, 4) || [];

        // Топ треки каждого похожего артиста
        for (const ra of relArtists) {
          const topR = await fetch(
            `https://api.spotify.com/v1/artists/${ra.id}/top-tracks?market=US`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          const topD = await topR.json();
          const top = topD.tracks?.slice(0, 2) || [];
          waveTracks.push(...top.map(mapTrack));
        }
      }

      // Перемешиваем
      waveTracks = waveTracks.sort(() => Math.random() - 0.5).slice(0, parseInt(limit));
      return res.status(200).json({ tracks: waveTracks });
    }

    // ── ПОХОЖИЕ ТРЕКИ ──
    if (action === 'related') {
      if (!track) return res.status(400).json({ error: 'Нет трека' });

      // Ищем трек
      const searchR = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(track)}&type=track&limit=1`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const searchD = await searchR.json();
      const foundTrack = searchD.tracks?.items[0];
      if (!foundTrack) return res.status(200).json({ tracks: [] });

      // Похожие артисты и их топ треки
      const relR = await fetch(
        `https://api.spotify.com/v1/artists/${foundTrack.artists[0].id}/related-artists`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const relD = await relR.json();
      const relArtists = relD.artists?.slice(0, 5) || [];

      let related = [];
      for (const ra of relArtists) {
        const topR = await fetch(
          `https://api.spotify.com/v1/artists/${ra.id}/top-tracks?market=US`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const topD = await topR.json();
        related.push(...(topD.tracks?.slice(0, 2).map(mapTrack) || []));
      }

      related = related.sort(() => Math.random() - 0.5).slice(0, parseInt(limit));
      return res.status(200).json({ tracks: related });
    }

    // ── AI РЕКОМЕНДАЦИИ через Claude ──
    if (action === 'ai_recommend') {
      if (!artists) return res.status(400).json({ error: 'Нет данных' });

      const historyArtists = artists.split(',').slice(0, 10);

      // Запрос к Claude
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Пользователь слушает этих артистов: ${historyArtists.join(', ')}.
Порекомендуй 6 других артистов которые ему понравятся — включи как похожих так и неожиданные открытия.
Отвечай ТОЛЬКО JSON массивом строк с именами артистов, без пояснений и markdown:
["Artist1", "Artist2", "Artist3", "Artist4", "Artist5", "Artist6"]`
          }]
        })
      });

      const claudeData = await claudeRes.json();
      const text = claudeData.content?.[0]?.text || '[]';
      let recommendedArtists = [];
      try {
        recommendedArtists = JSON.parse(text.trim());
      } catch(e) {
        const match = text.match(/\[.*\]/s);
        if (match) recommendedArtists = JSON.parse(match[0]);
      }

      // Ищем треки для каждого рекомендованного артиста
      let aiTracks = [];
      for (const artistName of recommendedArtists.slice(0, 6)) {
        const r = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=track&limit=2`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const d = await r.json();
        aiTracks.push(...(d.tracks?.items?.map(mapTrack) || []));
      }

      return res.status(200).json({ tracks: aiTracks });
    }

    // ── ПОПУЛЯРНЫЕ ТРЕКИ (для главной) ──
    if (action === 'trending') {
      const genres = ['hip-hop', 'pop', 'r-n-b', 'electronic'];
      const genre = genres[Math.floor(Math.random() * genres.length)];
      const r = await fetch(
        `https://api.spotify.com/v1/search?q=genre:${genre}&type=track&limit=10&market=US`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const d = await r.json();
      return res.status(200).json({ tracks: d.tracks?.items?.map(mapTrack) || [] });
    }

    return res.status(400).json({ error: 'Неизвестный action' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
