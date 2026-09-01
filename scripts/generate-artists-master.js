#!/usr/bin/env node
// Generate artists-master.json from official nijisanji.jp talents page
// Usage: node scripts/generate-artists-master.js [--fetch]
// --fetch will try to fetch live data, otherwise uses cached /tmp/talents.html if exists

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MASTER_PATH = path.join(ROOT, 'artists-master.json');

function hashColor(str){
  let h=0;
  for(let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>>0;
  const hue = h % 360;
  return `hsl(${hue}, 65%, 65%)`;
}

async function fetchTalents(){
  let html;
  const cache = '/tmp/talents.html';
  if(fs.existsSync(cache)){
    html = fs.readFileSync(cache,'utf-8');
  } else {
    const res = await fetch('https://www.nijisanji.jp/talents', {headers:{'User-Agent':'Mozilla/5.0'}});
    html = await res.text();
    fs.writeFileSync(cache, html);
  }
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if(!m) throw new Error('__NEXT_DATA__ not found');
  const j = JSON.parse(m[1]);
  return j.props.pageProps.allLivers;
}

async function main(){
  const fetchLive = process.argv.includes('--fetch');
  let livers;
  try{
    livers = await fetchTalents();
  }catch(e){
    console.error('fetch failed', e);
    process.exit(1);
  }
  console.log(`fetched ${livers.length} livers`);

  // Filter: exclude VirtuaReal, keep JP + EN, exclude graduated (already excluded by site)
  const filtered = livers.filter(l=>{
    const aff = l.profile?.affiliation || [];
    if(aff.includes('VirtuaReal')) return false;
    // keep にじさんじ and NIJISANJI EN
    return aff.includes('にじさんじ') || aff.includes('NIJISANJI EN');
  });
  console.log(`filtered JP+EN active: ${filtered.length}`);

  // Sort by orderByRuby (Japanese order) or debutAt
  filtered.sort((a,b)=> (a.orderByRuby||0)-(b.orderByRuby||0));

  // Load existing master to preserve channelIds for known ids
  let existing = {artists:[]};
  if(fs.existsSync(MASTER_PATH)){
    try{ existing = JSON.parse(fs.readFileSync(MASTER_PATH,'utf-8')); }catch(e){}
  }
  const existingMap = new Map(existing.artists.map(a=>[a.id, a]));

  // Keep chronoir unit separately
  const chronoir = existingMap.get('chronoir');

  const artists = filtered.map(l=>{
    const id = l.slug; // official slug
    const existingEntry = existingMap.get(id);
    // alias handling: tamanoinana -> nana-tamanoi
    let channelId = existingEntry?.channelId || "";
    if(id==='nana-tamanoi' && existingMap.has('tamanoinana')){
      channelId = existingMap.get('tamanoinana').channelId || channelId;
    }
    // avatar: direct microCMS URL
    let avatar = existingEntry?.avatar || "";
    try{
      const imgUrl = l.images?.head?.url || "";
      const m = imgUrl.match(/url=([^&]+)/);
      if(m){
        avatar = decodeURIComponent(m[1]);
      } else if(imgUrl.startsWith('https://')){
        avatar = imgUrl;
      }
    }catch(e){}
    return {
      id,
      name: l.name,
      enName: l.enName,
      group: l.profile.affiliation[0], // にじさんじ or NIJISANJI EN
      channelId,
      playlistId: existingEntry?.playlistId || "",
      color: existingEntry?.color || hashColor(id),
      avatar,
      debutAt: l.profile.debutAt,
      subscriberCount: l.subscriberCount || 0
    };
  });

  // Add chronoir unit if not already in list (it's not in official)
  if(chronoir && !artists.some(a=>a.id==='chronoir')){
    artists.push({
      id: 'chronoir',
      name: 'ChroNoiR',
      enName: 'ChroNoiR',
      group: 'にじさんじユニット',
      channelId: '',
      playlistId: 'PL_chronoir_utamitai',
      color: '#1a1a1a',
      debutAt: '',
      subscriberCount: 0
    });
  }

  // Alias note: keep tamanoinana as alias for backwards compat? Add mapping file
  // Instead, we will keep nana-tamanoi as primary, but also ensure old id still works via JS alias map

  const out = {artists};
  fs.writeFileSync(MASTER_PATH, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`wrote ${MASTER_PATH} with ${artists.length} artists`);
  // also write stats
  const groups = {};
  for(const a of artists) groups[a.group] = (groups[a.group]||0)+1;
  console.log('groups', groups);
}

main().catch(e=>{console.error(e); process.exit(1);});
