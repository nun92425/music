const Storage = {
  _data: null,
  _memberData: {},

  async load() {
    if (this._data) return this._data;
    const res = await fetch('./data.json');
    this._data = await res.json();
    return this._data;
  },

  async loadMemberData(memberId) {
    if (this._memberData[memberId]) return this._memberData[memberId];
    const res = await fetch(`./data/members/${memberId}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    this._memberData[memberId] = data;
    return data;
  },

  _siteConfig: null,

  async loadSiteConfig() {
    if (this._siteConfig) return this._siteConfig;
    try {
      const res = await fetch('./site-config.json');
      if (!res.ok) { this._siteConfig = {}; return {}; }
      this._siteConfig = await res.json();
      return this._siteConfig;
    } catch {
      this._siteConfig = {};
      return {};
    }
  },

  _channels: null,

  async loadChannels() {
    if (this._channels) return this._channels;
    try {
      const res = await fetch('./data/channels.json');
      if (!res.ok) { this._channels = {}; return this._channels; }
      this._channels = await res.json();
    } catch {
      this._channels = {};
    }
    return this._channels;
  },

  async loadMemoryGarden() {
    const data = await this.load();
    return data.memoryGarden || {};
  },

  async loadEncyclopedia() {
    const data = await this.load();
    return data.encyclopedia || {};
  },

  async getMember(memberId) {
    const data = await this.load();
    return data.members.find(m => m.id === memberId) || null;
  },

  getPlayerData() {
    try {
      return JSON.parse(localStorage.getItem('milpro_playerData') || 'null');
    } catch { return null; }
  },

  savePlayerData(data) {
    data.updatedAt = Date.now();
    try { localStorage.setItem('milpro_playerData', JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  },

  initPlayerData() {
    const existing = this.getPlayerData();
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing;
    const now = Date.now();
    const data = {
      uid: '',
      playerName: '',
      profile: '',
      createdAt: now,
      lastLogin: now,
      favoriteTalent: '',
      favoriteTalents: [],
      level: 1,
      exp: 0,
      mainJob: '',
      mainJobLevel: 0,
      subJob: '',
      subJobLevel: 0,
      musicPoint: 0,
      creativePoint: 0,
      knowledgePoint: 0,
      supportPower: 0,
      ideaPower: 0,
      memoryGarden: [],
      encyclopedia: [],
      loginDays: 0,
      streakDays: 0,
      startDate: now,
      updatedAt: now,
    };
    this.savePlayerData(data);
    return data;
  },

  getLocalTimers() {
    try {
      return JSON.parse(localStorage.getItem('milpro_timers') || '{}');
    } catch { return {}; }
  },

  setLocalTimer(type, cooldownMinutes) {
    const timers = this.getLocalTimers();
    timers[type] = Date.now() + cooldownMinutes * 60 * 1000;
    try { localStorage.setItem('milpro_timers', JSON.stringify(timers)); } catch (e) {}
  },

  getTimerRemaining(type) {
    const timers = this.getLocalTimers();
    const end = timers[type];
    if (!end) return 0;
    const remaining = Math.ceil((end - Date.now()) / 1000);
    if (remaining <= 0) {
      delete timers[type];
      try { localStorage.setItem('milpro_timers', JSON.stringify(timers)); } catch (e) {}
      return 0;
    }
    return remaining;
  },

  getPlaylistTimers() {
    try {
      return JSON.parse(localStorage.getItem('milpro_playlist_timers') || '{}');
    } catch { return {}; }
  },

  setPlaylistTimer(playlistId, cooldownMinutes) {
    const timers = this.getPlaylistTimers();
    timers[playlistId] = Date.now() + cooldownMinutes * 60 * 1000;
    try { localStorage.setItem('milpro_playlist_timers', JSON.stringify(timers)); } catch (e) {}
  },

  getPlaylistTimerRemaining(playlistId) {
    const timers = this.getPlaylistTimers();
    const end = timers[playlistId];
    if (!end) return 0;
    const remaining = Math.ceil((end - Date.now()) / 1000);
    if (remaining <= 0) {
      delete timers[playlistId];
      try { localStorage.setItem('milpro_playlist_timers', JSON.stringify(timers)); } catch (e) {}
      return 0;
    }
    return remaining;
  },

  getFavorites() {
    try { return JSON.parse(localStorage.getItem('milpro_favorites') || '[]'); }
    catch { return []; }
  },

  saveFavorites(ids) {
    try { localStorage.setItem('milpro_favorites', JSON.stringify(ids)); } catch (e) {}
  },

  toggleFavorite(videoId) {
    const favs = this.getFavorites();
    const idx = favs.indexOf(videoId);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(videoId);
    this.saveFavorites(favs);
    return favs;
  },

  isFavorite(videoId) {
    return this.getFavorites().includes(videoId);
  },

  getNotifSettings() {
    try { return JSON.parse(localStorage.getItem('milpro_notif_settings') || 'null'); }
    catch { return null; }
  },

  saveNotifSettings(s) {
    try { localStorage.setItem('milpro_notif_settings', JSON.stringify(s)); } catch (e) {}
  },

  initNotifSettings(memberIds) {
    const existing = this.getNotifSettings();
    if (existing) return existing;
    const members = {};
    for (const id of memberIds) members[id] = true;
    const s = { enabled: false, timings: ['30min'], members };
    this.saveNotifSettings(s);
    return s;
  },

  getCursorSettings() {
    try { return JSON.parse(localStorage.getItem('milpro_cursor') || 'null'); }
    catch { return null; }
  },

  saveCursorSettings(s) {
    try { localStorage.setItem('milpro_cursor', JSON.stringify(s)); } catch (e) {}
  },

  initCursorSettings() {
    const existing = this.getCursorSettings();
    if (existing && typeof existing === 'object') return existing;
    const s = { enabled: false, talentId: 'default' };
    this.saveCursorSettings(s);
    return s;
  },

  _collabGroups: null,

  async loadCollabGroups() {
    if (this._collabGroups) return this._collabGroups;
    try {
      const res = await fetch('./collab-groups.json');
      if (!res.ok) { this._collabGroups = []; return []; }
      this._collabGroups = await res.json();
      return this._collabGroups;
    } catch {
      this._collabGroups = [];
      return [];
    }
  },

  getNotified() {
    try { return JSON.parse(localStorage.getItem('milpro_notified') || '[]'); }
    catch { return []; }
  },

  saveNotified(arr) {
    try { localStorage.setItem('milpro_notified', JSON.stringify(arr)); } catch (e) {}
  },

  getExpToNextLevel(level) {
    return level * 100 + 50;
  },

  addExp(amount) {
    const player = this.getPlayerData();
    if (!player) return null;
    player.exp += amount;
    let next = this.getExpToNextLevel(player.level);
    while (player.exp >= next) {
      player.exp -= next;
      player.level++;
      next = this.getExpToNextLevel(player.level);
    }
    this.savePlayerData(player);
    return player;
  },
};
