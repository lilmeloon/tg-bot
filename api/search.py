import json
import os
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

def handler(request, response):
    # CORS — разрешаем запросы от Telegram
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Content-Type"] = "application/json"

    if request.method == "OPTIONS":
        response.status_code = 200
        return response

    query = request.args.get("q", "").strip()
    if not query:
        response.status_code = 400
        return json.dumps({"error": "Нет запроса"})

    try:
        sp = spotipy.Spotify(auth_manager=SpotifyClientCredentials(
            client_id=os.environ["SPOTIFY_CLIENT_ID"],
            client_secret=os.environ["SPOTIFY_CLIENT_SECRET"]
        ))

        results = sp.search(q=query, type="track", limit=8)
        tracks = []

        for t in results["tracks"]["items"]:
            duration_sec = t["duration_ms"] // 1000
            tracks.append({
                "id": t["id"],
                "name": t["name"],
                "artist": t["artists"][0]["name"],
                "album": t["album"]["name"],
                "cover": t["album"]["images"][0]["url"] if t["album"]["images"] else None,
                "dur": f"{duration_sec // 60}:{duration_sec % 60:02d}",
                "preview_url": t["preview_url"],
            })

        response.status_code = 200
        return json.dumps({"tracks": tracks})

    except Exception as e:
        response.status_code = 500
        return json.dumps({"error": str(e)})
