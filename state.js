// ── ГЛОБАЛЬНОЕ СОСТОЯНИЕ ──
const RAILWAY_URL = 'https://web-production-4beac.up.railway.app';

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

// Telegram
const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor('#0a0a0a'); tg.setBackgroundColor('#0a0a0a'); }
const tgUser = tg?.initDataUnsafe?.user;
