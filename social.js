// social.js — Social Module (Friends, Drops, Now Playing, Listen Together)

const SOCIAL_INIT_DATA = window.Telegram?.WebApp?.initData || '';
const SOCIAL_USER_ID = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '');

async function socialFetch(path, opts = {}) {
  const res = await fetch(RAILWAY_URL + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': SOCIAL_INIT_DATA,
      ...(opts.headers || {}),
    },
  });
  return res.json();
}

// ── Init ──
let socialInitDone = false;
let socialFriends = [];

async function initSocial() {
  if (!SOCIAL_INIT_DATA || socialInitDone) return;
  socialInitDone = true;
  try { await socialFetch('/api/social/auth', { method: 'POST' }); } catch(e) {}
}
if (SOCIAL_INIT_DATA) setTimeout(initSocial, 1500);

// ── Tabs ──
function switchSocialTab(tab, el) {
  document.querySelectorAll('.social-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  ['friends','requests','inbox'].forEach(t => {
    const s = document.getElementById('social-' + t);
    if (s) s.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'friends') loadSocialFriends();
  if (tab === 'requests') loadSocialRequests();
  if (tab === 'inbox') loadSocialInbox();
}

// ── Friends list ──
async function loadSocialFriends() {
  const list = document.getElementById('social-friends-list');
  if (!list) return;
  if (!SOCIAL_INIT_DATA) {
    list.innerHTML = '<div class="empty" style="padding:40px 20px;"><p>Открой через Telegram</p></div>';
    return;
  }
  try {
    const data = await socialFetch('/api/social/friends');
    socialFriends = data.friends || [];
    if (!socialFriends.length) {
      list.innerHTML = '<div class="empty" style="padding:40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><p>Найди друзей по @username</p></div>';
      return;
    }
    list.innerHTML = socialFriends.map(f => {
      const np = f.now_playing;
      const av = f.photo_url
        ? `<img src="${f.photo_url}">`
        : `<div class="friend-avatar-letter">${(f.first_name || f.username || '?')[0].toUpperCase()}</div>`;
      return `
      <div class="friend-item" onclick="openFriendProfile('${f.id}')">
        <div class="friend-avatar">${av}${np ? '<div class="friend-online"></div>' : ''}</div>
        <div class="friend-info">
          <div class="friend-name">${f.first_name || f.username || 'User'}</div>
          <div class="friend-status ${np ? 'listening' : ''}">${np ? '🎵 ' + np.track_name + ' — ' + np.artist : '@' + (f.username || '')}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div class="empty" style="padding:40px 20px;"><p>Ошибка загрузки</p></div>';
  }
}

// ── Friend Requests ──
async function loadSocialRequests() {
  const list = document.getElementById('social-requests-list');
  if (!list || !SOCIAL_INIT_DATA) return;
  try {
    const data = await socialFetch('/api/social/friends/requests');
    const reqs = data.requests || [];
    if (!reqs.length) {
      list.innerHTML = '<div class="empty" style="padding:40px 20px;"><p>Нет входящих запросов</p></div>';
      return;
    }
    list.innerHTML = reqs.map(r => `
      <div class="friend-item">
        <div class="friend-avatar">${r.photo_url ? `<img src="${r.photo_url}">` : `<div class="friend-avatar-letter">${(r.first_name || '?')[0].toUpperCase()}</div>`}</div>
        <div class="friend-info">
          <div class="friend-name">${r.first_name || r.username || 'User'}</div>
          <div class="friend-status">@${r.username || ''}</div>
        </div>
        <button class="friend-accept-btn" onclick="event.stopPropagation();acceptFriendReq('${r.id}',this)">Принять</button>
        <button class="friend-decline-btn" onclick="event.stopPropagation();declineFriendReq('${r.id}',this.closest('.friend-item'))">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join('');
  } catch(e) {
    list.innerHTML = '<div class="empty" style="padding:40px 20px;"><p>Ошибка</p></div>';
  }
}

async function acceptFriendReq(id, btn) {
  btn.textContent = '✓'; btn.disabled = true;
  await socialFetch('/api/social/friends/accept', { method: 'POST', body: JSON.stringify({ sender_id: id }) });
  showToast('Друг добавлен!');
  setTimeout(loadSocialRequests, 500);
}

async function declineFriendReq(id, el) {
  el.style.opacity = '0.3';
  await socialFetch(`/api/social/friends/${id}`, { method: 'DELETE' });
  setTimeout(loadSocialRequests, 300);
}

// ── Inbox (Drops) ──
async function loadSocialInbox() {
  const list = document.getElementById('social-inbox-list');
  if (!list || !SOCIAL_INIT_DATA) return;
  try {
    const data = await socialFetch('/api/social/drops');
    const drops = data.drops || [];
    if (!drops.length) {
      list.innerHTML = '<div class="empty" style="padding:40px 20px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg><p>Друзья ещё не присылали треки</p></div>';
      return;
    }
    list.innerHTML = drops.map((d, i) => `
      <div class="inbox-card" onclick="playDrop(${i})">
        <div class="inbox-cover-wrap">
          <div class="inbox-cover">${d.cover_url ? `<img src="${d.cover_url}">` : '<div style="width:100%;height:100%;background:#1e1e1e"></div>'}</div>
          ${d.sender_photo ? `<div class="inbox-sender"><img src="${d.sender_photo}"></div>` : ''}
        </div>
        <div class="track-info">
          <div class="track-name">${d.track_name}</div>
          <div class="track-meta">${d.artist} · от ${d.sender_name || d.sender_username || 'друга'}</div>
        </div>
      </div>`).join('');
    list._drops = drops;
  } catch(e) {
    list.innerHTML = '<div class="empty" style="padding:40px 20px;"><p>Ошибка</p></div>';
  }
}

function playDrop(idx) {
  const list = document.getElementById('social-inbox-list');
  const drops = list?._drops;
  if (!drops?.[idx]) return;
  tracks = drops.map(d => ({ id: d.track_id, name: d.track_name, artist: d.artist, cover: d.cover_url, album: d.album || '' }));
  currentSource = 'all';
  playTrack(idx, 'all');
}

// ── User Search ──
let _socialSearchTm = null;

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('social-search-input');
  if (!inp) return;
  inp.addEventListener('input', () => {
    clearTimeout(_socialSearchTm);
    const q = inp.value.trim();
    const results = document.getElementById('social-search-results');
    if (q.length < 2) { if (results) results.style.display = 'none'; return; }
    _socialSearchTm = setTimeout(() => searchUsers(q), 400);
  });
});

async function searchUsers(q) {
  const c = document.getElementById('social-search-results');
  if (!c || !SOCIAL_INIT_DATA) return;
  try {
    const data = await socialFetch(`/api/social/search?q=${encodeURIComponent(q)}`);
    const users = data.users || [];
    if (!users.length) { c.style.display = 'block'; c.innerHTML = '<div style="color:#555;font-size:13px;padding:12px 0;">Не найдено</div>'; return; }
    c.style.display = 'block';
    c.innerHTML = users.map(u => `
      <div class="friend-item" style="border-radius:10px;">
        <div class="friend-avatar">${u.photo_url ? `<img src="${u.photo_url}">` : `<div class="friend-avatar-letter">${(u.first_name || u.username || '?')[0].toUpperCase()}</div>`}</div>
        <div class="friend-info">
          <div class="friend-name">${u.first_name || u.username || 'User'}</div>
          <div class="friend-status">@${u.username || ''}</div>
        </div>
        <button class="friend-accept-btn" onclick="event.stopPropagation();addFriend('${u.id}',this)">Добавить</button>
      </div>`).join('');
  } catch(e) {}
}

async function addFriend(id, btn) {
  btn.textContent = '...'; btn.disabled = true;
  const r = await socialFetch('/api/social/friends/request', { method: 'POST', body: JSON.stringify({ target_id: id }) });
  btn.textContent = r.status === 'accepted' ? '✓ Друзья' : '✓ Отправлено';
  showToast(r.status === 'accepted' ? 'Друг добавлен!' : 'Запрос отправлен');
}

// ── Friend Profile ──
async function openFriendProfile(id) {
  const fp = document.getElementById('friend-profile');
  if (!fp) return;
  fp.classList.add('open');
  document.getElementById('fp-name').textContent = '...';
  document.getElementById('fp-username').textContent = '';
  document.getElementById('fp-avatar').innerHTML = '';
  document.getElementById('fp-actions').innerHTML = '';
  document.getElementById('fp-now-playing').innerHTML = '';
  document.getElementById('fp-top-weekly').innerHTML = '';
  document.getElementById('fp-recent').innerHTML = '';

  try {
    const data = await socialFetch(`/api/social/profile/${id}`);
    const u = data.user;
    document.getElementById('fp-name').textContent = u.first_name || u.username || 'User';
    document.getElementById('fp-username').textContent = u.username ? '@' + u.username : '';
    document.getElementById('fp-avatar').innerHTML = u.photo_url
      ? `<img src="${u.photo_url}">`
      : `<div class="friend-avatar-letter" style="font-size:32px;width:100%;height:100%;">${(u.first_name || '?')[0].toUpperCase()}</div>`;

    document.getElementById('fp-actions').innerHTML = data.is_friend
      ? `<button class="fp-btn fp-btn-danger" onclick="removeFP('${id}')">Удалить из друзей</button>`
      : `<button class="fp-btn fp-btn-primary" onclick="addFriend('${id}',this)">Добавить в друзья</button>`;

    if (data.now_playing) {
      document.getElementById('fp-now-playing').innerHTML = `
        <div class="fp-section">
          <div class="fp-section-title">Слушает сейчас</div>
          <div class="fp-now-playing">
            <div class="fp-np-cover">${data.now_playing.cover_url ? `<img src="${data.now_playing.cover_url}">` : '<div style="width:100%;height:100%;background:#1e1e1e"></div>'}</div>
            <div class="fp-np-info">
              <div class="fp-np-name">${data.now_playing.track_name}</div>
              <div class="fp-np-artist">${data.now_playing.artist}</div>
            </div>
            <div class="fp-np-eq"><span style="height:4px"></span><span style="height:8px"></span><span style="height:6px"></span></div>
          </div>
        </div>`;
    }

    if (data.top_weekly?.length) {
      document.getElementById('fp-top-weekly').innerHTML = `
        <div class="fp-section">
          <div class="fp-section-title">Топ за неделю</div>
          ${data.top_weekly.map((t, i) => `
            <div class="artist-track" style="padding:6px 0;">
              <div class="artist-track-num">${i + 1}</div>
              <div class="artist-track-cover">${t.cover_url ? `<img src="${t.cover_url}">` : '<div style="width:100%;height:100%;background:#1e1e1e"></div>'}</div>
              <div class="artist-track-info">
                <div class="artist-track-name">${t.track_name}</div>
                <div class="artist-track-meta">${t.artist} · ${t.play_count}×</div>
              </div>
            </div>`).join('')}
        </div>`;
    }

    if (data.recently_added?.length) {
      document.getElementById('fp-recent').innerHTML = `
        <div class="fp-section">
          <div class="fp-section-title">Недавнее</div>
          ${data.recently_added.map(t => `
            <div class="artist-track" style="padding:6px 0;">
              <div class="artist-track-cover">${t.cover_url ? `<img src="${t.cover_url}">` : '<div style="width:100%;height:100%;background:#1e1e1e"></div>'}</div>
              <div class="artist-track-info">
                <div class="artist-track-name">${t.track_name}</div>
                <div class="artist-track-meta">${t.artist}</div>
              </div>
            </div>`).join('')}
        </div>`;
    }
  } catch(e) {
    document.getElementById('fp-now-playing').innerHTML = '<div style="color:#999;padding:20px;text-align:center;">Ошибка загрузки</div>';
  }
}

function closeFriendProfile() {
  document.getElementById('friend-profile')?.classList.remove('open');
}

async function removeFP(id) {
  await socialFetch(`/api/social/friends/${id}`, { method: 'DELETE' });
  showToast('Удалён из друзей');
  closeFriendProfile();
  loadSocialFriends();
}

// ── Share Modal (отправить трек другу) ──
function openShareModal() {
  const list = currentSource === 'wave' ? waveQueue : currentSource === 'fav' ? favorites : tracks;
  const t = list[currentIdx];
  if (!t) return;
  if (!SOCIAL_INIT_DATA) { showToast('Войди через Telegram'); return; }
  document.getElementById('share-track-info').textContent = `${t.name} — ${t.artist}`;
  document.getElementById('share-modal').classList.add('open');
  (async () => {
    const data = await socialFetch('/api/social/friends');
    const friends = data.friends || [];
    const c = document.getElementById('share-friend-list');
    if (!friends.length) {
      c.innerHTML = '<div style="color:#555;font-size:13px;padding:16px;text-align:center;">Добавь друзей чтобы делиться треками</div>';
      return;
    }
    c.innerHTML = friends.map(f => `
      <div class="friend-item" style="padding:8px 0;">
        <div class="friend-avatar" style="width:36px;height:36px;">${f.photo_url ? `<img src="${f.photo_url}">` : `<div class="friend-avatar-letter" style="font-size:14px;">${(f.first_name || '?')[0].toUpperCase()}</div>`}</div>
        <div class="friend-info"><div class="friend-name" style="font-size:13px;">${f.first_name || f.username || 'User'}</div></div>
        <button class="share-send-btn" onclick="shareSend('${f.id}',this)">Отправить</button>
      </div>`).join('');
  })();
}

function closeShareModal() {
  document.getElementById('share-modal')?.classList.remove('open');
}

async function shareSend(receiverId, btn) {
  const list = currentSource === 'wave' ? waveQueue : currentSource === 'fav' ? favorites : tracks;
  const t = list[currentIdx];
  if (!t) return;
  btn.textContent = '...'; btn.disabled = true;
  try {
    await socialFetch('/api/social/drop', {
      method: 'POST',
      body: JSON.stringify({ receiver_id: receiverId, track_id: t.id, track_name: t.name, artist: t.artist, cover_url: t.cover || '', album: t.album || '' }),
    });
    btn.textContent = '✓ Отправлено';
    btn.classList.add('sent');
  } catch(e) { btn.textContent = 'Ошибка'; }
}

// ── Now Playing (обновление статуса) ──
let _npTrack = null, _npStart = 0;

function socialNowPlaying(t, playing) {
  if (!SOCIAL_INIT_DATA || !t) return;
  // Логируем если слушал > 30 сек
  if (_npTrack && _npStart && Date.now() - _npStart > 30000) {
    socialFetch('/api/social/listen-log', {
      method: 'POST',
      body: JSON.stringify({ track_id: _npTrack.id, track_name: _npTrack.name, artist: _npTrack.artist, cover_url: _npTrack.cover || '', duration_ms: Date.now() - _npStart }),
    }).catch(() => {});
  }
  _npTrack = t;
  _npStart = playing ? Date.now() : 0;
  socialFetch('/api/social/now-playing', {
    method: 'POST',
    body: JSON.stringify({ track_id: t.id, track_name: t.name, artist: t.artist, cover_url: t.cover || '', position_ms: Math.floor((audio.currentTime || 0) * 1000), is_playing: playing }),
  }).catch(() => {});
}
