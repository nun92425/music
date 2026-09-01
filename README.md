# favibe - favorite vibe

にじさんじの歌みたを連続で聴く、クラス内共有の音楽サービス。  
`favorite` の `vibe`。Mili Unishare の **Millivibe** を参考にしたファン制作のクローンです（非公式）。

- **自動連続再生** / キュー / シャッフル / リピート / AUTOMIX / お気に入り / ランキング / プレイリスト
- **推し選択共有システム**: 初回に推し（にじさんじ）を複数選択するとクラス全員に共有され、以後の更新がその推しで自動実行されます。後から追加も可能。
- YouTube IFrame API で再生（広告は通常通り表示、プレイヤーを覆い隠さない）。

## 初期推し

- 珠乃井ナナ / 叶 / 葛葉 / ChroNoiR（叶+葛葉）  
  `artists-master.json` に定義、`data.json` に歌みたプレイリストのキャッシュを保持。

## 使い方（クラス向け）

1. `https://favibe.onrender.com/` を開く
2. 初回モーダルで推しを選ぶ → 保存（Firebaseが設定されていれば全員に即共有、未設定なら端末ローカル）
3. 検索/ランキングから曲をキューに追加、自動連続再生ONで止まらずに聴けます
4. 右上「推しを追加」で後から変更可能

## 開発者向け

### ローカル起動

```bash
python3 -m http.server 8000
# http://localhost:8000/
```

### 曲データ更新

`artists-master.json` に `playlistId` を記入後:

```bash
YOUTUBE_API_KEY=xxx node scripts/fetch-youtube.js
# or 全件
YOUTUBE_API_KEY=xxx node scripts/fetch-youtube.js --all
```

GitHub Actions が毎日 JST 6:00 に自動実行 (`YOUTUBE_API_KEY` は GitHub Secrets に登録)。手動実行も可。

### 上流(Millivibe)追従

元サイトは開発中のため、差分を確認:

```bash
bash scripts/sync-upstream.sh
```

`millivibe.*` の変更を手動で `favibe.*` にマージしてください。

### デプロイ (Render)

- Static Site, Publish `./`
- `render.yaml` で `X-Robots-Tag: noindex` 付与済み
- `robots.txt` でクロール拒否

### Firebase共有を有効化する場合

1. Firebaseコンソールで新規プロジェクト作成 → Realtime Database 有効化
2. `firebase-config.js` に `firebaseConfig` を貼り付け
3. Rules を以下に (クラス限定URLなので全許可でOK):

```json
{
  "rules": {
    "favibe": { ".read": true, ".write": true }
  }
}
```

4. 匿名Authを有効化（共有に必要）

未設定でもローカル動作は可能です。

## 構成

```
index.html / favibe.html   # favibe本体 (noindex)
favibe.css / millivibe.css # スタイル
js/favibe.js               # Millivibe移植 + 推し共有
js/config.js / storage.js / icons.js
artists-master.json        # 推しマスタ
data.json                  # 歌みたキャッシュ (生成物)
favibe-presets.json
site-config.json
scripts/fetch-youtube.js   # YouTube APIで data.json 更新
.github/workflows/update-data.yml
render.yaml
```

## ライセンス / 注意

- 本プロジェクトは Milli Unishare の Millivibe を参考にした非公式ファン制作です。
- 楽曲の著作権は各権利者に帰属します。
- クラス内限定の非公開運用を想定しています (`noindex`)。
