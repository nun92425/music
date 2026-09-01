#!/usr/bin/env node
// favibe - リクエスト一覧を書き出す
// Firebaseが設定されていれば favibe/requests を、なければローカル data/requests.json / localStorage のダミーを表示
// 使い方:
//   node scripts/list-requests.js
//   node scripts/list-requests.js --json
//   node scripts/list-requests.js --clear  (確認後に削除したい場合、手動で Firebase から削除する例を表示)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function getDatabaseURL(){
  try{
    const txt = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf-8');
    // ignore commented lines
    const lines = txt.split('\n').filter(l=> !l.trim().startsWith('//'));
    const cleaned = lines.join('\n');
    const m = cleaned.match(/databaseURL:\s*"([^"]+)"/);
    const url = m ? m[1].trim() : '';
    if(url && url.startsWith('https://')) return url.replace(/\/$/,'');
  }catch(e){}
  return '';
}

async function fetchRequestsFromFirebase(dbUrl){
  const url = dbUrl + '/favibe/requests.json';
  console.log(`[favibe] fetching ${url}`);
  const res = await fetch(url);
  if(!res.ok) throw new Error(`Firebase fetch failed ${res.status} ${await res.text().then(t=>t.slice(0,500))}`);
  const j = await res.json();
  if(!j) return [];
  // j is { pushId: {name, url, parsed, at, status}, ... }
  const arr = Object.entries(j).map(([key, val])=> ({key, ...val}));
  arr.sort((a,b)=> (a.at||0)-(b.at||0));
  return arr;
}

function loadLocalRequests(){
  const candidates = [
    path.join(ROOT, 'data','requests.json'),
    path.join(ROOT, 'requests.json'),
  ];
  for(const p of candidates){
    if(fs.existsSync(p)){
      try{
        const j = JSON.parse(fs.readFileSync(p,'utf-8'));
        if(Array.isArray(j)) return j.map((v,i)=> ({key:`local-${i}`, ...v}));
        if(typeof j==='object') return Object.entries(j).map(([k,v])=> ({key:k, ...v}));
      }catch(e){}
    }
  }
  return [];
}

function formatTable(arr){
  if(!arr.length){
    console.log('リクエストはありません。');
    return;
  }
  console.log(`\n=== favibe リクエスト一覧 (${arr.length}件) ===\n`);
  for(let i=0;i<arr.length;i++){
    const r = arr[i];
    const date = r.at ? new Date(r.at).toLocaleString('ja-JP') : '-';
    const parsed = r.parsed ? JSON.stringify(r.parsed) : '';
    console.log(`${i+1}. [${r.key}] ${r.name || '(無名)'}`);
    console.log(`   URL: ${r.url || ''}`);
    if(parsed && parsed!=='{}') console.log(`   parsed: ${parsed}`);
    console.log(`   status: ${r.status||'申請中'} / at: ${date}`);
    console.log('');
  }
  console.log('---');
  console.log('次のステップ: あなたがプレイリストIDを提示したら、私が artists-master.json と data.json に反映します。');
  console.log('例: 範囲選択したリクエストを承認するには、対応する playlistId を教えてください。');
}

async function main(){
  const isJson = process.argv.includes('--json');
  const isClear = process.argv.includes('--clear');
  const dbUrl = getDatabaseURL();

  let requests = [];
  if(dbUrl){
    try{
      requests = await fetchRequestsFromFirebase(dbUrl);
    }catch(e){
      console.error('[favibe] Firebase取得失敗:', e.message);
      console.log('→ firebase-config.js の databaseURL が正しいか、Realtime Databaseが有効か確認してください。');
      console.log('→ 代わりにローカルの data/requests.json を確認します。');
      requests = loadLocalRequests();
    }
  } else {
    console.log('[favibe] firebase-config.js に databaseURL が未設定のため、ローカルを確認します。');
    console.log('  Firebaseを有効化すると、クラス全員のリクエストが共有され、私が直接確認できます。');
    requests = loadLocalRequests();
    if(!requests.length){
      console.log('\nローカルにもリクエストはありません。');
      console.log('ヒント: ブラウザの開発者ツールで localStorage.getItem("favibe_requests") を実行すると、端末内のリクエストが見られます。');
    }
  }

  if(isJson){
    console.log(JSON.stringify(requests, null, 2));
  } else {
    formatTable(requests);
  }

  if(isClear){
    console.log('\n--clear が指定されましたが、自動削除は行いません。');
    console.log('Firebaseから削除するには:');
    if(dbUrl) console.log(`  curl -X DELETE "${dbUrl}/favibe/requests.json"`);
    console.log('  または Firebaseコンソール → Realtime Database → favibe/requests を削除');
    console.log('ローカルの場合: data/requests.json を手動で削除');
  }
}

main().catch(e=>{console.error(e); process.exit(1);});
