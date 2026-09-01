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
      const s = JSON.parse(localStorage.getItem('favibe_settings')||'null');
      if(s){ autoNext = !!s.autoNext; shuffle = !!s.shuffle; repeat = s.repeat||'off'; automix = !!s.automix; }
    }catch(e){}
    if($('autoNextToggle')) $('autoNextToggle').checked = autoNext;
    if($('btnShuffle')) $('btnShuffle').classList.toggle('active', shuffle);
    if($('btnRepeat')) { $('btnRepeat').dataset.mode = repeat; $('btnRepeat').classList.toggle('active', repeat!=='off'); $('btnRepeat').textContent = repeat==='one' ? 'ONE' : repeat==='all' ? 'ALL' : 'REP'; }
    if($('btnAutomix')) { $('btnAutomix').dataset.on = automix?'1':'0'; $('btnAutomix').classList.toggle('active', automix); }
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
      const res = await fetch('./data.json');
      data = await res.json();
    }catch(e){ data={members:[]}; }
    try{
      const r = await fetch('./favibe-presets.json');
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
      const favs = (()=>{ try{ return JSON.parse(localStorage.getItem('favibe_favorites')||'[]'); }catch(e){ return []; }})();
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
        return `<div class="pin-card" data-id="${p.id}" data-type="song" style="cursor:pointer">
          <img class="song-thumb" src="${esc(thumb)}" alt="" style="width:100%;aspect-ratio:16/9">
          <div class="song-meta" style="padding:4px 0"><div class="song-title">${esc(title)}</div></div>
          <button class="pin-del" data-id="${p.id}" style="padding:4px 8px;border-radius:999px;background:rgba(247,143,192,0.18);color:#c25282;border:none;font-size:11px;cursor:pointer">外す</button>
        </div>`;
      }
    }).join('');
    cont.querySelectorAll('.pin-card').forEach(el=>{
      el.addEventListener('click', e=>{ if(e.target.closest('button')) return; const id=el.dataset.id; const type=el.dataset.type; if(type==='playlist'){ const pls=JSON.parse(localStorage.getItem('favibe_playlists')||'[]'); const pl=pls.find(x=>x.id===id); if(pl){ queue=pl.videoIds.slice(); idx=-1; saveQueue(); renderQueue(); if(queue.length) play(0); switchTab('nowplaying'); } } else playById(id); });
    });
    cont.querySelectorAll('.pin-del').forEach(b=> b.addEventListener('click', e=>{ e.stopPropagation(); const id=b.dataset.id; const pins=loadPins().filter(p=>p.id!==id); savePins(pins); renderPinned(); }));
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
      else favCont.innerHTML = list.map(s=>`<div class="song-card" data-id="${s.id}" style="cursor:pointer"><img class="song-thumb" src="${esc(s.thumbnail)}" alt=""><div class="song-meta"><div class="song-title">${esc(s.title)}</div><div class="song-artist">${esc(s.memberName)}</div></div></div>`).join('');
      favCont.querySelectorAll('.song-card').forEach(el=> el.addEventListener('click', ()=> playById(el.dataset.id)));
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


// ── favibe: 推し選択共有 (Firebase + local fallback) ──
const FavibeOshi = (function(){
  const LS_KEY = 'favibe_selected_artists';
  const FB_PATH = 'favibe/selectedArtists';
  let artistsMaster = null;
  let selected = [];
  let lockedIds = [];
  const ALIAS_MAP = {"tamanoinana":"nana-tamanoi"};
  let currentGroup = "";
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
        const cnt = g ? artistsMaster.filter(a=> a.group===g).length : artistsMaster.length;
        el.textContent = `(${cnt})`;
      });
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
