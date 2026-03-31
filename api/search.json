export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Нет запроса' });

  try {
    // Получаем токен Spotify
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64')
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // Ищем треки
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();

    const tracks = searchData.tracks.items.map(t => ({
      id: t.id,
      name: t.name,
      artist: t.artists[0].name,
      album: t.album.name,
      cover: t.album.images[0]?.url || null,
      dur: `${Math.floor(t.duration_ms/60000)}:${String(Math.floor((t.duration_ms%60000)/1000)).padStart(2,'0')}`,
      preview_url: t.preview_url
    }));

    res.status(200).json({ tracks });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
