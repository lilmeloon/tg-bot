// ── ГЛОБАЛЬНОЕ СОСТОЯНИЕ ──
const RAILWAY_URL = 'https://web-production-4beac.up.railway.app';

// Debug: пишем все логи в панель
window._debugLog = [];
window.dlog = function(...args) {
  const msg = args.map(a => {
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  }).join(' ');
  const time = new Date().toLocaleTimeString().slice(-9, -3);
  window._debugLog.push(`[${time}] ${msg}`);
  if (window._debugLog.length > 100) window._debugLog.shift();
  const el = document.getElementById('debug-log');
  if (el) el.textContent = window._debugLog.join('\n');
  console.log(...args);
};
window.toggleDebug = function() {
  const p = document.getElementById('debug-panel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
};
// Перехватываем ошибки
window.addEventListener('error', e => {
  dlog('❌ ERROR:', e.message, 'at', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', e => {
  dlog('❌ PROMISE:', e.reason?.message || e.reason);
});
dlog('✓ Loaded state.js');

// Аудио
const audio = new Audio();
audio.preload = 'none';
const audioNext = new Audio();
audioNext.preload = 'auto';

// Состояние плеера
let tracks = [];
let favorites = JSON.parse(localStorage.getItem('favs') || '[]');
let history = JSON.parse(localStorage.getItem('history') || '[]');
let offlineTracks = JSON.parse(localStorage.getItem('offlineTracks') || '[]');
let downloaded = new Set(JSON.parse(localStorage.getItem('downloaded') || '[]'));
let currentIdx = -1;
let currentSource = 'all';
let isShuffle = false;
let isRepeat = false;
let nextPreloaded = false;
let searchTimer = null;
let blockedArtists = new Set(JSON.parse(localStorage.getItem('blockedArtists') || '[]'));
let artistPlayCount = JSON.parse(localStorage.getItem('artistPlayCount') || '{}');
let playlists = JSON.parse(localStorage.getItem('playlists') || '[]');

// Волна
let waveIsPlaying = false;
let waveTracks = [];
let waveIdx = 0;
let waveQueue = [];
let waveArtistPool = [];
let wavePlayedIds = new Set();
let waveLoadingMore = false;

// Сборники (жанровые плейлисты)
let mixTracks = {};

// Telegram
const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor('#0a0a0a'); tg.setBackgroundColor('#0a0a0a'); }
const tgUser = tg?.initDataUnsafe?.user;
