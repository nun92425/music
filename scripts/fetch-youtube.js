#!/usr/bin/env node
// favibe - YouTube Data API v3 で選択中アーティストの歌みたを更新
// 使い方: YOUTUBE_API_KEY=xxx node scripts/fetch-youtube.js [--all]
// --all なら全アーティスト、それ以外は favibe/selectedArtists (Firebase or local) のみ
// Firebaseが設定されていればそこからselectedを読み、なければ artists-master.json の初期4件 or data/selected.json

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.YOUTUBE_API_KEY || '';
const ROOT = path.resolve(__dirname, '..');

async function fetchJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`fetch ${url} ${res.status}`);
  return res.json();
}

async function ytPlaylistItems(playlistId, apiKey){
  // max 50 per request, paginate up to 200 (十分)
  let items = [];
  let pageToken = '';
  do{
    const u = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    u.searchParams.set('part','snippet,contentDetails');
    u.searchParams.set('playlistId', playlistId);
    u.searchParams.set('maxResults','50');
    u.searchParams.set('key', apiKey);
    if(pageToken) u.searchParams.set('pageToken', pageToken);
    const j = await fetchJSON(u.toString());
    for(const it of (j.items||[])){
      if(it.snippet?.resourceId?.videoId){
        items.push({
          id: it.snippet.resourceId.videoId,
          title: it.snippet.title,
          thumbnail: it.snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${it.snippet.resourceId.videoId}/hqdefault.jpg`,
          publishedAt: it.contentDetails?.videoPublishedAt || it.snippet.publishedAt,
          channelId: it.snippet.channelId,
          channelTitle: it.snippet.channelTitle
        });
      }
    }
    pageToken = j.nextPageToken || '';
    if(items.length >= 150) break; // safety cap per playlist
  }while(pageToken);
  return items;
}

async function ytVideosMeta(videoIds, apiKey){
  // batch 50
  const out = new Map();
  for(let i=0;i<videoIds.length;i+=50){
    const slice = videoIds.slice(i,i+50);
    const u = new URL('https://www.googleapis.com/youtube/v3/videos');
    u.searchParams.set('part','snippet,statistics');
    u.searchParams.set('id', slice.join(','));
    u.searchParams.set('key', apiKey);
    const j = await fetchJSON(u.toString());
    for(const v of (j.items||[])){
      out.set(v.id, {
        title: v.snippet.title,
        thumbnail: v.snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        publishedAt: v.snippet.publishedAt,
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        viewCount: v.statistics?.viewCount || '0'
      });
    }
  }
  return out;
}

function loadMaster(){
  const p = path.join(ROOT, 'artists-master.json');
  if(!fs.existsSync(p)) return {artists:[]};
  return JSON.parse(fs.readFileSync(p,'utf-8'));
}

function loadData(){
  const p = path.join(ROOT, 'data.json');
  if(!fs.existsSync(p)) return {members:[], config:{}, pointConfig:{}};
  return JSON.parse(fs.readFileSync(p,'utf-8'));
}

async function loadSelected(){
  const argAll = process.argv.includes('--all');
  if(argAll){
    const master = loadMaster();
    return master.artists.map(a=>a.id);
  }
  // 1. try Firebase via REST if configured
  try{
    const cfgPath = path.join(ROOT, 'firebase-config.js');
    const txt = fs.readFileSync(cfgPath,'utf-8');
    const m = txt.match(/databaseURL:\s*"([^"]+)"/);
    const dbUrl = m ? m[1] : '';
    if(dbUrl){
      const url = dbUrl.replace(/\/$/,'') + '/favibe/selectedArtists.json';
      const j = await fetchJSON(url);
      if(Array.isArray(j) && j.length) return j;
    }
  }catch(e){}
  // 2. try local file data/selected.json
  const selPath = path.join(ROOT, 'data','selected.json');
  if(fs.existsSync(selPath)){
    try{ const j=JSON.parse(fs.readFileSync(selPath,'utf-8')); if(Array.isArray(j)) return j; }catch(e){}
  }
  // 3. fallback to artists-master initial 4 or existing data.json members
  const master = loadMaster();
  if(master.artists.length) return master.artists.slice(0,4).map(a=>a.id);
  const data = loadData();
  return (data.members||[]).map(m=>m.id);
}

async function main(){
  const master = loadMaster();
  const data = loadData();
  const selectedIds = await loadSelected();
  console.log(`[favibe] selected: ${selectedIds.join(', ')}`);

  const selArtists = master.artists.filter(a=> selectedIds.includes(a.id));
  if(!selArtists.length){
    console.warn('[favibe] no artists selected, keeping data.json as-is');
    process.exit(0);
  }

  if(!API_KEY){
    console.log('[favibe] YOUTUBE_API_KEY not set -> skip fetch, keep dummy data.json');
    console.log('  Set YOUTUBE_API_KEY to enable auto-update. Example: YOUTUBE_API_KEY=xxx node scripts/fetch-youtube.js');
    // still ensure data.json members match selected (filter)
    const filtered = (data.members||[]).filter(m=> selectedIds.includes(m.id));
    if(filtered.length !== (data.members||[]).length){
      console.log(`[favibe] would filter data.json to ${filtered.length} members, but API key missing so no write`);
    }
    return;
  }

  const newMembers = [];
  for(const a of selArtists){
    const playlistIds = a.playlistIds ? a.playlistIds : (a.playlistId ? [a.playlistId] : []);
    if(!playlistIds.length){
      console.warn(`[favibe] ${a.name} (${a.id}) has no playlistId, skip API, keep existing if any`);
      const existing = (data.members||[]).find(m=>m.id===a.id);
      if(existing) newMembers.push(existing);
      else {
        newMembers.push({
          id: a.id,
          name: a.name,
          icon: "🎤",
          channel: a.channelId ? `@${a.name}` : "",
          channelId: a.channelId || "",
          birthday: "",
          links: "[]",
          avatar: a.avatar || "",
          playlists: [{id: `PL_${a.id}_utamitai`, name:"歌ってみた", videos:[], channelId: a.channelId||""}],
          videos: [],
          scheduledStreams: []
        });
      }
      continue;
    }
    // support multiple playlists per artist (e.g., kanae 2 playlists)
    const playlists = [];
    let hasError = false;
    for(let pi=0; pi<playlistIds.length; pi++){
      const pid = playlistIds[pi];
      console.log(`[favibe] fetching playlist ${pid} for ${a.name} (${pi+1}/${playlistIds.length})...`);
      try{
        const items = await ytPlaylistItems(pid, API_KEY);
        console.log(`  -> ${items.length} videos`);
        const videos = items.map(it=> ({
          id: it.id,
          type: "regular",
          cached: {
            title: it.title,
            thumbnail: it.thumbnail,
            publishedAt: it.publishedAt,
            channelId: it.channelId,
            channelTitle: it.channelTitle
          }
        }));
        // try to keep original playlist name if exists in data.json
        let plName = `歌ってみた${playlistIds.length>1 ? (pi+1) : ''}`;
        const existing = (data.members||[]).find(m=>m.id===a.id);
        if(existing){
          const exPl = existing.playlists.find(p=>p.id===pid);
          if(exPl) plName = exPl.name;
        }
        playlists.push({id: pid, name: plName, videos, channelId: a.channelId||""});
      }catch(e){
        console.error(`  failed ${a.id} ${pid}:`, e.message);
        hasError = true;
        const existing = (data.members||[]).find(m=>m.id===a.id);
        if(existing){
          const exPl = existing.playlists.find(p=>p.id===pid);
          if(exPl) playlists.push(exPl);
        }
      }
    }
    if(!playlists.length){
      console.warn(`[favibe] ${a.name} no playlists fetched, keep existing`);
      const existing = (data.members||[]).find(m=>m.id===a.id);
      if(existing) newMembers.push(existing);
      continue;
    }
    newMembers.push({
      id: a.id,
      name: a.name,
      icon: "🎤",
      channel: a.channelId ? `@${a.name}` : "",
      channelId: a.channelId || "",
      birthday: "",
      links: "[]",
      avatar: a.avatar || "",
      playlists,
      videos: [],
      scheduledStreams: []
    });
  }

  const out = {
    members: newMembers,
    config: {fetchTime:"6:00", lastFetch: new Date().toISOString(), fetchedArtists: selectedIds},
    pointConfig: data.pointConfig || {pointTypes:[], typeMapping:{}},
    memoryGarden: {},
    encyclopedia: {},
    levelTable: {},
    jobs: {}
  };
  const outPath = path.join(ROOT, 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`[favibe] wrote ${outPath} with ${newMembers.length} members`);
  // write selected cache for CI
  const selCachePath = path.join(ROOT, 'data','selected.json');
  try{ fs.mkdirSync(path.dirname(selCachePath), {recursive:true}); fs.writeFileSync(selCachePath, JSON.stringify(selectedIds,null,2)); }catch(e){}
}

main().catch(e=>{ console.error(e); process.exit(1); });
