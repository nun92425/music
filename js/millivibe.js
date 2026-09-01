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

  function esc(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function loadSettings(){
    try{
      const s = JSON.parse(localStorage.getItem('milpro_millivibe_settings')||'null');
      if(s){ autoNext = !!s.autoNext; shuffle = !!s.shuffle; repeat = s.repeat||'off'; automix = !!s.automix; }
    }catch(e){}
    if($('autoNextToggle')) $('autoNextToggle').checked = autoNext;
    if($('btnShuffle')) $('btnShuffle').classList.toggle('active', shuffle);
    if($('btnRepeat')) { $('btnRepeat').dataset.mode = repeat; $('btnRepeat').classList.toggle('active', repeat!=='off'); $('btnRepeat').textContent = repeat==='one' ? 'ONE' : repeat==='all' ? 'ALL' : 'REP'; }
    if($('btnAutomix')) { $('btnAutomix').dataset.on = automix?'1':'0'; $('btnAutomix').classList.toggle('active', automix); }
  }
  function saveSettings(){
    try{ localStorage.setItem('milpro_millivibe_settings', JSON.stringify({autoNext, shuffle, repeat, automix})); }catch(e){}
  }
  function loadQueue(){
    try{
      const q = JSON.parse(localStorage.getItem('milpro_millivibe_queue')||'null');
      if(Array.isArray(q) && q.length) queue = q;
    }catch(e){}
  }
  function saveQueue(){
    try{ localStorage.setItem('milpro_millivibe_queue', JSON.stringify(queue)); }catch(e){}
  }
  function loadHistory(){
    try{
      const h = JSON.parse(localStorage.getItem('milpro_millivibe_history')||'null');
      if(Array.isArray(h)) history = h;
    }catch(e){ history=[]; }
  }
  function saveHistory(){
    try{ localStorage.setItem('milpro_millivibe_history', JSON.stringify(history.slice(0,20))); }catch(e){}
  }
  function loadPins(){
    try{ return JSON.parse(localStorage.getItem('milpro_millivibe_pins')||'[]'); }catch(e){ return []; }
  }
  function savePins(pins){
    try{ localStorage.setItem('milpro_millivibe_pins', JSON.stringify(pins)); }catch(e){}
    if(typeof getMilliproUid==='function' && getMilliproUid() && typeof mpWriteCloud==='function'){
      mpWriteCloud(getMilliproUid(),'millivibePins', pins);
    }
  }
  function loadPlays(){
    try{ return JSON.parse(localStorage.getItem('milpro_millivibe_plays')||'{}'); }catch(e){ return {}; }
  }
  function incPlay(videoId){
    try{
      const plays = loadPlays();
      const today = new Date().toISOString().slice(0,10);
      const key = videoId+'_'+today;
      if(plays[key]) return;
      plays[videoId] = (plays[videoId]||0)+1;
      plays[key]=1;
      localStorage.setItem('milpro_millivibe_plays', JSON.stringify(plays));
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
      const res = await fetch('./data.json');
      data = await res.json();
    }catch(e){ data={members:[]}; }
    try{
      const r = await fetch('./millivibe-presets.json');
      const j = await r.json();
      presets = j.presets||[];
    }catch(e){ presets=[]; }
    extractSongs();
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
            try{ localStorage.setItem('milpro_millivibe_playlists', JSON.stringify(cloud)); }catch(e){}
            renderCustomPlaylists();
            renderLibrary();
          }
          const pins = await mpReadCloud(uid,'millivibePins');
          if(pins && Array.isArray(pins)){
            try{ localStorage.setItem('milpro_millivibe_pins', JSON.stringify(pins)); }catch(e){}
            renderPinned();
          }
        }
      });
    }
  }

  function extractSongs(){
    allSongs = [];
    const seen = new Set();
    const members = (data.members||[]);
    for(const m of members){
      for(const pl of (m.playlists||[])){
        for(const v of (pl.videos||[])){
          if(!v.id || seen.has(v.id)) continue;
          seen.add(v.id);
          allSongs.push({
            id: v.id,
            title: v.cached?.title || v.id,
            thumbnail: v.cached?.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            memberId: m.id,
            memberName: m.name,
            playlistId: pl.id,
            playlistName: pl.name,
            publishedAt: v.cached?.publishedAt || ''
          });
        }
      }
    }
    allSongs.sort((a,b)=> new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  function songCard(s, opts={}){
    const pinActive = loadPins().some(p=>p.id===s.id);
    return `<div class="song-card" data-id="${s.id}" style="cursor:pointer">
      <img class="song-thumb" src="${esc(s.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="song-meta">
        <div class="song-title">${esc(s.title)}</div>
        <div class="song-artist">${esc(s.memberName)}</div>
      </div>
      <div style="display:flex;gap:4px;padding:0 8px 8px">
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
    if(!q){
      // おすすめ: 再生上位3 + 傾向2 + お気に入り1 を混ぜる
      const plays = loadPlays();
      const counts = {};
      for(const k in plays){ if(k.includes('_')) continue; counts[k]=plays[k]; }
      const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=> allSongs.find(s=>s.id===id)).filter(Boolean);
      const favs = (()=>{ try{ return JSON.parse(localStorage.getItem('milpro_favorites')||'[]'); }catch(e){ return []; }})();
      const favSongs = favs.slice(0,3).map(id=> allSongs.find(s=>s.id===id)).filter(Boolean);
      // 傾向: 最も再生したメンバーの曲
      let popularMember = null;
      if(top.length){ const m = top[0].memberId; popularMember = m; }
      const tendency = popularMember ? allSongs.filter(s=> s.memberId===popularMember && !top.some(t=>t.id===s.id)).slice(0,2) : allSongs.slice(0,2);
      const mix = [...top.slice(0,2), ...tendency.slice(0,2), ...favSongs.slice(0,2)].filter(Boolean);
      // dedup and shuffle
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
            });
          });
        }else recCont.innerHTML = '';
      }
      // 検索結果は最新から
      const list = allSongs.slice(0,24);
      cont.innerHTML = list.map(s=>songCard(s)).join('');
    }else{
      if(recCont) recCont.innerHTML = '';
      const list = allSongs.filter(s=> s.title.toLowerCase().includes(q) || s.memberName.toLowerCase().includes(q)).slice(0,30);
      if(!list.length){ cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0">該当する曲がありません。</p>'; return; }
      cont.innerHTML = list.map(s=>songCard(s)).join('');
    }
    cont.querySelectorAll('.song-card').forEach(el=>{
      el.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(el.dataset.id); });
      el.querySelectorAll('button').forEach(b=>{
        if(b.classList.contains('queue-add')) b.addEventListener('click', ()=> addNextWithAnim(b.dataset.id, el));
        else if(b.classList.contains('queue-push')) b.addEventListener('click', ()=> pushQueue(b.dataset.id));
        else if(b.classList.contains('pin-btn')) b.addEventListener('click', ()=> togglePin(b.dataset.id));
      });
    });
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
    // flying animation
    try{
      const thumb = cardEl.querySelector('img');
      const target = document.querySelector('#queueList') || document.querySelector('#queueWrap');
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
      const dx = r2.left + 20 - r1.left;
      const dy = r2.top - r1.top;
      requestAnimationFrame(()=>{ clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.3)`; clone.style.opacity='0.6'; });
      setTimeout(()=> clone.remove(), 500);
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
    const libCont = $('libHistory');
    const render = (el)=>{
      if(!el) return;
      if(!history.length){ el.innerHTML = '<p style="font-size:11px;color:#9aa3c0">再生履歴はまだありません。</p>'; return; }
      el.innerHTML = history.slice(0,10).map(h=>{
        const s = allSongs.find(x=>x.id===h.id);
        const title = s ? s.title : h.id;
        const thumb = s ? s.thumbnail : `https://i.ytimg.com/vi/${h.id}/hqdefault.jpg`;
        return `<div class="queue-item" data-id="${h.id}" style="opacity:0.7;cursor:pointer">
          <img class="song-thumb" src="${esc(thumb)}" alt="" style="width:48px;height:36px">
          <div class="song-meta"><div class="song-title">${esc(title)}</div><div style="font-size:10px;color:#9aa3c0">${new Date(h.at).toLocaleDateString()}</div></div>
          <button class="qplay-hist" data-id="${h.id}" style="padding:4px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:#e4e6eb;border:1px solid rgba(255,255,255,0.12);font-size:11px;cursor:pointer">再生</button>
        </div>`;
      }).join('');
      el.querySelectorAll('.qplay-hist').forEach(b=> b.addEventListener('click', ()=> playById(b.dataset.id)));
      el.querySelectorAll('.queue-item').forEach(div=> div.addEventListener('click', e=>{ if(e.target.closest('button')) return; playById(div.dataset.id); }));
    };
    render(cont);
    render(libCont);
  }

  function renderPinned(){
    const cont = $('pinnedGrid');
    if(!cont) return;
    const pins = loadPins();
    if(!pins.length){
      cont.innerHTML = '<p style="font-size:12px;color:#9aa3c0;grid-column:1/-1">ピン留めはまだありません。曲やプレイリストでPINを押してください。</p>';
      return;
    }
    cont.innerHTML = pins.map(p=>{
      if(p.type==='playlist'){
        let pls=[]; try{ pls=JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); }catch(e){}
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
        return `<div class="pin-card" data-id="${p.id}" data-type="song" style="cursor:pointer">
          <img class="song-thumb" src="${esc(thumb)}" alt="" style="width:100%;aspect-ratio:16/9">
          <div class="song-meta" style="padding:4px 0"><div class="song-title">${esc(title)}</div></div>
          <button class="pin-del" data-id="${p.id}" style="padding:4px 8px;border-radius:999px;background:rgba(247,143,192,0.18);color:#c25282;border:none;font-size:11px;cursor:pointer">外す</button>
        </div>`;
      }
    }).join('');
    cont.querySelectorAll('.pin-card').forEach(el=>{
      el.addEventListener('click', e=>{ if(e.target.closest('button')) return; const id=el.dataset.id; const type=el.dataset.type; if(type==='playlist'){ const pls=JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); const pl=pls.find(x=>x.id===id); if(pl){ queue=pl.videoIds.slice(); idx=-1; saveQueue(); renderQueue(); if(queue.length) play(0); switchTab('nowplaying'); } } else playById(id); });
    });
    cont.querySelectorAll('.pin-del').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); const id=b.dataset.id; const pins=loadPins().filter(p=>p.id!==id); savePins(pins); renderPinned(); }));
  }
  function togglePin(id, type){
    // type auto-detect: if id is playlist id
    let pls=[]; try{ pls=JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); }catch(e){}
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
      let favs=[]; try{ favs=JSON.parse(localStorage.getItem('milpro_favorites')||'[]'); }catch(e){ favs=[]; }
      const list = favs.map(id=> allSongs.find(s=>s.id===id)).filter(Boolean).slice(0,24);
      if(!list.length) favCont.innerHTML = '<p style="font-size:12px;color:#9aa3c0;grid-column:1/-1">お気に入りはまだありません。</p>';
      else favCont.innerHTML = list.map(s=>`<div class="song-card" data-id="${s.id}" style="cursor:pointer"><img class="song-thumb" src="${esc(s.thumbnail)}" alt=""><div class="song-meta"><div class="song-title">${esc(s.title)}</div><div class="song-artist">${esc(s.memberName)}</div></div></div>`).join('');
      favCont.querySelectorAll('.song-card').forEach(el=> el.addEventListener('click', ()=> playById(el.dataset.id)));
    }
    const plCont = $('libPlaylists');
    if(plCont){
      let pls=[]; try{ pls=JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); }catch(e){ pls=[]; }
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
  }

  function renderCustomPlaylists(){
    const cont = $('customPlaylists');
    if(!cont) return;
    let pls = [];
    try{ pls = JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); }catch(e){ pls=[]; }
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
      try{ localStorage.setItem('milpro_millivibe_playlists', JSON.stringify(pls)); }catch(e){}
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
      cont.innerHTML = latest.map((s,i)=>`
        <div class="rank-item" data-id="${s.id}" style="cursor:pointer">
          <span style="width:24px;font-weight:800;color:#9aa3c0;text-align:center">${i+1}</span>
          <img class="song-thumb" src="${esc(s.thumbnail)}" alt="">
          <div class="song-meta"><div class="song-title">${esc(s.title)}</div><div class="song-artist">${esc(s.memberName)} · 視聴: - · 再生: ${counts[s.id]||0}回</div></div>
        </div>
      `).join('');
    }else{
      cont.innerHTML = sorted.map(([id,cnt],i)=>{
        const s = allSongs.find(x=>x.id===id);
        const title = s ? s.title : id;
        const thumb = s ? s.thumbnail : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        const name = s ? s.memberName : '';
        return `<div class="rank-item" data-id="${id}" style="cursor:pointer">
          <span style="width:24px;font-weight:800;color:#9aa3c0;text-align:center">${i+1}</span>
          <img class="song-thumb" src="${esc(thumb)}" alt="">
          <div class="song-meta"><div class="song-title">${esc(title)}</div><div class="song-artist">${esc(name)} · 再生: ${cnt}回</div></div>
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
        const pool = allSongs.filter(s=> !queue.includes(s.id) && (cur ? s.memberId===cur.memberId : true));
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
    idx=i;
    const id = queue[i];
    const s = allSongs.find(x=>x.id===id);
    if(s){
      if($('nowTitle')) $('nowTitle').textContent = s.title;
      if($('nowArtist')) $('nowArtist').textContent = s.memberName;
      if($('recordThumb')){ $('recordThumb').src = s.thumbnail; $('recordThumb').style.display='block'; }
    }
    if(!playerReady || !player || !player.loadVideoById){
      setTimeout(()=> play(i), 500);
      return;
    }
    player.loadVideoById(id);
    renderQueue();
    renderHistory();
    const pre = presets.find(p=> (p.videoIds||[]).includes(id));
    const bpm = pre ? pre.bpm : 110;
    const rec = $('vibeRecord');
    if(rec) rec.style.animationDuration = (60/bpm*4)+'s';
  }
  function playById(id){
    const i = queue.indexOf(id);
    if(i>=0) play(i);
    else { queue.unshift(id); idx=-1; saveQueue(); renderQueue(); renderHistory(); play(0); }
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
    const url = location.origin + '/millivibe.html#song=' + encodeURIComponent(id);
    if(navigator.clipboard) navigator.clipboard.writeText(url).then(()=> alert('リンクをコピーしました'));
    else prompt('共有リンク', url);
  }
  function sharePlaylist(plId){
    const url = location.origin + '/millivibe.html#playlist=' + encodeURIComponent(plId);
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
    if($('songSearch')) $('songSearch').addEventListener('input', e=> renderSearch(e.target.value));
    if($('btnCreatePlaylist')) $('btnCreatePlaylist').addEventListener('click', ()=>{
      const name = prompt('プレイリスト名を入力');
      if(!name) return;
      let pls = [];
      try{ pls = JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); }catch(e){ pls=[]; }
      const pl = { id: 'pl_'+Date.now(), name, videoIds: queue.slice(), createdAt: Date.now() };
      pls.push(pl);
      try{ localStorage.setItem('milpro_millivibe_playlists', JSON.stringify(pls)); }catch(e){}
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
      try{ pls=JSON.parse(localStorage.getItem('milpro_millivibe_playlists')||'[]'); }catch(e){}
      const pl = pls.find(x=>x.id===pid);
      if(pl){ queue=pl.videoIds.slice(); idx=-1; saveQueue(); renderQueue(); renderHistory(); if(queue.length) play(0); }
    }
  }
  function setupTabs(){
    const tabs = document.querySelectorAll('.vibe-side-nav .vibe-nav-item');
    const map = { pinned: 'vibePinnedSec', nowplaying: 'vibeNowSec', search: 'vibeSearchSec', library: 'vibeLibrarySec', ranking: 'vibeRankingSec', playlists: 'vibePlaylistsSec' };
    function switchTab(tab){
      tabs.forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
      Object.entries(map).forEach(([k, id])=>{
        const sec = $(id);
        if(sec) sec.style.display = (k===tab)?'':'none';
      });
      if(tab==='ranking') renderRanking();
      if(tab==='library') renderLibrary();
      if(tab==='pinned') renderPinned();
    }
    tabs.forEach(btn=> btn.addEventListener('click', ()=> switchTab(btn.dataset.tab)));
    // fallback for old tabMenu (nowplaying etc)
    const oldTabs = document.querySelectorAll('#millivibeTabMenu .tab-item');
    oldTabs.forEach(btn=> btn.addEventListener('click', ()=> switchTab(btn.dataset.tab==='player'?'nowplaying':btn.dataset.tab)));
    switchTab('nowplaying');
    window.switchTab = switchTab;
  }
  function setupSearch(){
    // initial recommend
    renderSearch('');
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
