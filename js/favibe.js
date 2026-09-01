const Millivibe = (function(){
  const $ = id => document.getElementById(id);
  let data = null;
  let allSongs = [];
  let queue = [];
  let history = [];
  let idx = -1;
  let player = null;
  let playerReady = false;
  let pending = null;
  let autoNext = false;
  let shuffle = false;
  let repeat = 'off';
  let automix = false;
  let presets = [];
  let channelIdMap = new Map();
  let titleMap = new Map();
  let milproChannelId = '';

  function esc(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function normalizeName(s){ return String(s||'').toLowerCase().replace(/[\s　]+/g,'').trim(); }
  function buildMemberLookup(){
    channelIdMap = new Map();
    titleMap = new Map();
    const members = (data && data.members) || [];
    milproChannelId = (members.find(m=>m.id==='milpro')||{}).channelId || 'UCaDO3fGfvXCP8m85ttSlYww';
    for(const m of members){
      if(m.channelId) channelIdMap.set(m.channelId, m);
      titleMap.set(normalizeName(m.name), m);
      // channelTitle の先頭部分も登録（例: "小廻こま / Komawari Koma" → "小廻こま"）
      const ct = (m.channel||'').replace(/^@/,'');
      if(ct) titleMap.set(normalizeName(ct), m);
    }
    // 各メンバーの videos から実際の channelId を収集（nonoの旧チャンネル対応など）
    for(const m of members){
      for(const v of (m.videos||[])){
        const cid = v.cached?.channelId;
        if(cid && !channelIdMap.has(cid)) channelIdMap.set(cid, m);
      }
      for(const pl of (m.playlists||[])){
        for(const v of (pl.videos||[])){
          const cid = v.cached?.channelId;
          if(cid && !channelIdMap.has(cid)){
            // playlist所有者とchannelIdが一致する場合のみ登録（外部混入を防ぐ）
            if(cid === m.channelId) channelIdMap.set(cid, m);
          }
        }
      }
    }
    // 追加: 既知の二重チャンネルを手動補正（nono）
    const nono = members.find(m=>m.id==='nono');
    if(nono){
      channelIdMap.set('UCsGWiDe1iLkhvbBGurUP2tg', nono);
      channelIdMap.set('UCqe0-vqZwAvZUb22wCMu1fA', nono);
      channelIdMap.set('UCq7n-GF0SZ7Pt1NCVfTvIaQ', nono);
    }
  }
  function isGroupVideo(title, cached){
    const t = String(title||'');
    const ct = String(cached?.channelTitle||'');
    const cid = String(cached?.channelId||'');
    const isMilproChannel = cid === milproChannelId || ct.includes('ミリプロ') || ct.includes('MillionProduction');
    const hasGroupKeyword = /ミリプロ|Million Production|全員|みりぷろ/i.test(t) || /ミリプロ|MillionProduction/i.test(ct);
    return isMilproChannel && hasGroupKeyword;
  }
  function parseArtists(title, cached, fallbackMember){
    const members = (data && data.members) || [];
    const allTalents = members.filter(m=> !['milpro','clip'].includes(m.id));
    if(isGroupVideo(title, cached)){
      return allTalents.map(m=> ({id:m.id, name:m.name}));
    }
    const primary = (cached?.channelId && channelIdMap.get(cached.channelId)) || fallbackMember;
    let seg = '';
    const m1 = String(title||'').match(/[／\/]\s*([^（(【\[]+)/);
    if(m1 && m1[1]){
      seg = m1[1];
    }else{
      seg = String(cached?.channelTitle||'').split('/')[0] || '';
    }
    // ノイズ除去
    seg = seg.replace(/covered by/gi,' ').replace(/\bcover\b/gi,' ').replace(/\bofficial\b/gi,' ').replace(/歌ってみた/g,' ').replace(/【[^】]*】/g,' ').replace(/\[[^\]]*\]/g,' ').replace(/「/g,' ').replace(/」/g,' ').replace(/\(.*?\)/g,' ').replace(/（.*?）/g,' ').replace(/[-–—]+$/,'').trim();
    // feat/ft を区切りに正規化
    let tmp = seg.replace(/\bfeat\.?\b/gi,'×').replace(/\bft\.?\b/gi,'×').replace(/\bwith\b/gi,'×');
    // 分割（・は含めない：あくび・でもんすぺーどの名前を壊さないため）
    let rawTokens = tmp.split(/[×\u00d7xX＆&、,，\+＋]+/).map(t=> t.trim()).filter(Boolean);
    // ハイフンや余分な記号を除去
    rawTokens = rawTokens.map(t=> t.replace(/^[\s\-–—]+|[\s\-–—]+$/g,'').trim()).filter(t=> t.length>=1 && !/^(cover|official)$/i.test(t));
    if(!rawTokens.length){
      if(primary) return [{id:primary.id, name:primary.name}];
      return fallbackMember ? [{id:fallbackMember.id, name:fallbackMember.name}] : [];
    }
    // 順序保持: rawTokensの出現順を尊重して結果を構築
    const ordered = [];
    const seenOIds = new Set();
    const seenONames = new Set();
    for(const tok of rawTokens){
      const norm = normalizeName(tok);
      if(!norm) continue;
      let m = titleMap.get(norm);
      if(!m){
        m = members.find(mm=>{
          const nn = normalizeName(mm.name);
          return norm.includes(nn) || nn.includes(norm);
        });
      }
      if(m){
        if(!seenOIds.has(m.id)){
          seenOIds.add(m.id);
          seenONames.add(normalizeName(m.name));
          ordered.push({id:m.id, name:m.name});
        }
      }else{
        if(!seenONames.has(norm)){
          seenONames.add(norm);
          ordered.push({id:null, name:tok});
        }
      }
    }
    // primary が含まれていなければ補完（ソロ曲の保険）
    if(primary && !seenOIds.has(primary.id)){
      const hasPrimaryName = ordered.some(o=> normalizeName(o.name)===normalizeName(primary.name));
      if(!hasPrimaryName){
        const isPrimaryFromChannel = !!(cached?.channelId && channelIdMap.get(cached.channelId));
        if(isPrimaryFromChannel || ordered.length===0){
          if(ordered.length===1 && ordered[0].id===null){
            // 外部1件のみの場合は外部を優先（例: 寧々丸の曲がkomaプレイリストに混入）
            // 何もしない
          }else{
            ordered.unshift({id:primary.id, name:primary.name});
            seenOIds.add(primary.id);
          }
        }else if(ordered.length===0){
          ordered.push({id:primary.id, name:primary.name});
        }
      }
    }
    if(!ordered.length && primary) return [{id:primary.id, name:primary.name}];
    if(!ordered.length && fallbackMember) return [{id:fallbackMember.id, name:fallbackMember.name}];
    return ordered;
  }
  function getArtistDisplay(s){
    const names = s.memberNames || [s.memberName];
    return names.join('、 ');
  }
  function renderArtistHtml(s, opts={}){
    const mode = opts.mode || 'card'; // card | now | mini | rank | history
    const names = s.memberNames || (s.memberName ? [s.memberName] : []);
    if(!names.length) return '';
    if(names.length===1){
      return `<span class="artist-name">${esc(names[0])}</span>`;
    }
    if(s.isGroup){
      const collapsed = `ミリプロ <span class="artist-count">(${names.length}名)</span>`;
      const expanded = names.map(n=> `<span class="artist-chip">${esc(n)}</span>`).join('');
      // cardではチップ、now/miniではテキスト
      if(mode==='card'){
        return `<span class="song-artist song-artist--group" data-collapsed="1" data-id="${esc(s.id)}">
          <span class="artist-collapsed">${collapsed} <button type="button" class="artist-toggle" aria-expanded="false" onclick="event.stopPropagation()">▼</button></span>
          <span class="artist-expanded" style="display:none"><span class="artist-chips">${expanded}</span> <button type="button" class="artist-toggle" aria-expanded="true" onclick="event.stopPropagation()">▲</button></span>
        </span>`;
      }else{
        const full = names.map(esc).join('、 ');
        return `<span class="song-artist song-artist--group" data-collapsed="1" data-id="${esc(s.id)}">
          <span class="artist-collapsed">${collapsed} <button type="button" class="artist-toggle" aria-expanded="false" onclick="event.stopPropagation()">▼</button></span>
          <span class="artist-expanded" style="display:none">${esc(full)} <button type="button" class="artist-toggle" aria-expanded="true" onclick="event.stopPropagation()">▲</button></span>
        </span>`;
      }
    }
    // collab
    if(names.length===2){
      return `<span class="artist-name">${esc(names.join('、 '))}</span>`;
    }
    const short = `${esc(names.slice(0,2).join('、 '))} <span class="artist-count">他${names.length-2}名</span>`;
    const full = names.map(esc).join('、 ');
    return `<span class="song-artist song-artist--collab" data-collapsed="1" data-id="${esc(s.id)}">
      <span class="artist-collapsed">${short} <button type="button" class="artist-toggle" aria-expanded="false" onclick="event.stopPropagation()">▼</button></span>
      <span class="artist-expanded" style="display:none">${full} <button type="button" class="artist-toggle" aria-expanded="true" onclick="event.stopPropagation()">▲</button></span>
    </span>`;
  }
  function attachArtistToggles(root){
    if(!root) return;
    root.querySelectorAll('.artist-toggle').forEach(btn=>{
      if(btn.dataset.bound) return;
      btn.dataset.bound='1';
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        e.preventDefault();
        const wrap = btn.closest('.song-artist');
        if(!wrap) return;
        const isCollapsed = wrap.dataset.collapsed !== '0';
        wrap.dataset.collapsed = isCollapsed ? '0' : '1';
        const c = wrap.querySelector('.artist-collapsed');
        const ex = wrap.querySelector('.artist-expanded');
        if(c) c.style.display = isCollapsed ? 'none' : '';
        if(ex) ex.style.display = isCollapsed ? '' : 'none';
        // now/mini の折り返し対応
        if(wrap.closest('#nowArtist') || wrap.closest('#miniArtist')){
          wrap.style.whiteSpace = isCollapsed ? 'normal' : 'nowrap';
        }
      });
    });
  }
  function setupArtistToggleGlobal(){
    if(window._mvArtistToggleBound) return;
    window._mvArtistToggleBound = true;
    document.addEventListener('click', e=>{
      const btn = e.target.closest('.artist-toggle');
      if(!btn) return;
      e.stopPropagation();
      e.preventDefault();
      const wrap = btn.closest('.song-artist');
      if(!wrap) return;
      const isCollapsed = wrap.dataset.collapsed !== '0';
      wrap.dataset.collapsed = isCollapsed ? '0' : '1';
      const c = wrap.querySelector('.artist-collapsed');
      const ex = wrap.querySelector('.artist-expanded');
      if(c) c.style.display = isCollapsed ? 'none' : '';
      if(ex) ex.style.display = isCollapsed ? '' : 'none';
      if(wrap.closest('#nowArtist') || wrap.closest('#miniArtist')){
        wrap.style.whiteSpace = isCollapsed ? 'normal' : 'nowrap';
      }
    });
  }

  function loadSettings(){
    try{
      const s = JSON.parse(localStorage.getItem('favibe_settings')||'null');
      if(s){ autoNext = !!s.autoNext; shuffle = !!s.shuffle; repeat = s.repeat||'off'; automix = !!s.automix; }
    }catch(e){}
    // 旧チェックボックス互換
    if($('autoNextToggle')) $('autoNextToggle').checked = autoNext;
    // 新トグルボタン
    if($('btnAutoNext')){
      $('btnAutoNext').dataset.on = autoNext ? '1' : '0';
      $('btnAutoNext').classList.toggle('active', autoNext);
      $('btnAutoNext').style.background = autoNext ? 'linear-gradient(120deg,#4fc3f7,#b48cf2)' : 'rgba(255,255,255,0.06)';
      $('btnAutoNext').style.color = autoNext ? '#fff' : '#9aa3c0';
      $('btnAutoNext').style.borderColor = autoNext ? 'transparent' : 'rgba(255,255,255,0.12)';
    }
    if($('btnShuffle')) $('btnShuffle').classList.toggle('active', shuffle);
    if($('btnRepeat')) { $('btnRepeat').dataset.mode = repeat; $('btnRepeat').classList.toggle('active', repeat!=='off'); $('btnRepeat').textContent = repeat==='one' ? 'ONE' : repeat==='all' ? 'ALL' : 'REP'; }
    if($('btnAutomix')) { $('btnAutomix').dataset.on = automix?'1':'0'; $('btnAutomix').classList.toggle('active', automix); }
    // 音量表示
    try{
      const v = parseInt(localStorage.getItem('milpro_millivibe_volume')||'80',10);
      if($('volSlider')) $('volSlider').value = String(v);
      if($('volFill')) $('volFill').style.height = v + '%';
      if($('volValue')) $('volValue').textContent = String(v);
    }catch(e){}
  }
  function saveSettings(){
    try{ localStorage.setItem('favibe_settings', JSON.stringify({autoNext, shuffle, repeat, automix})); }catch(e){}
  }
  function loadQueue(){
    try{
      const q = JSON.parse(localStorage.getItem('favibe_queue')||'null');
      if(Array.isArray(q) && q.length) queue = q;
    }catch(e){}
  }
  function saveQueue(){
    try{ localStorage.setItem('favibe_queue', JSON.stringify(queue)); }catch(e){}
  }
  function loadHistory(){
    try{
      const h = JSON.parse(localStorage.getItem('favibe_history')||'null');
      if(Array.isArray(h)) history = h;
    }catch(e){ history=[]; }
  }
  function saveHistory(){
    try{ localStorage.setItem('favibe_history', JSON.stringify(history.slice(0,20))); }catch(e){}
  }
  function loadPins(){
    try{ return JSON.parse(localStorage.getItem('favibe_pins')||'[]'); }catch(e){ return []; }
  }
  function savePins(pins){
    try{ localStorage.setItem('favibe_pins', JSON.stringify(pins)); }catch(e){}
    if(typeof getMilliproUid==='function' && getMilliproUid() && typeof mpWriteCloud==='function'){
      mpWriteCloud(getMilliproUid(),'millivibePins', pins);
    }
  }
  function loadPlays(){
    try{ return JSON.parse(localStorage.getItem('favibe_plays')||'{}'); }catch(e){ return {}; }
  }
  function incPlay(videoId){
    try{
      const plays = loadPlays();
      const today = new Date().toISOString().slice(0,10);
      const key = videoId+'_'+today;
      if(plays[key]) return;
      plays[videoId] = (plays[videoId]||0)+1;
      plays[key]=1;
      localStorage.setItem('favibe_plays', JSON.stringify(plays));
      // history
      history.unshift({id: videoId, at: Date.now()});
      // dedup history
      const seen = new Set();
      history = history.filter(h=>{ if(seen.has(h.id)) return false; seen.add(h.id); return true; }).slice(0,20);
      saveHistory();
      renderHistory();
      renderLibHistory();
    }catch(e){}
  }

  async function init(){
    loadSettings();
    loadQueue();
    loadHistory();
    try{
      // まず公開のdata.jsonを試すが、trimmedで50件に切られているため、可能なら各メンバーのフルデータを取得してマージ
      const res = await fetch('./data.json');
      data = await res.json();
      // フルデータで補完（public/data/members/*.json は500件フル）
      try{
        const memberIds = (data.members||[]).map(m=>m.id);
        const fullMembers = await Promise.all(memberIds.map(async id=>{
          try{
            const r = await fetch(`./data/members/${id}.json`);
            if(!r.ok) return null;
            const j = await r.json();
            return j;
          }catch(e){ return null; }
        }));
        const fullMap = new Map();
        for(const fm of fullMembers){ if(fm && fm.id) fullMap.set(fm.id, fm); }
        // マージ: playlistsとvideosをフルで差し替え、なければそのまま
        data.members = (data.members||[]).map(m=>{
          const fm = fullMap.get(m.id);
          if(fm){
            return { ...m, playlists: fm.playlists || m.playlists, videos: fm.videos || m.videos };
          }
          return m;
        });
      }catch(e){ console.warn('full members fetch failed', e); }
    }catch(e){ data={members:[]}; }
    try{
      const r = await fetch('./favibe-presets.json');
      const j = await r.json();
      presets = j.presets||[];
    }catch(e){ presets=[]; }
    extractSongs();
    setupArtistToggleGlobal();
    setupPinnedPopover();
    setupVibeDrawer();
    setupCardMenu();
    setupQueueConfirmModal();
    renderSearch('');
    renderQueue();
    renderHistory();
    renderPresets();
    renderCustomPlaylists();
    renderRanking();
    renderPinned();
    renderLibrary();
    setupPlayer();
    setupControls();
    setupTabs();
    setupSearch();
    try{
      const s = Storage.getCursorSettings ? Storage.getCursorSettings() : null;
      if(s && s.enabled && s.talentId){
        document.documentElement.classList.add('cursor-custom','cursor-'+s.talentId);
      }
    }catch(e){}
    if(typeof onMilliproAuth==='function'){
      onMilliproAuth(async uid=>{
        if(uid && typeof mpReadCloud==='function'){
          const cloud = await mpReadCloud(uid,'millivibePlaylists');
          if(cloud && Array.isArray(cloud)){
            try{ localStorage.setItem('favibe_playlists', JSON.stringify(cloud)); }catch(e){}
            renderCustomPlaylists();
            renderLibrary();
          }
          const pins = await mpReadCloud(uid,'millivibePins');
          if(pins && Array.isArray(pins)){
            try{ localStorage.setItem('favibe_pins', JSON.stringify(pins)); }catch(e){}
            renderPinned();
          }
        }
      });
    }
  }

  function extractSongs(){
    allSongs = [];
    const seen = new Set();
    buildMemberLookup();
    const members = (data.members||[]);
    // milproを末尾にしてタレントを優先（折り畳み対応なので厳密には不要だが保険）
    const ordered = members.slice().sort((a,b)=>{
      if(a.id==='milpro') return 1;
      if(b.id==='milpro') return -1;
      if(a.id==='clip') return 1;
      if(b.id==='clip') return -1;
      return 0;
    });
    for(const m of ordered){
      for(const pl of (m.playlists||[])){
        for(const v of (pl.videos||[])){
          if(!v.id || seen.has(v.id)) continue;
          seen.add(v.id);
          const title = v.cached?.title || v.id;
          const cached = v.cached || {};
          const artists = parseArtists(title, cached, m);
          const isGroup = artists.length >= 6 && artists.every(a=> a.id && !['milpro','clip'].includes(a.id)) && isGroupVideo(title, cached);
          // isGroupVideo が true なら全員、それ以外でも 6名以上は group扱い（安全策）
          const effectiveIsGroup = isGroupVideo(title, cached) || (artists.length >= 8);
          const memberIds = artists.map(a=>a.id).filter(Boolean);
          const memberNames = artists.map(a=>a.name);
          // primary は先頭
          const primary = artists[0] || {id:m.id, name:m.name};
          allSongs.push({
            id: v.id,
            title,
            thumbnail: v.cached?.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            memberId: primary.id || m.id,
            memberName: primary.name || m.name,
            memberIds: memberIds.length ? memberIds : [primary.id || m.id].filter(Boolean),
            memberNames: memberNames.length ? memberNames : [primary.name || m.name],
            isGroup: effectiveIsGroup,
            playlistId: pl.id,
            playlistName: pl.name,
            publishedAt: v.cached?.publishedAt || ''
          });
        }
      }
    }
    allSongs.sort((a,b)=> new Date(b.publishedAt) - new Date(a.publishedAt));
    // デバッグ: 分布をコンソールに出す
    try{
      const cnt={}; for(const s of allSongs){ const k=s.isGroup?'group':(s.memberIds[0]||'unknown'); cnt[k]=(cnt[k]||0)+1; }
      console.log('[Millivibe] extractSongs distribution', cnt, 'total', allSongs.length);
    }catch(e){}
  }

  function songCard(s, opts={}){
    const pinActive = loadPins().some(p=>p.id===s.id);
    const artistHtml = renderArtistHtml(s, {mode:'card'});
    return `<div class="song-card" data-id="${s.id}" style="cursor:pointer">
      <button class="card-more" data-id="${s.id}" aria-label="メニュー" title="メニュー">︙</button>
      <img class="song-thumb" src="${esc(s.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="song-meta">
        <div class="song-title">${esc(s.title)}</div>
        <div class="song-artist-wrap">${artistHtml}</div>
      </div>
      <div class="card-desktop-actions" style="display:flex;gap:4px;padding:0 8px 8px">
        <button class="queue-add" data-id="${s.id}" style="flex:1;padding:6px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#e4e6eb;font-size:11px;cursor:pointer">次へ</button>
        <button class="queue-push" data-id="${s.id}" style="flex:1;padding:6px;border-radius:999px;border:none;background:linear-gradient(120deg,#4fc3f7,#b48cf2);color:#fff;font-size:11px;cursor:pointer">追加</button>
        <button class="pin-btn${pinActive?' active':''}" data-id="${s.id}" style="padding:6px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:${pinActive?'rgba(183,140,242,0.3)':'rgba(255,255,255,0.06)'};color:#e4e6eb;font-size:11px;cursor:pointer">PIN</button>
      </div>
    </div>`;
  }

  function renderSearch(filter=''){
    const cont = $('searchResults');
    const recCont = $('searchRecommend');
    if(!cont) return;
    const q = (filter||'').toLowerCase().trim();
    const hasFilter = !!($('filterTalent') && $('filterTalent').value) || !!($('filterPlaylist') && $('filterPlaylist').value) || !!($('filterFavorites') && $('filterFavorites').checked) || (document.querySelectorAll('#searchTags .search-tag.active').length>0);
    if(!q && !hasFilter){
      const plays = loadPlays();
      const counts = {};
      for(const k in plays){ if(k.includes('_')) continue; counts[k]=plays[k]; }
      const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=> allSongs.find(s=>s.id===id)).filter(Boolean);
      const favs = (()=>{ try{ return JSON.parse(localStorage.getItem('favibe_favorites')||'[]'); }catch(e){ return []; }})();
      const favSongs = favs.slice(0,3).map(id=> allSongs.find(s=>s.id===id)).filter(Boolean);
      let popularMember = null;
      if(top.length){ const m = top[0].memberId; popularMember = m; }
      const tendency = popularMember ? allSongs.filter(s=> (s.memberIds||[s.memberId]).includes(popularMember) && !top.some(t=>t.id===s.id)).slice(0,2) : allSongs.slice(0,2);
      const mix = [...top.slice(0,2), ...tendency.slice(0,2), ...favSongs.slice(0,2)].filter(Boolean);
      const seen = new Set();
      const uniq = mix.filter(s=>{ if(seen.has(s.id)) return false; seen.add(s.id); return true; }).slice(0,6);
      if(recCont){
        if(uniq.length){
          recCont.innerHTML = `<h4 style="font-size:12px;font-weight:800;color:#9aa3c0;margin:0 0 8px">おすすめ</h4><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">${uniq.map(s=>songCard(s)).join('')}</div>`;
          recCont.querySelectorAll('.song-card').forEach(el=>{
            el.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(el.dataset.id); });
            el.querySelectorAll('button').forEach(b=>{
              if(b.classList.contains('queue-add')) b.addEventListener('click', ()=> addNextWithAnim(b.dataset.id, el));
              else if(b.classList.contains('queue-push')) b.addEventListener('click', ()=> pushQueue(b.dataset.id));
              else if(b.classList.contains('pin-btn')) b.addEventListener('click', ()=> togglePin(b.dataset.id));
              else if(b.classList.contains('card-more')) b.addEventListener('click', e=>{ e.stopPropagation(); const s=allSongs.find(x=>x.id===b.dataset.id); if(s) { if(cardMenuOpen && cardMenuSongId===s.id) hideCardMenu(); else showCardMenu(b, s); }});
            });
          });
          attachCardInteractions(recCont);
        }else recCont.innerHTML = '';
      }
      const list = getFilteredSongs().slice(0,24);
      cont.innerHTML = list.map(s=>songCard(s)).join('');
      if($('btnShowAllSongs')){ $('btnShowAllSongs').style.display=''; $('btnShowAllSongs').textContent='曲一覧をすべて表示'; $('btnShowAllSongs').disabled=false; }
      attachCardInteractions(cont);
    }else{
      if(recCont) recCont.innerHTML = '';
      const list = getFilteredSongs();
      if(!list.length){ cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0">該当する曲がありません。</p>'; if($('btnShowAllSongs')) $('btnShowAllSongs').style.display='none'; return; }
      // 初回は100件のみ
      const first = list.slice(0,100);
      cont.innerHTML = first.map(s=>songCard(s)).join('');
      if($('btnShowAllSongs')){
        $('btnShowAllSongs').style.display='';
        if(list.length>100) { $('btnShowAllSongs').textContent=`もっと見る (${first.length}/${list.length})`; $('btnShowAllSongs').disabled=false; }
        else { $('btnShowAllSongs').textContent='すべて表示済み'; $('btnShowAllSongs').disabled=true; }
      }
    }
    cont.querySelectorAll('.song-card').forEach(el=>{
      el.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(el.dataset.id); });
      el.querySelectorAll('button').forEach(b=>{
        if(b.classList.contains('queue-add')) b.addEventListener('click', ()=> addNextWithAnim(b.dataset.id, el));
        else if(b.classList.contains('queue-push')) b.addEventListener('click', ()=> pushQueue(b.dataset.id));
        else if(b.classList.contains('pin-btn')) b.addEventListener('click', ()=> togglePin(b.dataset.id));
        else if(b.classList.contains('card-more')) b.addEventListener('click', e=>{ e.stopPropagation(); const s=allSongs.find(x=>x.id===b.dataset.id); if(s) { if(cardMenuOpen && cardMenuSongId===s.id) hideCardMenu(); else showCardMenu(b, s); }});
      });
    });
    attachCardInteractions(cont);
  }

  function addNextWithAnim(id, cardEl){
    addNext(id);
    // toast
    try{
      const t = document.getElementById('toast');
      if(t){ t.textContent='キューに追加しました'; t.classList.add('show'); setTimeout(()=> t.classList.remove('show'), 2000); }
      else {
        const n = document.createElement('div');
        n.textContent='キューに追加しました';
        n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(10,14,26,0.9);color:#fff;padding:8px 14px;border-radius:999px;font-size:12px;z-index:9999';
        document.body.appendChild(n);
        setTimeout(()=> n.remove(), 1800);
      }
    }catch(e){}
    // flying animation to 再生中 tab
    try{
      const thumb = cardEl.querySelector('img');
      const target = document.querySelector('.vibe-side-nav [data-tab="nowplaying"]');
      if(!thumb || !target) return;
      const r1 = thumb.getBoundingClientRect();
      const r2 = target.getBoundingClientRect();
      const clone = thumb.cloneNode(true);
      clone.className = 'flying-thumb';
      clone.style.left = r1.left+'px';
      clone.style.top = r1.top+'px';
      clone.style.width = r1.width+'px';
      clone.style.height = r1.height+'px';
      document.body.appendChild(clone);
      const dx = r2.left + r2.width/2 - r1.left - r1.width/2;
      const dy = r2.top + r2.height/2 - r1.top - r1.height/2;
      requestAnimationFrame(()=>{ clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`; clone.style.opacity='0'; });
      setTimeout(()=> clone.remove(), 500);
      // tab pulse
      target.style.transform = 'scale(1.1)';
      target.style.transition = 'transform 0.2s';
      setTimeout(()=> target.style.transform='', 250);
    }catch(e){}
  }

  function renderQueue(){
    const cont = $('queueList');
    const cnt = $('queueCount');
    if(cnt) cnt.textContent = queue.length ? `${queue.length}曲` : '';
    if(!cont) return;
    if(!queue.length){ cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0">キューは空です。</p>'; return; }
    cont.innerHTML = queue.map((id,i)=>{
      const s = allSongs.find(x=>x.id===id);
      const title = s ? s.title : id;
      const thumb = s ? s.thumbnail : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      const active = i===idx ? ' active' : '';
      return `<div class="queue-item${active}" data-idx="${i}" draggable="true" style="cursor:grab">
        <span class="drag-handle" draggable="true">≡</span>
        <img class="song-thumb" src="${esc(thumb)}" alt="" style="width:48px;height:36px">
        <div class="song-meta"><div class="song-title">${esc(title)}</div></div>
        <button data-idx="${i}" class="qplay" style="padding:4px 8px;border-radius:999px;background:linear-gradient(120deg,#4fc3f7,#b48cf2);color:#fff;border:none;font-size:11px;cursor:pointer">再生</button>
        <button data-idx="${i}" class="qdel" style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#e4e6eb;border:1px solid rgba(255,255,255,0.12);font-size:11px;cursor:pointer">×</button>
      </div>`;
    }).join('');
    cont.querySelectorAll('.queue-item').forEach(el=>{
      el.addEventListener('click', e=>{ if(e.target.closest('button')||e.target.classList.contains('drag-handle')) return; play(parseInt(el.dataset.idx,10)); });
      el.addEventListener('dragstart', e=>{
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain', el.dataset.idx);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
      el.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; });
      el.addEventListener('drop', e=>{
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'),10);
        const to = parseInt(el.dataset.idx,10);
        if(isNaN(from)||isNaN(to)||from===to) return;
        const item = queue.splice(from,1)[0];
        queue.splice(to,0,item);
        if(idx===from) idx=to;
        else if(from<idx && to>=idx) idx--;
        else if(from>idx && to<=idx) idx++;
        saveQueue(); renderQueue(); renderHistory();
      });
      // touch long press for mobile
      let touchTimer=null, touchStartY=0;
      el.addEventListener('touchstart', e=>{
        const th = e.target.closest('.drag-handle');
        if(!th) return;
        touchStartY = e.touches[0].clientY;
        touchTimer = setTimeout(()=> el.setAttribute('draggable','true'), 300);
      }, {passive:true});
      el.addEventListener('touchend', ()=>{ clearTimeout(touchTimer); });
      el.addEventListener('touchmove', e=>{
        if(!el.hasAttribute('draggable')) return;
        e.preventDefault();
      }, {passive:false});
    });
    cont.querySelectorAll('.qplay').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); play(parseInt(b.dataset.idx,10)); }));
    cont.querySelectorAll('.qdel').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); removeQueue(parseInt(b.dataset.idx,10)); }));
    // sticky history visibility
    const histSticky = $('queueHistorySticky');
    if(histSticky){
      const hasHist = history.length>0;
      // show sticky only when queue is scrolled? For now always show if has history, but hide when empty
      histSticky.style.display = hasHist ? '' : 'none';
    }
  }

  function renderHistory(){
    const cont = $('historyListSticky');
    const inlineCont = $('historyListInline');
    const libCont = $('libHistory');
    const countEl = $('historyCount');
    const libCountEl = $('libHistoryCount');
    if(countEl) countEl.textContent = history.length ? `(${history.length})` : '';
    if(libCountEl) libCountEl.textContent = history.length ? `(${history.length})` : '';
    // 邪魔にならないよう再生履歴は折り畳みの中に薄く表示（インラインはdetails内で薄く、ライブラリは通常）
    const render = (el, thin, limit)=>{
      if(!el) return;
      if(!history.length){ el.innerHTML = '<p style="font-size:11px;color:#9aa3c0">再生履歴はまだありません。</p>'; return; }
      const slice = history.slice(0, limit||6);
      el.innerHTML = slice.map(h=>{
        const s = allSongs.find(x=>x.id===h.id);
        const title = s ? s.title : h.id;
        const thumb = s ? s.thumbnail : `https://i.ytimg.com/vi/${h.id}/hqdefault.jpg`;
        const artistHtml = s ? renderArtistHtml(s, {mode:'history'}) : '';
        return `<div class="queue-item" data-id="${h.id}" style="${thin?'opacity:0.7;':''}cursor:pointer;padding:6px 8px">
          <img class="song-thumb" src="${esc(thumb)}" alt="" style="width:36px;height:36px;border-radius:6px">
          <div class="song-meta" style="min-width:0"><div class="song-title" style="font-size:11px">${esc(title)}</div><div style="font-size:10px;color:#9aa3c0">${artistHtml || ''}</div></div>
          <button class="qplay-hist" data-id="${h.id}" style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#e4e6eb;border:1px solid rgba(255,255,255,0.12);font-size:11px;cursor:pointer">再生</button>
        </div>`;
      }).join('');
      // 折りたたみ内はスクロール不要、天面の履歴は横スクロールでコンパクトに
      if(thin && el===inlineCont){
        el.style.display = 'flex';
        el.style.flexDirection = 'row';
        el.style.overflowX = 'auto';
        el.style.gap = '8px';
        el.style.paddingBottom = '4px';
        el.querySelectorAll('.queue-item').forEach(div=>{
          div.style.flex='0 0 160px';
          div.style.flexDirection='column';
          div.style.alignItems='stretch';
          const img=div.querySelector('img'); if(img){ img.style.width='100%'; img.style.height='auto'; img.style.aspectRatio='16/9'; }
        });
      }
      el.querySelectorAll('.qplay-hist').forEach(b=> b.addEventListener('click', ()=> playById(b.dataset.id)));
      el.querySelectorAll('.queue-item').forEach(div=> div.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(div.dataset.id); }));
    };
    // キュー上の履歴はStickyを非表示にしてインラインのdetailsに統合（邪魔にならない）
    if(cont && cont.parentElement) cont.parentElement.style.display='none';
    render(inlineCont, true, 6);
    render(libCont, false, 10);
    const histInlineWrap = $('queueHistoryInline');
    // detailsは閉じていると見えないので、履歴がある時はdetailsを開かない（ユーザーが開くまで非表示）
    // ただし最近再生が3件以上あるときはdetailsを開いた状態で薄く表示するより、閉じたままの方がすっきり
  }

  function renderPinned(){
    renderPinnedBar();
  }
  function renderPinnedBar(){
    const pins = loadPins();
    // badge
    const badge = $('pinnedBadge');
    if(badge){
      if(pins.length){ badge.textContent = String(pins.length); badge.style.display='inline-flex'; }
      else badge.style.display='none';
    }
    // ポップオーバー用コンテンツ
    const popCont = $('pinnedPopoverContent');
    const legacyCont = $('pinnedBar') || $('pinnedGrid');
    const renderInto = (cont, isPopover)=>{
      if(!cont) return;
      if(!pins.length){
        if(isPopover){
          cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0;text-align:center;padding:12px">ピン留めはまだありません。曲の︙やPINで追加できます。</p>';
        }else{
          const isBar = cont.id==='pinnedBar';
          cont.innerHTML = isBar ? '<div style="grid-column:1/-1;font-size:11px;color:#9aa3c0;text-align:center;padding:4px">ピン留めはまだありません</div>' : '<p style="font-size:12px;color:#9aa3c0;grid-column:1/-1">ピン留めはまだありません。曲やプレイリストでPINを押してください。</p>';
        }
        return;
      }
      cont.innerHTML = pins.map(p=>{
        if(p.type==='playlist'){
          let pls=[]; try{ pls=JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); }catch(e){}
          const pl = pls.find(x=>x.id===p.id) || {name: p.name||p.id, videoIds:[]};
          return `<div class="pin-card" data-id="${p.id}" data-type="playlist" style="cursor:pointer">
            <div style="font-size:13px;font-weight:800;color:#e4e6eb">${esc(pl.name)}</div>
            <div style="font-size:11px;color:#9aa3c0">${pl.videoIds.length}曲</div>
            <button class="pin-del" data-id="${p.id}" style="margin-top:8px;padding:4px 8px;border-radius:999px;background:rgba(247,143,192,0.18);color:#c25282;border:none;font-size:11px;cursor:pointer">外す</button>
          </div>`;
        }else{
          const s = allSongs.find(x=>x.id===p.id);
          const title = s ? s.title : p.id;
          const thumb = s ? s.thumbnail : `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg`;
          return `<div class="pin-card" data-id="${p.id}" data-type="song" style="cursor:pointer;overflow:hidden">
            <img class="song-thumb" src="${esc(thumb)}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;object-position:center;display:block;border-radius:8px">
            <div class="song-meta" style="padding:6px 0 4px"><div class="song-title" style="font-size:11px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal">${esc(title)}</div></div>
            <button class="pin-del" data-id="${p.id}" style="padding:4px 8px;border-radius:999px;background:rgba(247,143,192,0.18);color:#c25282;border:none;font-size:11px;cursor:pointer">外す</button>
          </div>`;
        }
      }).join('');
      cont.querySelectorAll('.pin-card').forEach(el=>{
        el.addEventListener('click', e=>{ if(e.target.closest('button')) return; const id=el.dataset.id; const type=el.dataset.type; if(type==='playlist'){ const pls=JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); const pl=pls.find(x=>x.id===id); if(pl){ queue=pl.videoIds.slice(); idx=-1; saveQueue(); renderQueue(); if(queue.length) play(0); switchTab('nowplaying'); closePinnedPopover(); } } else { playById(id); closePinnedPopover(); } });
      });
      cont.querySelectorAll('.pin-del').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); const id=b.dataset.id; const pins=loadPins().filter(p=>p.id!==id); savePins(pins); renderPinned(); }));
    };
    if(popCont){
      renderInto(popCont, true);
      // ポップオーバー内のグリッドスタイル調整
      popCont.style.display = pins.length ? 'grid' : 'block';
      if(pins.length) popCont.style.gridTemplateColumns = 'repeat(auto-fill,minmax(120px,1fr))';
    }
    if(legacyCont && legacyCont.id!=='pinnedPopoverContent'){
      renderInto(legacyCont, false);
    }
  }
  let pinnedPopoverOpen = false;
  function openPinnedPopover(){
    const pop = $('pinnedPopover');
    const overlay = $('pinnedOverlay');
    const btn = $('pinnedBarBtn');
    if(!pop) return;
    // 位置計算: レール横またはボタン直下
    const rect = btn ? btn.getBoundingClientRect() : {left:16, top:80, bottom:120, right:80};
    const isMobile = window.innerWidth <= 900;
    if(isMobile){
      // スマホ: レール横に固定
      pop.style.left = '72px';
      pop.style.top = '12px';
      pop.style.right = '12px';
      pop.style.width = 'auto';
      pop.style.maxWidth = 'calc(100vw - 80px)';
    }else{
      pop.style.left = (rect.right + 10) + 'px';
      pop.style.top = rect.top + 'px';
      pop.style.right = 'auto';
      pop.style.width = '320px';
    }
    pop.style.display='block';
    if(overlay) overlay.style.display='block';
    requestAnimationFrame(()=>{ pop.classList.add('open'); if(btn) btn.setAttribute('aria-expanded','true'); });
    pinnedPopoverOpen = true;
    if(pop) pop.setAttribute('aria-hidden','false');
  }
  function closePinnedPopover(){
    const pop = $('pinnedPopover');
    const overlay = $('pinnedOverlay');
    const btn = $('pinnedBarBtn');
    if(!pop) return;
    pop.classList.remove('open');
    pinnedPopoverOpen = false;
    if(btn) btn.setAttribute('aria-expanded','false');
    if(pop) pop.setAttribute('aria-hidden','true');
    setTimeout(()=>{
      if(!pinnedPopoverOpen){
        pop.style.display='none';
        if(overlay) overlay.style.display='none';
      }
    }, 180);
  }
  function togglePinnedPopover(){
    if(pinnedPopoverOpen) closePinnedPopover(); else openPinnedPopover();
  }
  function setupPinnedPopover(){
    const btn = $('pinnedBarBtn');
    const closeBtn = $('pinnedPopoverClose');
    const overlay = $('pinnedOverlay');
    if(btn && !btn.dataset.bound){
      btn.dataset.bound='1';
      btn.addEventListener('click', e=>{ e.stopPropagation(); togglePinnedPopover(); });
    }
    if(closeBtn && !closeBtn.dataset.bound){
      closeBtn.dataset.bound='1';
      closeBtn.addEventListener('click', e=>{ e.stopPropagation(); closePinnedPopover(); });
    }
    if(overlay && !overlay.dataset.bound){
      overlay.dataset.bound='1';
      overlay.addEventListener('click', closePinnedPopover);
    }
    if(!window._pinnedEscBound){
      window._pinnedEscBound=true;
      document.addEventListener('keydown', e=>{ if(e.key==='Escape' && pinnedPopoverOpen) closePinnedPopover(); });
      // 外側タップで閉じる（レール以外）
      document.addEventListener('click', e=>{
        if(!pinnedPopoverOpen) return;
        const pop = $('pinnedPopover');
        const b = $('pinnedBarBtn');
        if(!pop) return;
        if(pop.contains(e.target) || (b && b.contains(e.target))) return;
        closePinnedPopover();
      });
    }
  }
  let vibeDrawerOpen = false;
  function openVibeDrawer(){
    const drawer = $('vibeDrawer');
    const overlay = $('vibeDrawerOverlay');
    if(!drawer) return;
    drawer.style.display='flex';
    if(overlay) overlay.style.display='block';
    requestAnimationFrame(()=>{
      drawer.classList.add('open');
      if(overlay) overlay.classList.add('open');
      drawer.setAttribute('aria-hidden','false');
      vibeDrawerOpen=true;
      document.body.style.overflow='hidden';
    });
  }
  function closeVibeDrawer(){
    const drawer = $('vibeDrawer');
    const overlay = $('vibeDrawerOverlay');
    if(!drawer) return;
    drawer.classList.remove('open');
    if(overlay) overlay.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    vibeDrawerOpen=false;
    document.body.style.overflow='';
    setTimeout(()=>{
      if(!vibeDrawerOpen){
        drawer.style.display='none';
        if(overlay) overlay.style.display='none';
      }
    }, 240);
  }
  function toggleVibeDrawer(){ if(vibeDrawerOpen) closeVibeDrawer(); else openVibeDrawer(); }
  function setupVibeDrawer(){
    const btn = $('hamburgerBtn');
    const closeBtn = $('vibeDrawerClose');
    const overlay = $('vibeDrawerOverlay');
    const mypageBtn = $('drawerMypageBtn');
    const themeBtn = $('drawerThemeBtn');
    if(btn && !btn.dataset.bound){
      btn.dataset.bound='1';
      btn.addEventListener('click', e=>{ e.stopPropagation(); toggleVibeDrawer(); });
    }
    if(closeBtn && !closeBtn.dataset.bound){
      closeBtn.dataset.bound='1';
      closeBtn.addEventListener('click', e=>{ e.stopPropagation(); closeVibeDrawer(); });
    }
    if(overlay && !overlay.dataset.bound){
      overlay.dataset.bound='1';
      overlay.addEventListener('click', closeVibeDrawer);
    }
    if(mypageBtn && !mypageBtn.dataset.bound){
      mypageBtn.dataset.bound='1';
      mypageBtn.addEventListener('click', ()=>{ location.href='/mypage.html'; closeVibeDrawer(); });
    }
    if(themeBtn && !themeBtn.dataset.bound){
      themeBtn.dataset.bound='1';
      themeBtn.addEventListener('click', ()=>{
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur==='dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try{ localStorage.setItem('theme', next); }catch(e){}
        const icon = document.getElementById('themeBtnIcon');
        if(icon) icon.innerHTML = next==='dark' ? '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>' : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
      });
    }
    // ドロワー内リンクで閉じる
    const drawerLinks = document.querySelectorAll('#vibeDrawer .vibe-drawer-link');
    drawerLinks.forEach(a=>{
      if(a.dataset.bound) return;
      a.dataset.bound='1';
      a.addEventListener('click', ()=> setTimeout(closeVibeDrawer, 150));
    });
    if(!window._vibeDrawerEscBound){
      window._vibeDrawerEscBound=true;
      document.addEventListener('keydown', e=>{ if(e.key==='Escape' && vibeDrawerOpen) closeVibeDrawer(); });
    }
  }

  // カード ︙ メニュー
  let cardMenuOpen = false;
  let cardMenuSongId = null;
  let longPressTimer = null;
  function getCardMenuActions(s){
    const pinActive = loadPins().some(p=>p.id===s.id);
    return [
      {label:'次に再生', icon:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>', action:'next'},
      {label:'キューに追加', icon:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>', action:'queue'},
      {label: pinActive ? 'ピン解除' : 'ピン留め', icon:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', action:'pin'},
      {label:'共有', icon:'<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>', action:'share'},
    ];
  }
  function showCardMenu(anchorEl, song){
    const menu = $('cardMenu');
    const overlay = $('cardMenuOverlay');
    if(!menu || !song) return;
    cardMenuSongId = song.id;
    const actions = getCardMenuActions(song);
    menu.innerHTML = actions.map(a=> `<button class="card-menu-item" data-action="${a.action}">${a.icon}<span>${a.label}</span></button>`).join('');
    // 位置計算: anchorEl の rect から配置
    const rect = anchorEl.getBoundingClientRect();
    menu.style.display='block';
    // 仮表示でサイズ取得
    menu.style.visibility='hidden';
    menu.style.left='0';
    menu.style.top='0';
    requestAnimationFrame(()=>{
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.right - w;
      if(left < 8) left = 8;
      if(left + w > vw - 8) left = vw - w - 8;
      let top = rect.bottom + 6;
      if(top + h > vh - 8){
        top = rect.top - h - 6;
        if(top < 8) top = 8;
      }
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.style.visibility='visible';
      requestAnimationFrame(()=>{ menu.classList.add('open'); menu.setAttribute('aria-hidden','false'); });
      if(overlay) overlay.style.display='block';
      cardMenuOpen = true;
      // アクション紐付け
      menu.querySelectorAll('.card-menu-item').forEach(btn=>{
        btn.addEventListener('click', e=>{
          e.stopPropagation();
          const act = btn.dataset.action;
          hideCardMenu();
          if(act==='next') addNextWithAnim(song.id, anchorEl.closest('.song-card') || anchorEl);
          else if(act==='queue') { pushQueue(song.id); const n=document.createElement('div'); n.textContent='キューに追加しました'; n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(10,14,26,0.9);color:#fff;padding:8px 14px;border-radius:999px;font-size:12px;z-index:9999'; document.body.appendChild(n); setTimeout(()=>n.remove(),1500); }
          else if(act==='pin') togglePin(song.id);
          else if(act==='share') shareSong(song.id);
        });
      });
    });
  }
  function hideCardMenu(){
    const menu = $('cardMenu');
    const overlay = $('cardMenuOverlay');
    if(!menu) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden','true');
    cardMenuOpen = false;
    setTimeout(()=>{
      if(!cardMenuOpen){
        menu.style.display='none';
        if(overlay) overlay.style.display='none';
        menu.innerHTML='';
      }
    }, 160);
  }
  function setupCardMenu(){
    const overlay = $('cardMenuOverlay');
    if(overlay && !overlay.dataset.bound){
      overlay.dataset.bound='1';
      overlay.addEventListener('click', hideCardMenu);
    }
    if(!window._cardMenuEscBound){
      window._cardMenuEscBound=true;
      document.addEventListener('keydown', e=>{ if(e.key==='Escape' && cardMenuOpen) hideCardMenu(); });
      document.addEventListener('click', e=>{
        if(!cardMenuOpen) return;
        const menu = $('cardMenu');
        if(menu && menu.contains(e.target)) return;
        if(e.target.closest('.card-more')) return;
        hideCardMenu();
      });
    }
  }
  function attachCardInteractions(root){
    if(!root) return;
    root.querySelectorAll('.song-card').forEach(card=>{
      if(card.dataset.cardBound) return;
      card.dataset.cardBound='1';
      const moreBtn = card.querySelector('.card-more');
      const songId = card.dataset.id;
      const getSong = ()=> allSongs.find(s=>s.id===songId);
      if(moreBtn){
        moreBtn.addEventListener('click', e=>{
          e.stopPropagation();
          e.preventDefault();
          const s = getSong();
          if(!s) return;
          if(cardMenuOpen && cardMenuSongId===s.id) hideCardMenu(); else showCardMenu(moreBtn, s);
        });
      }
      // 長押しでメニュー（スマホ）
      let pressTimer = null;
      let startX=0, startY=0, moved=false;
      card.addEventListener('pointerdown', e=>{
        if(e.target.closest('button')) return;
        startX=e.clientX; startY=e.clientY; moved=false;
        pressTimer = setTimeout(()=>{
          if(moved) return;
          const s = getSong();
          if(!s) return;
          // バイブレーション
          if(navigator.vibrate) try{ navigator.vibrate(30); }catch(e){}
          const target = moreBtn || card;
          showCardMenu(target, s);
        }, 550);
      });
      card.addEventListener('pointermove', e=>{
        if(!pressTimer) return;
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if(dx>8 || dy>8){ moved=true; clearTimeout(pressTimer); pressTimer=null; }
      });
      card.addEventListener('pointerup', ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; }});
      card.addEventListener('pointercancel', ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; }});
      card.addEventListener('pointerleave', ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; }});
      // コピー/選択/コンテキストメニュー抑止（長押しコピー防止）
      card.addEventListener('contextmenu', e=>{ e.preventDefault(); const s=getSong(); if(s) showCardMenu(moreBtn||card, s); });
      card.addEventListener('selectstart', e=> e.preventDefault());
      card.addEventListener('copy', e=> e.preventDefault());
    });
  }

  // キュー上書き確認モーダル
  let pendingPlayId = null;
  function showQueueConfirmModal(id){
    pendingPlayId = id;
    const s = allSongs.find(x=>x.id===id);
    const title = s ? s.title : id;
    const textEl = $('queueConfirmText');
    if(textEl) textEl.textContent = `「${title}」を再生すると、現在のキュー（${queue.length}曲）はどうしますか？`;
    const overlay = $('queueConfirmOverlay');
    const modal = $('queueConfirmModal');
    if(overlay) { overlay.style.display='block'; requestAnimationFrame(()=> overlay.classList.add('open')); }
    if(modal) { modal.style.display='flex'; requestAnimationFrame(()=> modal.classList.add('open')); modal.setAttribute('aria-hidden','false'); }
  }
  function hideQueueConfirmModal(){
    const overlay = $('queueConfirmOverlay');
    const modal = $('queueConfirmModal');
    if(overlay) overlay.classList.remove('open');
    if(modal) modal.classList.remove('open');
    setTimeout(()=>{
      if(overlay) overlay.style.display='none';
      if(modal){ modal.style.display='none'; modal.setAttribute('aria-hidden','true'); }
    }, 180);
    pendingPlayId = null;
  }
  function setupQueueConfirmModal(){
    const overlay = $('queueConfirmOverlay');
    const cancelBtn = $('queueConfirmCancel');
    const nextBtn = $('queueConfirmNext');
    const replaceBtn = $('queueConfirmReplace');
    if(overlay && !overlay.dataset.bound){ overlay.dataset.bound='1'; overlay.addEventListener('click', hideQueueConfirmModal); }
    if(cancelBtn && !cancelBtn.dataset.bound){ cancelBtn.dataset.bound='1'; cancelBtn.addEventListener('click', hideQueueConfirmModal); }
    if(nextBtn && !nextBtn.dataset.bound){
      nextBtn.dataset.bound='1';
      nextBtn.addEventListener('click', ()=>{
        const id = pendingPlayId;
        hideQueueConfirmModal();
        if(id){ addNext(id); const card = document.querySelector(`.song-card[data-id="${id}"]`); if(card) addNextWithAnim(id, card); }
      });
    }
    if(replaceBtn && !replaceBtn.dataset.bound){
      replaceBtn.dataset.bound='1';
      replaceBtn.addEventListener('click', ()=>{
        const id = pendingPlayId;
        hideQueueConfirmModal();
        if(id){
          queue = [id];
          idx = -1;
          saveQueue(); renderQueue(); renderHistory();
          play(0);
        }
      });
    }
    if(!window._queueConfirmEscBound){
      window._queueConfirmEscBound=true;
      document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ const m=$('queueConfirmModal'); if(m && m.classList.contains('open')) hideQueueConfirmModal(); }});
    }
  }

  function togglePin(id, type){
    // type auto-detect: if id is playlist id
    let pls=[]; try{ pls=JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); }catch(e){}
    const isPl = pls.some(p=>p.id===id);
    const t = isPl ? 'playlist' : 'song';
    let pins = loadPins();
    const exists = pins.find(p=>p.id===id);
    if(exists){
      pins = pins.filter(p=>p.id!==id);
      savePins(pins); renderPinned(); return;
    }
    if(pins.length>=4){ alert('ピン留めは4つまでです'); return; }
    const s = allSongs.find(x=>x.id===id);
    pins.push({id, type:t, name: s? s.title : id, pinnedAt: Date.now()});
    savePins(pins); renderPinned();
    // toast
    const n=document.createElement('div'); n.textContent='ピン留めしました'; n.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(10,14,26,0.9);color:#fff;padding:8px 14px;border-radius:999px;font-size:12px;z-index:9999'; document.body.appendChild(n); setTimeout(()=>n.remove(),1500);
  }

  function renderLibrary(){
    const favCont = $('libFavorites');
    if(favCont){
      let favs=[]; try{ favs=JSON.parse(localStorage.getItem('favibe_favorites')||'[]'); }catch(e){ favs=[]; }
      const list = favs.map(id=> allSongs.find(s=>s.id===id)).filter(Boolean).slice(0,24);
      if(!list.length) favCont.innerHTML = '<p style="font-size:12px;color:#9aa3c0;grid-column:1/-1">お気に入りはまだありません。</p>';
      else favCont.innerHTML = list.map(s=>{
        const pinActive = loadPins().some(p=>p.id===s.id);
        return `<div class="song-card" data-id="${s.id}" style="cursor:pointer"><button class="card-more" data-id="${s.id}" aria-label="メニュー">︙</button><img class="song-thumb" src="${esc(s.thumbnail)}" alt=""><div class="song-meta"><div class="song-title">${esc(s.title)}</div><div class="song-artist-wrap">${renderArtistHtml(s,{mode:'card'})}</div></div><div class="card-desktop-actions" style="display:flex;gap:4px;padding:0 8px 8px"><button class="queue-add" data-id="${s.id}" style="flex:1;padding:6px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#e4e6eb;font-size:11px;cursor:pointer">次へ</button><button class="queue-push" data-id="${s.id}" style="flex:1;padding:6px;border-radius:999px;border:none;background:linear-gradient(120deg,#4fc3f7,#b48cf2);color:#fff;font-size:11px;cursor:pointer">追加</button><button class="pin-btn${pinActive?' active':''}" data-id="${s.id}" style="padding:6px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:${pinActive?'rgba(183,140,242,0.3)':'rgba(255,255,255,0.06)'};color:#e4e6eb;font-size:11px;cursor:pointer">PIN</button></div></div>`;
      }).join('');
      favCont.querySelectorAll('.song-card').forEach(el=>{
        el.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(el.dataset.id); });
        el.querySelectorAll('button').forEach(b=>{
          if(b.classList.contains('queue-add')) b.addEventListener('click', ()=> addNextWithAnim(b.dataset.id, el));
          else if(b.classList.contains('queue-push')) b.addEventListener('click', ()=> pushQueue(b.dataset.id));
          else if(b.classList.contains('pin-btn')) b.addEventListener('click', ()=> togglePin(b.dataset.id));
          else if(b.classList.contains('card-more')) b.addEventListener('click', e=>{ e.stopPropagation(); const s=allSongs.find(x=>x.id===b.dataset.id); if(s){ if(cardMenuOpen && cardMenuSongId===s.id) hideCardMenu(); else showCardMenu(b, s); }});
        });
      });
      attachCardInteractions(favCont);
    }
    const plCont = $('libPlaylists');
    if(plCont){
      let pls=[]; try{ pls=JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); }catch(e){ pls=[]; }
      if(!pls.length) plCont.innerHTML = '<p style="font-size:12px;color:#9aa3c0">自作プレイリストはまだありません。</p>';
      else plCont.innerHTML = pls.map(pl=>`<div class="pl-item" data-id="${pl.id}"><div style="flex:1"><div style="font-size:13px;font-weight:800;color:#e4e6eb">${esc(pl.name)}</div><div style="font-size:11px;color:#9aa3c0">${pl.videoIds.length}曲</div></div><button class="pl-play" data-id="${pl.id}" style="padding:6px 10px;border-radius:999px;background:linear-gradient(120deg,#4fc3f7,#b48cf2);color:#fff;border:none;font-size:11px;cursor:pointer">再生</button></div>`).join('');
      plCont.querySelectorAll('.pl-play').forEach(b=> b.addEventListener('click', ()=>{
        const pl = pls.find(x=>x.id===b.dataset.id);
        if(!pl) return;
        queue=pl.videoIds.slice(); idx=-1; saveQueue(); renderQueue(); if(queue.length) play(0); switchTab('nowplaying');
      }));
    }
    renderHistory();
  }

  function renderPresets(){
    const cont = $('presetPlaylists');
    if(!cont) return;
    if(!presets.length){ cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0">プリセットは準備中です。</p>'; return; }
    cont.innerHTML = presets.map(p=>`
      <div class="preset-card" data-id="${p.id}" style="cursor:pointer">
        <div class="preset-title">${esc(p.name)}</div>
        <div class="preset-desc">${esc(p.desc)} · BPM ${p.bpm||'-'}</div>
        <div style="margin-top:8px;font-size:11px;color:#9aa3c0">${(p.videoIds||[]).length ? (p.videoIds.length+'曲') : '自動で収集'}</div>
      </div>
    `).join('');
    cont.querySelectorAll('.preset-card').forEach(el=> el.addEventListener('click', ()=>{
      const id = el.dataset.id;
      const pre = presets.find(x=>x.id===id);
      if(!pre) return;
      let ids = pre.videoIds && pre.videoIds.length ? pre.videoIds.slice() : allSongs.slice(0,20).map(s=>s.id);
      if(pre.id==='aggressive' || pre.id==='chill'){
        ids = ids.sort(()=>Math.random()-0.5).slice(0,20);
      }
      queue = ids;
      idx = -1;
      saveQueue();
      renderQueue();
      if(queue.length) play(0);
      const bpm = pre.bpm || 110;
      const rec = $('vibeRecord');
      if(rec) rec.style.animationDuration = (60/bpm*4)+'s';
      switchTab('nowplaying');
    }));
    // タレント別プレイリスト（各タレントの全曲）
    const talentCont = document.getElementById('talentPlaylists');
    if(talentCont){
      const members = (data.members||[]);
      // デビュー順はスプレッドシートの並び順をそのまま使用
      talentCont.innerHTML = members.filter(m=> !['milpro','clip'].includes(m.id)).map(m=>{
        const cnt = allSongs.filter(s=> (s.memberIds||[s.memberId]).includes(m.id)).length;
        return `<div class="preset-card talent-card" data-id="${m.id}" style="cursor:pointer">
          <div style="display:flex;align-items:center;gap:8px"><img src="${m.icon && m.icon.startsWith('/') ? m.icon : `/images/cursors/${m.id}.png`}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.18)" onerror="this.style.display='none'"><span class="preset-title">${esc(m.name)}</span></div>
          <div class="preset-desc" style="margin-top:6px">${cnt}曲</div>
        </div>`;
      }).join('');
      talentCont.querySelectorAll('.talent-card').forEach(el=> el.addEventListener('click', ()=>{
        const mid = el.dataset.id;
        const ids = allSongs.filter(s=> (s.memberIds||[s.memberId]).includes(mid)).map(s=>s.id);
        if(!ids.length) return;
        queue = ids;
        idx=-1; saveQueue(); renderQueue(); if(queue.length) play(0); switchTab('nowplaying');
      }));
    }
  }

  function renderCustomPlaylists(){
    const cont = $('customPlaylists');
    if(!cont) return;
    let pls = [];
    try{ pls = JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); }catch(e){ pls=[]; }
    if(!pls.length){ cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0">自作プレイリストはまだありません。「新規作成」から作れます。</p>'; return; }
    cont.innerHTML = pls.map(pl=>`
      <div class="pl-item" data-id="${pl.id}">
        <div style="flex:1;cursor:pointer" class="pl-play" data-id="${pl.id}"><div style="font-size:13px;font-weight:800;color:#e4e6eb">${esc(pl.name)}</div><div style="font-size:11px;color:#9aa3c0">${pl.videoIds.length}曲</div></div>
        <button class="pl-share" data-id="${pl.id}" style="padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#e4e6eb;font-size:11px;cursor:pointer">共有</button>
        <button class="pl-del" data-id="${pl.id}" style="padding:6px 10px;border-radius:999px;border:none;background:rgba(247,143,192,0.18);color:#c25282;font-size:11px;cursor:pointer">削除</button>
      </div>
    `).join('');
    cont.querySelectorAll('.pl-play').forEach(b=> b.addEventListener('click', ()=>{
      const pl = pls.find(x=>x.id===b.dataset.id);
      if(!pl) return;
      queue = pl.videoIds.slice();
      idx=-1;
      saveQueue();
      renderQueue();
      if(queue.length) play(0);
      switchTab('nowplaying');
    }));
    cont.querySelectorAll('.pl-share').forEach(b=> b.addEventListener('click', ()=> sharePlaylist(b.dataset.id)));
    cont.querySelectorAll('.pl-del').forEach(b=> b.addEventListener('click', ()=>{
      const id = b.dataset.id;
      pls = pls.filter(x=>x.id!==id);
      try{ localStorage.setItem('favibe_playlists', JSON.stringify(pls)); }catch(e){}
      if(typeof getMilliproUid==='function' && getMilliproUid() && typeof mpWriteCloud==='function'){
        mpWriteCloud(getMilliproUid(),'millivibePlaylists', pls);
      }
      renderCustomPlaylists();
      renderLibrary();
    }));
  }

  function renderRanking(){
    const cont = $('rankingList');
    if(!cont) return;
    const plays = loadPlays();
    const counts = {};
    for(const k in plays){ if(k.includes('_')) continue; counts[k]=plays[k]; }
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,20);
    if(!sorted.length){
      const latest = allSongs.slice(0,10);
      cont.innerHTML = latest.map((s,i)=>{
        const artistHtml = renderArtistHtml(s,{mode:'rank'});
        return `
        <div class="rank-item" data-id="${s.id}" style="cursor:pointer">
          <span style="width:24px;font-weight:800;color:#9aa3c0;text-align:center">${i+1}</span>
          <img class="song-thumb" src="${esc(s.thumbnail)}" alt="">
          <div class="song-meta"><div class="song-title">${esc(s.title)}</div><div class="song-artist">${artistHtml} · 視聴: - · 再生: ${counts[s.id]||0}回</div></div>
        </div>
      `}).join('');
    }else{
      cont.innerHTML = sorted.map(([id,cnt],i)=>{
        const s = allSongs.find(x=>x.id===id);
        const title = s ? s.title : id;
        const thumb = s ? s.thumbnail : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        const artistHtml = s ? renderArtistHtml(s,{mode:'rank'}) : '';
        const nameFallback = s ? esc(s.memberName) : '';
        return `<div class="rank-item" data-id="${id}" style="cursor:pointer">
          <span style="width:24px;font-weight:800;color:#9aa3c0;text-align:center">${i+1}</span>
          <img class="song-thumb" src="${esc(thumb)}" alt="">
          <div class="song-meta"><div class="song-title">${esc(title)}</div><div class="song-artist">${artistHtml || nameFallback} · 再生: ${cnt}回</div></div>
        </div>`;
      }).join('');
    }
    cont.querySelectorAll('.rank-item').forEach(el=> el.addEventListener('click', ()=> playById(el.dataset.id)));
  }

  function setupPlayer(){
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player('vibePlayer', {
        height: '270',
        width: '480',
        videoId: '',
        playerVars: { controls:1, rel:0, modestbranding:1, playsinline:1, origin: location.origin },
        events: { onReady: ()=>{ playerReady=true; if($('vibeLoading')) $('vibeLoading').style.display='none'; }, onStateChange: onStateChange }
      });
    };
    if(window.YT && window.YT.Player) window.onYouTubeIframeAPIReady();
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState==='visible' && pending){
        const nxt = pending; pending=null;
        const i = queue.indexOf(nxt);
        if(i>=0) play(i);
        else { queue.unshift(nxt); play(0); }
      }
    });
    // mini player progress
    setInterval(()=>{
      const bar = $('miniProgress');
      if(!bar || !player || !player.getCurrentTime || !player.getDuration) return;
      try{
        const cur = player.getCurrentTime()||0;
        const dur = player.getDuration()||0;
        const pct = dur ? (cur/dur*100) : 0;
        bar.style.width = pct+'%';
        // update mini player visibility
        const mini = $('miniPlayer');
        const wrap = $('vibePlayerWrap');
        if(mini && wrap){
          const r = wrap.getBoundingClientRect();
          const isOut = r.bottom < 0 || r.top > window.innerHeight;
          const shouldShow = playerReady && queue.length && (isOut || (player.getPlayerState && player.getPlayerState()===YT.PlayerState.PLAYING));
          mini.style.display = shouldShow ? 'flex' : 'none';
        }
      }catch(e){}
    }, 500);
  }
  function onStateChange(e){
    const rec = $('vibeRecord');
    if(e.data===YT.PlayerState.PLAYING){
      if(rec) rec.classList.add('playing');
      const vid = player.getVideoData ? player.getVideoData().video_id : null;
      if(vid) incPlay(vid);
      if($('vibeLoading')) $('vibeLoading').style.display='none';
    }else if(e.data===YT.PlayerState.PAUSED){
      if(rec) rec.classList.remove('playing');
    }else if(e.data===YT.PlayerState.ENDED){
      if(rec) rec.classList.remove('playing');
      if(!autoNext) return;
      if(document.visibilityState !== 'visible'){
        const nxt = getNextId();
        if(nxt) pending = nxt;
        return;
      }
      playNext();
    }else if(e.data===YT.PlayerState.BUFFERING){
      if($('vibeLoading')) $('vibeLoading').style.display='flex';
    }
  }
  function getNextId(){
    if(!queue.length) return null;
    if(repeat==='one' && idx>=0) return queue[idx];
    let n = idx+1;
    if(n>=queue.length){
      if(repeat==='all') n=0;
      else if(automix){
        const cur = allSongs.find(s=>s.id===queue[idx]);
        const pool = allSongs.filter(s=> !queue.includes(s.id) && (cur ? (s.memberIds||[s.memberId]).includes(cur.memberId) : true));
        if(pool.length){ const pick = pool[Math.floor(Math.random()*pool.length)]; queue.push(pick.id); saveQueue(); renderQueue(); return pick.id; }
        return null;
      }else return null;
    }
    return queue[n];
  }
  function playNext(){
    const nid = getNextId();
    if(!nid) return;
    const nIdx = queue.indexOf(nid);
    if(nIdx>=0) play(nIdx);
    else { queue.push(nid); play(queue.length-1); }
  }
  function playPrev(){
    if(!queue.length) return;
    let p = idx-1;
    if(p<0){
      if(repeat==='all') p=queue.length-1;
      else return;
    }
    play(p);
  }
  function play(i){
    if(i<0 || i>=queue.length) return;
    const prevIdx = idx;
    const prevId = (prevIdx>=0 && prevIdx<queue.length) ? queue[prevIdx] : null;
    let targetIdx = i;
    const targetId = queue[targetIdx];
    // キューから再生済みを削除（repeat off のときのみ、同じ曲の再再生は除外）
    if(prevIdx>=0 && prevIdx!==targetIdx && prevId && prevId!==targetId && repeat==='off'){
      // アニメーション先に
      try{
        const prevEl = document.querySelector(`#queueList .queue-item[data-idx="${prevIdx}"]`);
        if(prevEl){
          prevEl.style.transition='transform 0.35s, opacity 0.35s, height 0.35s';
          prevEl.style.transform='translateY(-24px) scale(0.96)';
          prevEl.style.opacity='0';
        }
      }catch(e){}
      // 少し遅延して削除（アニメーションを見せる）
      setTimeout(()=>{
        const curPos = queue.indexOf(prevId);
        if(curPos>=0){
          queue.splice(curPos,1);
          if(curPos < idx) idx--;
          else if(curPos===idx) idx=-1;
          saveQueue(); renderQueue();
        }
      }, 350);
    }else if(prevIdx>=0 && prevIdx!==targetIdx){
      // repeat中はアニメーションのみ
      try{
        const prevEl = document.querySelector(`#queueList .queue-item[data-idx="${prevIdx}"]`);
        if(prevEl){
          prevEl.style.transition='transform 0.35s, opacity 0.35s, height 0.35s';
          prevEl.style.transform='translateY(-24px) scale(0.96)';
          prevEl.style.opacity='0';
        }
      }catch(e){}
    }
    idx=targetIdx;
    const id = queue[idx];
    if(!id) return;
    const s = allSongs.find(x=>x.id===id);
    if(s){
      if($('nowTitle')) $('nowTitle').textContent = s.title;
      if($('nowArtist')) $('nowArtist').innerHTML = renderArtistHtml(s,{mode:'now'});
      if($('recordThumb')){ $('recordThumb').src = s.thumbnail; $('recordThumb').style.display='block'; }
      if($('miniTitle')) $('miniTitle').textContent = s.title;
      if($('miniArtist')) $('miniArtist').innerHTML = renderArtistHtml(s,{mode:'mini'});
      if($('miniThumb')){ $('miniThumb').src = s.thumbnail; }
      try{ attachArtistToggles($('nowArtist')); }catch(e){}
      try{ attachArtistToggles($('miniArtist')); }catch(e){}
    }
    if(!playerReady || !player || !player.loadVideoById){
      setTimeout(()=> play(idx), 500);
      return;
    }
    player.loadVideoById(id);
    // renderは削除アニメーション後に再度行われるが一旦即時反映
    renderQueue();
    renderHistory();
    const pre = presets.find(p=> (p.videoIds||[]).includes(id));
    const bpm = pre ? pre.bpm : 110;
    const rec = $('vibeRecord');
    if(rec) rec.style.animationDuration = (60/bpm*4)+'s';
  }
  function playById(id){
    const i = queue.indexOf(id);
    if(i>=0){ play(i); return; }
    // キューに曲がある状態で新規再生はモーダルで確認
    if(queue.length>0){
      showQueueConfirmModal(id);
      return;
    }
    queue.unshift(id); idx=-1; saveQueue(); renderQueue(); renderHistory(); play(0);
  }
  function addNext(id){
    if(!queue.length){ queue=[id]; idx=-1; }
    else {
      const pos = idx+1;
      queue.splice(pos,0,id);
    }
    saveQueue(); renderQueue(); renderHistory();
  }
  function pushQueue(id){
    if(!queue.includes(id)) queue.push(id);
    saveQueue(); renderQueue();
  }
  function removeQueue(i){
    queue.splice(i,1);
    if(i===idx) { idx=-1; if(player) try{ player.stopVideo(); }catch(e){} }
    else if(i<idx) idx--;
    saveQueue(); renderQueue();
  }
  function shareSong(id){
    const url = location.origin + '/#song=' + encodeURIComponent(id);
    if(navigator.clipboard) navigator.clipboard.writeText(url).then(()=> alert('リンクをコピーしました'));
    else prompt('共有リンク', url);
  }
  function sharePlaylist(plId){
    const url = location.origin + '/#playlist=' + encodeURIComponent(plId);
    if(navigator.clipboard) navigator.clipboard.writeText(url).then(()=> alert('プレイリストリンクをコピーしました'));
    else prompt('共有リンク', url);
  }
  function setupControls(){
    if($('btnPlay')) $('btnPlay').addEventListener('click', ()=>{
      if(!player) return;
      const state = player.getPlayerState ? player.getPlayerState() : -1;
      if(state===YT.PlayerState.PLAYING) player.pauseVideo();
      else if(idx>=0) player.playVideo();
      else if(queue.length) play(0);
      else if(allSongs.length) { queue=[allSongs[0].id]; saveQueue(); renderQueue(); play(0); }
    });
    if($('btnPrev')) $('btnPrev').addEventListener('click', playPrev);
    if($('btnNext')) $('btnNext').addEventListener('click', playNext);
    if($('btnShuffle')) $('btnShuffle').addEventListener('click', ()=>{
      shuffle = !shuffle;
      $('btnShuffle').classList.toggle('active', shuffle);
      if(shuffle){
        for(let i=queue.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [queue[i], queue[j]]=[queue[j], queue[i]]; }
        idx=-1;
        saveQueue(); renderQueue();
      }
      saveSettings();
    });
    if($('btnRepeat')) $('btnRepeat').addEventListener('click', ()=>{
      repeat = repeat==='off' ? 'all' : repeat==='all' ? 'one' : 'off';
      $('btnRepeat').dataset.mode = repeat;
      $('btnRepeat').classList.toggle('active', repeat!=='off');
      $('btnRepeat').textContent = repeat==='one' ? 'ONE' : repeat==='all' ? 'ALL' : 'REP';
      saveSettings();
    });
    if($('btnAutomix')) $('btnAutomix').addEventListener('click', ()=>{
      automix = !automix;
      $('btnAutomix').dataset.on = automix?'1':'0';
      $('btnAutomix').classList.toggle('active', automix);
      saveSettings();
    });
    if($('autoNextToggle')) $('autoNextToggle').addEventListener('change', e=>{
      autoNext = e.target.checked;
      saveSettings();
    });
    if($('btnClearQueue')) $('btnClearQueue').addEventListener('click', ()=>{ queue=[]; idx=-1; saveQueue(); renderQueue(); renderHistory(); });
    if($('btnPip')) $('btnPip').addEventListener('click', async ()=>{
      try{
        const iframe = document.querySelector('#vibePlayer iframe');
        if(!iframe) return;
        if(document.pictureInPictureElement) await document.exitPictureInPicture();
        if(iframe.requestPictureInPicture) await iframe.requestPictureInPicture();
        else iframe.requestFullscreen?.();
      }catch(e){ console.warn(e); }
    });
    if($('volSlider')) $('volSlider').addEventListener('input', e=>{
      const v = parseInt(e.target.value,10);
      if(player && player.setVolume) player.setVolume(v);
    });
    const volPopup = $('volPopup');
    const volWrap = document.querySelector('.vol-popup-wrap');
    let volPopupOpen = false;
    function openVolPopup(){
      if(!volPopup) return;
      volPopup.style.display='flex';
      requestAnimationFrame(()=> volPopup.classList.add('open'));
      volPopupOpen = true;
    }
    function closeVolPopup(){
      if(!volPopup) return;
      volPopup.classList.remove('open');
      volPopupOpen = false;
      setTimeout(()=>{ if(!volPopupOpen) volPopup.style.display='none'; }, 150);
    }
    if($('volMuteBtn')) $('volMuteBtn').addEventListener('click', e=>{
      e.stopPropagation();
      if(volPopupOpen) closeVolPopup(); else openVolPopup();
    });
    // 外側タップで閉じる
    document.addEventListener('click', e=>{
      if(!volPopupOpen) return;
      const popup = $('volPopup');
      const btn = $('volMuteBtn');
      if(!popup) return;
      if(popup.contains(e.target) || (btn && btn.contains(e.target))) return;
      closeVolPopup();
    });
    // 長押しでミュート切替（オプション）
    if($('volMuteBtn')) $('volMuteBtn').addEventListener('contextmenu', e=>{
      e.preventDefault();
      if(!player || !player.isMuted) return;
      try{
        if(player.isMuted()){
          player.unMute();
          const v = parseInt($('volSlider')?.value || '80',10);
          if(player.setVolume) player.setVolume(v);
          updateVolUI(v);
        }else{
          player.mute();
          updateVolUI(0);
        }
      }catch(e){}
    });
    if($('miniPrev')) $('miniPrev').addEventListener('click', playPrev);
    if($('miniNext')) $('miniNext').addEventListener('click', playNext);
    if($('miniPlay')) $('miniPlay').addEventListener('click', ()=>{
      if(!player) return;
      const st = player.getPlayerState ? player.getPlayerState() : -1;
      if(st===YT.PlayerState.PLAYING) player.pauseVideo(); else if(idx>=0) player.playVideo(); else if(queue.length) play(0);
    });
    if($('miniExpand')) $('miniExpand').addEventListener('click', ()=>{ switchTab('nowplaying'); document.querySelector('.vibe-now-grid')?.scrollIntoView({behavior:'smooth'}); });
    if($('songSearch')) $('songSearch').addEventListener('input', e=> renderSearch(e.target.value));
    if($('btnCreatePlaylist')) $('btnCreatePlaylist').addEventListener('click', ()=>{
      const name = prompt('プレイリスト名を入力');
      if(!name) return;
      let pls = [];
      try{ pls = JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); }catch(e){ pls=[]; }
      const pl = { id: 'pl_'+Date.now(), name, videoIds: queue.slice(), createdAt: Date.now() };
      pls.push(pl);
      try{ localStorage.setItem('favibe_playlists', JSON.stringify(pls)); }catch(e){}
      if(typeof getMilliproUid==='function' && getMilliproUid() && typeof mpWriteCloud==='function'){
        mpWriteCloud(getMilliproUid(),'millivibePlaylists', pls);
      }
      renderCustomPlaylists();
      renderLibrary();
    });
    window.addEventListener('hashchange', handleHash);
    handleHash();
  }
  function handleHash(){
    const h = location.hash||'';
    if(h.startsWith('#song=')){
      const id = decodeURIComponent(h.slice(6));
      if(id) playById(id);
    }else if(h.startsWith('#playlist=')){
      const pid = decodeURIComponent(h.slice(10));
      let pls=[];
      try{ pls=JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); }catch(e){}
      const pl = pls.find(x=>x.id===pid);
      if(pl){ queue=pl.videoIds.slice(); idx=-1; saveQueue(); renderQueue(); renderHistory(); if(queue.length) play(0); }
    }
  }
  function setupTabs(){
    const tabs = document.querySelectorAll('.vibe-side-nav .vibe-nav-item');
    const map = { nowplaying: 'vibeNowSec', search: 'vibeSearchSec', library: 'vibeLibrarySec', ranking: 'vibeRankingSec', playlists: 'vibePlaylistsSec' };
    function switchTab(tab){
      tabs.forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
      Object.entries(map).forEach(([k, id])=>{
        const sec = $(id);
        if(sec) sec.style.display = (k===tab)?'':'none';
      });
      if(tab==='ranking') renderRanking();
      if(tab==='library') renderLibrary();
      if(tab==='search') renderSearch($('songSearch')?$('songSearch').value:'');
    }
    tabs.forEach(btn=> btn.addEventListener('click', ()=> switchTab(btn.dataset.tab)));
    // fallback for old tabMenu
    const oldTabs = document.querySelectorAll('#millivibeTabMenu .tab-item');
    oldTabs.forEach(btn=> btn.addEventListener('click', ()=> switchTab(btn.dataset.tab==='player'?'nowplaying':btn.dataset.tab)));
    switchTab('nowplaying');
    window.switchTab = switchTab;
    // pinned bar always visible
    renderPinnedBar();
  }
  let searchOffset = 100;
  function setupSearch(){
    // populate talent filter
    const ft = $('filterTalent');
    if(ft && data && data.members){
      ft.innerHTML = '<option value="">全タレント</option>' + data.members.filter(m=> !['milpro','clip'].includes(m.id)).map(m=> `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    }
    const fp = $('filterPlaylist');
    if(fp){
      const pls = presets.map(p=> `<option value="${p.id}">${esc(p.name)}</option>`).join('');
      fp.innerHTML = '<option value="">全プレイリスト</option>' + pls;
    }
    const tags = $('searchTags');
    if(tags){
      tags.innerHTML = presets.map(p=> `<button class="search-tag" data-id="${p.id}" style="padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#9aa3c0;font-size:11px;cursor:pointer">#${esc(p.name)}</button>`).join('');
      tags.querySelectorAll('.search-tag').forEach(b=> b.addEventListener('click', ()=>{
        const id=b.dataset.id;
        b.classList.toggle('active');
        b.style.background = b.classList.contains('active') ? 'rgba(183,140,242,0.3)' : 'rgba(255,255,255,0.06)';
        renderSearch($('songSearch')?$('songSearch').value:'');
      }));
    }
    const favChk = $('filterFavorites');
    if(favChk) favChk.addEventListener('change', ()=> renderSearch($('songSearch')?$('songSearch').value:''));
    if(ft) ft.addEventListener('change', ()=> renderSearch($('songSearch')?$('songSearch').value:''));
    if(fp) fp.addEventListener('change', ()=> renderSearch($('songSearch')?$('songSearch').value:''));
    const sortSel = $('sortSelect');
    if(sortSel) sortSel.addEventListener('change', ()=> renderSearch($('songSearch')?$('songSearch').value:''));
    const sInput = $('songSearch');
    if(sInput){
      sInput.addEventListener('input', e=>{
        const v=e.target.value;
        // suggest
        const sug = $('searchSuggest');
        if(sug){
          if(!v.trim()){ sug.innerHTML=''; }
          else {
            const low=v.toLowerCase();
            const sugg = allSongs.filter(s=> s.title.toLowerCase().includes(low)).slice(0,5).map(s=> `<span class="suggest-chip" data-title="${esc(s.title)}" style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#e4e6eb;font-size:11px;cursor:pointer">${esc(s.title.slice(0,20))}</span>`).join('');
            sug.innerHTML = sugg;
            sug.querySelectorAll('.suggest-chip').forEach(c=> c.addEventListener('click', ()=>{ sInput.value=c.dataset.title; renderSearch(c.dataset.title); }));
          }
        }
        renderSearch(v);
      });
    }
    const btnAll = $('btnShowAllSongs');
    if(btnAll) btnAll.addEventListener('click', ()=>{
      const filtered = getFilteredSongs();
      const cont = $('searchResults');
      if(!cont) return;
      const current = cont.children.length;
      const next = filtered.slice(current, current+100);
      if(!next.length){ btnAll.textContent='すべて表示済み'; btnAll.disabled=true; return; }
      const frag = document.createDocumentFragment();
      next.forEach(s=>{
        const div = document.createElement('div');
        div.className='song-card';
        div.dataset.id=s.id;
        div.style.cursor='pointer';
        const pinActive = loadPins().some(p=>p.id===s.id);
        div.innerHTML = `<button class="card-more" data-id="${s.id}" aria-label="メニュー">︙</button><img class="song-thumb" src="${esc(s.thumbnail)}" alt=""><div class="song-meta"><div class="song-title">${esc(s.title)}</div><div class="song-artist-wrap">${renderArtistHtml(s,{mode:'card'})}</div></div><div class="card-desktop-actions" style="display:flex;gap:4px;padding:0 8px 8px"><button class="queue-add" data-id="${s.id}" style="flex:1;padding:6px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#e4e6eb;font-size:11px;cursor:pointer">次へ</button><button class="queue-push" data-id="${s.id}" style="flex:1;padding:6px;border-radius:999px;border:none;background:linear-gradient(120deg,#4fc3f7,#b48cf2);color:#fff;font-size:11px;cursor:pointer">追加</button><button class="pin-btn${pinActive?' active':''}" data-id="${s.id}" style="padding:6px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:${pinActive?'rgba(183,140,242,0.3)':'rgba(255,255,255,0.06)'};color:#e4e6eb;font-size:11px;cursor:pointer">PIN</button></div>`;
        div.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(s.id); });
        div.querySelectorAll('button').forEach(b=>{
          if(b.classList.contains('queue-add')) b.addEventListener('click', ()=> addNextWithAnim(b.dataset.id, div));
          else if(b.classList.contains('queue-push')) b.addEventListener('click', ()=> pushQueue(b.dataset.id));
          else if(b.classList.contains('pin-btn')) b.addEventListener('click', ()=> togglePin(b.dataset.id));
          else if(b.classList.contains('card-more')) b.addEventListener('click', e=>{ e.stopPropagation(); const song=allSongs.find(x=>x.id===b.dataset.id); if(song){ if(cardMenuOpen && cardMenuSongId===song.id) hideCardMenu(); else showCardMenu(b, song); }});
        });
        frag.appendChild(div);
      });
      cont.appendChild(frag);
      attachCardInteractions(cont);
      if(cont.children.length >= filtered.length){ btnAll.textContent='すべて表示済み'; btnAll.disabled=true; }
      else btnAll.textContent=`もっと見る (${cont.children.length}/${filtered.length})`;
    });
    renderSearch('');
  }
  function getFilteredSongs(){
    let list = allSongs.slice();
    const q = ($('songSearch')?$('songSearch').value:'').toLowerCase().trim();
    const ft = $('filterTalent')?$('filterTalent').value:'';
    const fp = $('filterPlaylist')?$('filterPlaylist').value:'';
    const favOnly = $('filterFavorites')?$('filterFavorites').checked:false;
    const sort = $('sortSelect')?$('sortSelect').value:'new';
    const activeTags = [...document.querySelectorAll('#searchTags .search-tag.active')].map(b=>b.dataset.id);
    if(q){
      const keys = q.split(/\s+/).filter(Boolean);
      list = list.filter(s=>{
        const names = (s.memberNames||[s.memberName]).join(' ');
        const hay = (s.title+' '+names+' '+s.playlistName).toLowerCase();
        return keys.every(k=> hay.includes(k));
      });
    }
    if(ft) list = list.filter(s=> (s.memberIds||[s.memberId]).includes(ft));
    if(fp){
      const pre = presets.find(p=>p.id===fp);
      if(pre && pre.videoIds && pre.videoIds.length) list = list.filter(s=> pre.videoIds.includes(s.id));
    }
    if(activeTags.length){
      list = list.filter(s=> activeTags.some(tid=>{
        const pre = presets.find(p=>p.id===tid);
        return pre && pre.videoIds && pre.videoIds.includes(s.id);
      }));
    }
    if(favOnly){
      let favs=[]; try{ favs=JSON.parse(localStorage.getItem('favibe_favorites')||'[]'); }catch(e){}
      list = list.filter(s=> favs.includes(s.id));
    }
    if(sort==='name') list.sort((a,b)=> a.title.localeCompare(b.title));
    else if(sort==='popular'){
      const plays=loadPlays(); const counts={}; for(const k in plays){ if(k.includes('_')) continue; counts[k]=plays[k]; }
      list.sort((a,b)=> (counts[b.id]||0)-(counts[a.id]||0));
    }else if(sort==='plays'){
      const plays=loadPlays(); const counts={}; for(const k in plays){ if(k.includes('_')) continue; counts[k]=plays[k]; }
      list.sort((a,b)=> (counts[b.id]||0)-(counts[a.id]||0));
    }else{ // new
      list.sort((a,b)=> new Date(b.publishedAt)-new Date(a.publishedAt));
    }
    return list;
  }

// ── favibe: 推し選択共有 (Firebase + local fallback) ──
const FavibeOshi = (function(){
  const LS_KEY = 'favibe_selected_artists';
  const FB_PATH = 'favibe/selectedArtists';
  let artistsMaster = null;
  let selected = [];
  let lockedIds = [];
  const ALIAS_MAP = {"tamanoinana":"nana-tamanoi"};
  let currentGroup = "";
  let showAddedOnly = false;
  let _fbUnsub = null;
  async function loadLocked(){
    try{
      const r = await fetch('./site-config.json');
      const j = await r.json();
      if(j.favibe && Array.isArray(j.favibe.initialArtists) && j.favibe.initialArtists.length){
        lockedIds = j.favibe.initialArtists.slice();
      }
    }catch(e){}
    if(!lockedIds.length){
      try{
        const r2 = await fetch('./data.json');
        const d = await r2.json();
        lockedIds = (d.members||[]).map(m=>m.id);
      }catch(e){}
    }
    // fallback: if still empty, use all master later
    return lockedIds;
  }
  function getLocked(){ return lockedIds.slice(); }
  function isLocked(id){ return lockedIds.includes(id); }
  function isAdded(a){
    if(!a) return false;
    if(isLocked(a.id)) return true;
    if(a.playlistId && a.playlistId.trim()) return true;
    if(a.playlistIds && Array.isArray(a.playlistIds) && a.playlistIds.length) return true;
    // also check if has data in data.json members (if loaded, but we can check via allSongs? fallback)
    try{
      if(typeof allSongs !== 'undefined' && Array.isArray(allSongs)){
        if(allSongs.some(s=> s.memberId===a.id)) return true;
      }
    }catch(e){}
    return false;
  }

  function esc(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function normalizeIds(ids){
    return (ids||[]).map(id=> ALIAS_MAP[id] || id);
  }

  function loadLocal(){
    try{
      const v = JSON.parse(localStorage.getItem(LS_KEY)||'null');
      if(Array.isArray(v)) return normalizeIds(v);
    }catch(e){}
    return [];
  }
  function saveLocal(ids){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(ids)); }catch(e){}
  }
  function getSelected(){ return selected.slice(); }

  async function loadMaster(){
    if(artistsMaster) return artistsMaster;
    try{
      const r = await fetch('./artists-master.json');
      const j = await r.json();
      artistsMaster = j.artists || [];
    }catch(e){ artistsMaster=[]; }
    return artistsMaster;
  }

  function saveToFirebase(ids){
    try{
      if(typeof firebase!=='undefined' && firebase.database){
        if(typeof initFirebase==='function') try{ initFirebase(); }catch(e){}
        if(typeof firebaseReady!=='undefined' && !firebaseReady){
          // try init but if config missing, skip
          if(typeof firebaseConfig==='undefined' || !firebaseConfig.apiKey) return Promise.resolve();
        }
        // anonymous sign-in if needed
        const doWrite = () => firebase.database().ref(FB_PATH).set(ids);
        if(typeof firebase.auth==='function'){
          const auth = firebase.auth();
          if(!auth.currentUser){
            return auth.signInAnonymously().then(doWrite).catch(()=> doWrite());
          }
        }
        return doWrite().catch(()=>{});
      }
    }catch(e){}
    return Promise.resolve();
  }

  function listenFirebase(cb){
    try{
      if(typeof firebase==='undefined' || !firebase.database) return;
      if(typeof initFirebase==='function') try{ initFirebase(); }catch(e){}
      if(typeof firebaseConfig==='undefined' || !firebaseConfig.apiKey) return;
      const ref = firebase.database().ref(FB_PATH);
      const handler = ref.on('value', snap=>{
        let v = snap.val();
        if(Array.isArray(v)){
          v = normalizeIds(v);
          selected = v.slice();
          saveLocal(selected);
          cb && cb(selected);
        }
      });
      _fbUnsub = ()=> ref.off('value', handler);
    }catch(e){}
  }

  async function initSelected(){
    // Firebase優先、なければlocal
    let fbLoaded = false;
    try{
      if(typeof firebase!=='undefined' && firebase.database && typeof firebaseConfig!=='undefined' && firebaseConfig.apiKey){
        if(typeof initFirebase==='function') try{ initFirebase(); }catch(e){}
        // try anonymous
        if(typeof firebase.auth==='function' && !firebase.auth().currentUser){
          try{ await firebase.auth().signInAnonymously(); }catch(e){}
        }
        const snap = await firebase.database().ref(FB_PATH).once('value');
        let v = snap.val();
        if(Array.isArray(v) && v.length){
          v = normalizeIds(v);
          selected = v.slice();
          saveLocal(selected);
          fbLoaded = true;
        }
      }
    }catch(e){}
    if(!fbLoaded){
      selected = loadLocal();
      // if Firebase empty but local has data, push local to Firebase (first user)
      if(selected.length){
        saveToFirebase(selected);
      }
    }
    // ensure locked artists are always included and alias normalized
    selected = normalizeIds(selected);
    lockedIds = normalizeIds(lockedIds);
    if(lockedIds.length){
      const set = new Set(selected);
      for(const id of lockedIds) set.add(id);
      // if selected was empty, default to locked
      if(!selected.length) selected = lockedIds.slice();
      else selected = Array.from(set);
      // dedup & keep locked order first
      selected = [...lockedIds, ...selected.filter(x=> !lockedIds.includes(x))];
      // persist if we added locked
      saveLocal(selected);
      saveToFirebase(selected);
    }
    return selected;
  }

  async function setSelected(ids){
    // ensure locked always included and alias normalized
    ids = normalizeIds(ids);
    const set = new Set(ids);
    for(const id of lockedIds) set.add(id);
    selected = [...lockedIds, ...Array.from(set).filter(x=> !lockedIds.includes(x))];
    if(!selected.length && lockedIds.length) selected = lockedIds.slice();
    saveLocal(selected);
    await saveToFirebase(selected);
    updateStatus();
  }

  function updateStatus(){
    const el = document.getElementById('oshiStatus');
    if(!el) return;
    const n = selected.length;
    const masterLen = artistsMaster ? artistsMaster.length : 0;
    const lockedN = lockedIds.length;
    if(!n){
      el.innerHTML = '<span style="color:#f78fc0">推しが未選択です</span> <button id="oshiStatusBtn" style="margin-left:8px;padding:4px 10px;border-radius:999px;border:none;background:linear-gradient(120deg,#4fc3f7,#b48cf2);color:#fff;font-size:11px;font-weight:800;cursor:pointer">推しを選ぶ</button>';
      const b = el.querySelector('#oshiStatusBtn');
      if(b) b.addEventListener('click', ()=> FavibeOshi.open());
    } else {
      const names = artistsMaster ? selected.map(id=> (artistsMaster.find(a=>a.id===id)||{name:id}).name).join('、') : selected.join(', ');
      el.innerHTML = `選択中: <b style="color:#e4e6eb">${n}件</b> <span style="opacity:0.8">${esc(names)}</span> <button id="oshiStatusBtn" style="margin-left:8px;padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e4e6eb;font-size:11px;cursor:pointer">変更</button> <span id="oshiSyncDot" style="margin-left:6px;font-size:10px;opacity:0.6"></span>`;
      const b = el.querySelector('#oshiStatusBtn');
      if(b) b.addEventListener('click', ()=> FavibeOshi.open());
      const dot = el.querySelector('#oshiSyncDot');
      if(dot){
        const fbOk = (typeof firebaseConfig!=='undefined' && firebaseConfig.apiKey) ? '● Firebase同期' : '○ ローカル保存';
        dot.textContent = fbOk;
      }
    }
  }

  // Modal logic
  let modalSelected = [];

  function renderModal(){
    const grid = document.getElementById('oshiGrid');
    const chips = document.getElementById('oshiSelectedChips');
    const count = document.getElementById('oshiCount');
    const hint = document.getElementById('oshiHint');
    if(!grid || !artistsMaster) return;
    const q = (document.getElementById('oshiSearch')?.value||'').toLowerCase().trim();
    let list = artistsMaster;
    if(showAddedOnly){
      list = list.filter(a=> isAdded(a));
    }
    if(currentGroup){
      list = list.filter(a=> a.group===currentGroup);
    }
    if(q){
      list = list.filter(a=> (a.name+a.id+(a.enName||'')+(a.group||'')).toLowerCase().includes(q));
    }
    // update group counts
    try{
      document.querySelectorAll('.oshi-group-count').forEach(el=>{
        const g = el.dataset.group;
        let base = g ? artistsMaster.filter(a=> a.group===g) : artistsMaster;
        if(showAddedOnly) base = base.filter(a=> isAdded(a));
        const cnt = base.length;
        el.textContent = `(${cnt})`;
      });
      const addedEl = document.getElementById('oshiAddedCount');
      if(addedEl){
        const addedTotal = artistsMaster.filter(a=> isAdded(a)).length;
        addedEl.textContent = `(${addedTotal})`;
      }
    }catch(e){}
    // update group button active state
    try{
      document.querySelectorAll('.oshi-group-btn').forEach(btn=>{
        const active = btn.dataset.group===currentGroup;
        btn.classList.toggle('active', active);
        if(active){
          btn.style.background='linear-gradient(120deg,#4fc3f7,#b48cf2)';
          btn.style.color='#fff';
          btn.style.border='none';
        } else {
          btn.style.background='rgba(255,255,255,0.06)';
          btn.style.color='#e4e6eb';
          btn.style.border='1px solid rgba(255,255,255,0.12)';
        }
      });
    }catch(e){}
    grid.innerHTML = list.map(a=>{
      const sel = modalSelected.includes(a.id);
      const locked = isLocked(a.id);
      const color = a.color || '#9aa3c0';
      const avatar = a.avatar ? (a.avatar + (a.avatar.includes('?')?'&':'?') + 'w=80&h=80&fit=crop&auto=format') : '';
      const avatarHtml = avatar ? `<img src="${esc(avatar)}" alt="" loading="lazy" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid rgba(255,255,255,0.12);background:#222">` : `<span style="width:36px;height:36px;border-radius:50%;background:${esc(color)};flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:14px">🎤</span>`;
      return `<div class="oshi-card ${sel?'selected':''} ${locked?'locked':''}" data-id="${esc(a.id)}" ${locked?'title="配信中のため変更できません"':''} style="${locked?'opacity:0.92;cursor:default':''}">${avatarHtml}<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:800;color:#e4e6eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}${locked?' <span style="font-size:10px;color:#4fc3f7;margin-left:4px">●選択済</span>':''}</div><div style="font-size:10px;color:#9aa3c0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.group||'')}${a.enName?' / '+esc(a.enName):''}${locked?' ・ロック中':''}</div></div><span class="oshi-check" style="${sel?'':''}">${sel?'✓':''}</span>${locked?'<span style="font-size:12px;margin-left:2px">🔒</span>':''}</div>`;
    }).join('');
    grid.querySelectorAll('.oshi-card').forEach(el=>{
      el.addEventListener('click', ()=>{
        const id = el.dataset.id;
        if(isLocked(id)) return;
        if(modalSelected.includes(id)) modalSelected = modalSelected.filter(x=>x!==id);
        else modalSelected.push(id);
        renderModal();
      });
    });
    if(count) count.textContent = `${modalSelected.length}件選択中`;
    if(chips){
      if(!modalSelected.length) chips.innerHTML = '<span style="font-size:11px;color:#7a83a8">未選択です。推しを選んでください。</span>';
      else chips.innerHTML = modalSelected.map(id=>{
        const a = artistsMaster.find(x=>x.id===id) || {name:id};
        const locked = isLocked(id);
        return `<span class="oshi-chip" style="${locked?'opacity:0.95;border-color:rgba(79,195,247,0.35)':''}">${esc(a.name)}${locked?' 🔒':''} ${locked?'':`<button data-id="${esc(id)}" class="oshi-chip-del" style="background:none;border:none;color:#e4e6eb;cursor:pointer;padding:0 0 0 2px">×</button>`}</span>`;
      }).join('');
      chips.querySelectorAll('.oshi-chip-del').forEach(b=> b.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(isLocked(b.dataset.id)) return;
        modalSelected = modalSelected.filter(x=>x!==b.dataset.id);
        renderModal();
      }));
    }
    if(hint){
      const notInMaster = modalSelected.filter(id=> !artistsMaster.some(a=>a.id===id));
      const missing = modalSelected.filter(id=> {
        const a = artistsMaster.find(x=>x.id===id);
        return a && !a.playlistId;
      });
      let msg = '';
      if(lockedIds.length) msg += `🔒 配信中の${lockedIds.length}件は選択済みで変更できません。`;
      if(list.length===0) msg += ' 該当する推しが見つかりません。';
      if(missing.length) msg += ` ${missing.length}件はプレイリスト未登録です。選択後に管理者が登録すると次回更新で反映されます。`;
      hint.textContent = msg.trim();
    }
    const saveBtn = document.getElementById('oshiSave');
    if(saveBtn) saveBtn.disabled = false;
    const sync = document.getElementById('oshiSyncStatus');
    if(sync) sync.textContent = modalSelected.length ? `${modalSelected.length}件を選択中` : '推しを選んでください';
  }

  function open(){
    modalSelected = selected.slice();
    const modal = document.getElementById('oshiModal');
    if(!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    renderModal();
    try{ renderRequests(); }catch(e){}
  }
  function close(){
    const modal = document.getElementById('oshiModal');
    if(!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }

  async function save(){
    const btn = document.getElementById('oshiSave');
    if(btn){ btn.textContent='保存中...'; btn.disabled=true; }
    await setSelected(modalSelected);
    close();
    if(btn){ btn.textContent='保存して更新を開始'; btn.disabled=false; }
    // trigger data reload hint
    const hint = document.getElementById('oshiSyncStatus');
    if(hint && modalSelected.length){
      // show toast
      const t = document.createElement('div');
      t.textContent = `保存しました。${modalSelected.length}件の推しで次回更新から自動反映されます。`;
      t.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(10,14,26,0.92);color:#fff;padding:10px 16px;border-radius:12px;font-size:12px;z-index:10001;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
      document.body.appendChild(t);
      setTimeout(()=> t.remove(), 3000);
    }
    // if data.json empty for some selected, show guidance
    setTimeout(()=> location.reload(), 1200);
  }

  function bind(){
    const addBtn = document.getElementById('oshiAddBtn');
    if(addBtn) addBtn.addEventListener('click', open);
    const closeBtn = document.getElementById('oshiModalClose');
    if(closeBtn) closeBtn.addEventListener('click', close);
    const cancelBtn = document.getElementById('oshiCancel');
    if(cancelBtn) cancelBtn.addEventListener('click', close);
    const saveBtn = document.getElementById('oshiSave');
    if(saveBtn) saveBtn.addEventListener('click', save);
    const backdrop = document.getElementById('oshiModalBackdrop');
    if(backdrop) backdrop.addEventListener('click', close);
    const search = document.getElementById('oshiSearch');
    if(search) search.addEventListener('input', renderModal);
    document.querySelectorAll('.oshi-group-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        currentGroup = btn.dataset.group;
        renderModal();
      });
    });
    const addedChk = document.getElementById('oshiAddedOnly');
    if(addedChk){
      addedChk.addEventListener('change', e=>{
        showAddedOnly = e.target.checked;
        renderModal();
      });
    }
    const selAll = document.getElementById('oshiSelectAll');
    if(selAll) selAll.addEventListener('click', ()=>{ modalSelected = Array.from(new Set([...lockedIds, ...artistsMaster.map(a=>a.id)])); renderModal(); });
    const clrAll = document.getElementById('oshiClearAll');
    if(clrAll) clrAll.addEventListener('click', ()=>{ modalSelected = lockedIds.slice(); renderModal(); });
    document.addEventListener('keydown', e=>{
      if(e.key==='Escape'){
        const m = document.getElementById('oshiModal');
        if(m && m.classList.contains('open')) close();
      }
    });
    // request handling
    const reqBtn = document.getElementById('oshiReqBtn');
    if(reqBtn) reqBtn.addEventListener('click', handleRequest);
    const reqUrl = document.getElementById('oshiReqUrl');
    if(reqUrl) reqUrl.addEventListener('keydown', e=>{ if(e.key==='Enter') handleRequest(); });
    // auto render existing requests when modal opens (also on bind)
    try{ renderRequests(); }catch(e){}
  }

  const REQ_FB_PATH = 'favibe/requests';
  const REQ_LS_KEY = 'favibe_requests';

  function parseYouTubeInput(input){
    const s = (input||'').trim();
    if(!s) return null;
    // handle @handle directly
    if(s.startsWith('@') && s.length>=2) return {handle:s, raw:s};
    try{
      const u = new URL(s);
      const host = u.hostname.replace(/^www\./,'');
      if(host.includes('youtube.com') || host.includes('youtu.be')){
        // /@handle
        if(u.pathname.startsWith('/@')){
          const handle = '/' + u.pathname.split('/')[1];
          // handle includes @
          return {handle: u.pathname.split('/')[1], raw:s};
        }
        if(u.pathname.startsWith('/channel/')){
          const cid = u.pathname.split('/')[2];
          if(cid && cid.startsWith('UC')) return {channelId:cid, raw:s};
        }
        if(u.pathname.startsWith('/c/') || u.pathname.startsWith('/user/')){
          const h = u.pathname.split('/')[2];
          return {handle:'@'+h, raw:s};
        }
        // watch?v= etc still considered valid youtube link
        if(s.includes('youtube.com') || s.includes('youtu.be')) return {raw:s};
      }
    }catch(e){
      // not a URL, check if contains youtube
      if(s.includes('youtube.com') || s.includes('youtu.be')) return {raw:s};
    }
    // allow plain @handle without URL
    if(s.includes('@')) return {handle:s.match(/@[^\s\/]+/)?.[0] || s, raw:s};
    return null;
  }

  function loadRequestsLocal(){
    try{
      const v = JSON.parse(localStorage.getItem(REQ_LS_KEY)||'[]');
      if(Array.isArray(v)) return v;
    }catch(e){}
    return [];
  }
  function saveRequestsLocal(arr){
    try{ localStorage.setItem(REQ_LS_KEY, JSON.stringify(arr)); }catch(e){}
  }

  function renderRequests(){
    const listEl = document.getElementById('oshiReqList');
    const statusEl = document.getElementById('oshiReqStatus');
    if(!listEl) return;
    const local = loadRequestsLocal();
    // also try to fetch from Firebase if available (async, will update later)
    let html = '';
    if(local.length){
      html = local.map(r=> `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06)"><span style="flex:1;min-width:0"><span style="font-size:12px;font-weight:800;color:#e4e6eb">${esc(r.name)}</span><br><span style="font-size:11px;color:#9aa3c0;word-break:break-all">${esc(r.url)}</span></span><span style="font-size:10px;padding:4px 8px;border-radius:999px;background:rgba(183,140,242,0.18);color:#cbb6ff;white-space:nowrap">${esc(r.status||'申請中')}</span></div>`).join('');
    } else {
      html = '<p style="font-size:11px;color:#7a83a8;margin:0">まだリクエストはありません。上から送信してください。</p>';
    }
    listEl.innerHTML = html;
    // try Firebase fetch for shared view
    try{
      if(typeof firebase!=='undefined' && firebase.database && typeof firebaseConfig!=='undefined' && firebaseConfig.apiKey){
        if(typeof initFirebase==='function') try{ initFirebase(); }catch(e){}
        firebase.database().ref(REQ_FB_PATH).once('value').then(snap=>{
          const val = snap.val();
          if(!val) return;
          const arr = Object.values(val);
          if(arr.length){
            const fbHtml = arr.slice(-10).reverse().map(r=> `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(79,195,247,0.08);border:1px solid rgba(79,195,247,0.15)"><span style="flex:1;min-width:0"><span style="font-size:12px;font-weight:800;color:#e4e6eb">${esc(r.name)}</span><br><span style="font-size:11px;color:#9aa3c0;word-break:break-all">${esc(r.url)}</span></span><span style="font-size:10px;padding:4px 8px;border-radius:999px;background:rgba(79,195,247,0.18);color:#8ecfff;white-space:nowrap">共有</span></div>`).join('');
            if(fbHtml) listEl.innerHTML = fbHtml + (local.length? '<div style="height:8px"></div>'+html : '');
          }
        }).catch(()=>{});
      }
    }catch(e){}
  }

  async function handleRequest(){
    const nameEl = document.getElementById('oshiReqName');
    const urlEl = document.getElementById('oshiReqUrl');
    const statusEl = document.getElementById('oshiReqStatus');
    const btn = document.getElementById('oshiReqBtn');
    if(!nameEl || !urlEl) return;
    const name = nameEl.value.trim();
    const url = urlEl.value.trim();
    if(!name){
      if(statusEl){ statusEl.textContent='名前を入力してください。'; statusEl.style.color='#f78fc0'; }
      nameEl.focus();
      return;
    }
    if(!url){
      if(statusEl){ statusEl.textContent='YouTubeリンクを入力してください。'; statusEl.style.color='#f78fc0'; }
      urlEl.focus();
      return;
    }
    const parsed = parseYouTubeInput(url);
    if(!parsed){
      if(statusEl){ statusEl.textContent='YouTubeリンクの形式が正しくありません。例: https://www.youtube.com/@Ado1020'; statusEl.style.color='#f78fc0'; }
      return;
    }
    if(btn){ btn.disabled=true; btn.textContent='送信中...'; }
    const req = {
      name,
      url,
      parsed,
      at: Date.now(),
      status: '申請中'
    };
    // local
    const local = loadRequestsLocal();
    local.push(req);
    saveRequestsLocal(local);
    // Firebase
    let fbOk = false;
    try{
      if(typeof firebase!=='undefined' && firebase.database && typeof firebaseConfig!=='undefined' && firebaseConfig.apiKey){
        if(typeof initFirebase==='function') try{ initFirebase(); }catch(e){}
        if(typeof firebase.auth==='function' && !firebase.auth().currentUser){
          try{ await firebase.auth().signInAnonymously(); }catch(e){}
        }
        await firebase.database().ref(REQ_FB_PATH).push({...req, at:Date.now()});
        fbOk = true;
      }
    }catch(e){ console.warn('firebase request push failed', e); }
    if(statusEl){
      statusEl.textContent = fbOk ? 'リクエストを送信しました！管理者が確認して追加します。' : 'リクエストを保存しました（ローカル）。管理者に共有されます。';
      statusEl.style.color='#8ecfff';
    }
    nameEl.value='';
    urlEl.value='';
    renderRequests();
    if(btn){ btn.disabled=false; btn.textContent='リクエスト送信'; }
    // also show toast
    const t = document.createElement('div');
    t.textContent = `「${name}」のリクエストを送信しました`;
    t.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:rgba(10,14,26,0.92);color:#fff;padding:10px 16px;border-radius:12px;font-size:12px;z-index:10001;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), 2500);
  }

  return { initSelected, getSelected, setSelected, loadMaster, loadLocked, getLocked, isLocked, updateStatus, open, close, bind, listenFirebase, renderRequests };
})();

  // favibe oshi init wrapper
  const _origInit = init;
  init = async function(){
    try{ await FavibeOshi.loadMaster(); }catch(e){}
    try{ await FavibeOshi.loadLocked(); }catch(e){}
    try{ await FavibeOshi.initSelected(); }catch(e){}
    FavibeOshi.bind();
    FavibeOshi.updateStatus();
    FavibeOshi.listenFirebase((ids)=>{ FavibeOshi.updateStatus(); });
    // auto-open if no selection
    const sel = FavibeOshi.getSelected();
    if(!sel.length){
      setTimeout(()=> FavibeOshi.open(), 600);
    }
    return _origInit();
  };
  
  
  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
