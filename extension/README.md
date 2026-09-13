# 書架に納める（Chrome 拡張）

開いているページから画像候補を集め、タグ・評価を付けて[アプリ](../app)のブックマーク書架に納める。
用語は [docs/ubiquitous-language.md](../docs/ubiquitous-language.md) に従う。

## できること

- ページの `og:image` / `twitter:image` / `img`（`srcset` と遅延読み込み属性を含む）/ CSS の背景画像 / `video[poster]` から画像候補を集め、最大 12 枚を提示する
- 動画から静止画を抜く。`<video>` を等間隔にシークして canvas で 6 枚抜き、読み出せない動画なら画面キャプチャに切り替える
- 選んだ画像（最大 10 枚）、タイトル、URL、評価（0.5 刻み）、タグ、表示順をまとめて登録する
- 画像の形式は**先頭バイトを見て判定する**。配信元が `application/octet-stream` や `image/jpg` のような値を返しても正しい形式として送る。判定できない形式は、デコードできる限り JPEG に変換して送る
- **入力は打つたびに保存する。** タブやウィンドウを切り替えてポップアップが閉じても、同じページで開き直せばタグ・評価・タイトル・選んだ画像が戻る（鍵はページの正規化した URL、直近 5 ページ分・7 日間）
- タグは書架と同じ `tags` テーブルを候補に出す。未知の語は `New` と表示し、登録の副作用として作られる
- 同じページが既に書架にあるかを知らせる（計測パラメータを落とした URL で突き合わせる）
- 送信に失敗したら入力を下書きとして残し、次に同じページで開いたときに戻す

## 入れ方

1. `chrome://extensions` を開き、「デベロッパーモード」を入れる
2. 「パッケージ化されていない拡張機能を読み込む」で `extension/` を選ぶ
3. 拡張の「設定」を開き、3つを入れて保存する
   - アプリの URL（例 `http://localhost:3000`）
   - Supabase プロジェクトの URL
   - Supabase publishable key（アプリの `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` と同じ値）
4. 保存時にアプリと Supabase へのホスト権限を求めるので許可する
5. ツールバーのアイコンからポップアップを開き、アプリと同じメールアドレス／パスワードでログインする

画像の取得に必要なホスト権限は、**選んだ画像の配信元ごとに、納めるときに要求する**（例：`fourhoi.com` の画像を選んだらそのホストだけ）。サイトごとに確認を出されたくない場合は、設定画面の「すべてのサイトでの画像取得を許可」でまとめて許可できる。

## 権限について

| 権限 | 何に使うか |
| --- | --- |
| `activeTab` | ポップアップを開いたタブのページから画像候補を集める。アイコンを押したときだけ有効になり、ページを移動すると切れる |
| `scripting` | 上記の収集と、動画のシークをページ内で動かす |
| `storage` | 接続先の設定、ログイン状態、送信に失敗した下書きの保存 |
| アプリ／Supabase のホスト | 登録と認証の通信。設定の保存時に要求する |
| 画像の配信元ホスト | 選んだ画像の本文を取得するため。納めるときに、その配信元だけを要求する |
| すべてのサイト（任意） | 上をサイトごとに聞かれたくない場合のまとめ許可。設定画面から |

画像の配信元の権限が必要な理由は、**画像を URL ではなく本文で送っている**ため。サーバーから画像 URL を
取りに行くと、参照元ページの Cookie を付けられず 403 を返すサイトがあるので、ページを開いている
拡張側で取得する。そして任意のホストへ fetch できるのは service worker だけで、それには
ホスト権限が要る（content script からの fetch は注入先ページのオリジン扱いになり CORS で止まる）。
出典: [Network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

**権限が無いまま取得しようとすると CORS で弾かれる。** service worker の fetch も、ホスト権限が無ければ
通常の Web ページと同じ扱いになり、`Access-Control-Allow-Origin` を返さない配信元では必ず失敗する
（`has been blocked by CORS policy` というエラーになる）。そのためポップアップは、納めるときに
選んだ画像の配信元をまとめて要求してから送信する。

この権限は、別オリジンの埋め込みプレーヤー（ブログに貼られた動画など）からフレームを抜くときにも効く。
`activeTab` だけだとタブの主フレームにしか触れないため、埋め込みには届かない。
出典: [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

## 取れない場合があること

- **DRM で保護された動画**: canvas も画面キャプチャも黒くなる。手元の画像を使う
- **別オリジンの直リンク動画**: canvas が汚染されて読み出せないため、自動で画面キャプチャに切り替わる。
  このとき `chrome.tabs.captureVisibleTab` が毎秒2回までに制限されているので、枚数は4枚に抑えてある
  （出典: [tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)）
- **`chrome://` やウェブストアのページ**: 拡張のスクリプトを注入できない
- **SVG**: service worker では `createImageBitmap` が SVG を扱えないため、JPEG へ変換できず送れない
- **下書きに残らないもの**: 動画から抜いた静止画は data URL で重いため、合計 2MB を超えた分は下書きに載せない（戻したときに何枚戻せなかったかを表示する）

## 構成

| ファイル | 役割 |
| --- | --- |
| `src/background.js` | service worker。ログインとサーバーへの送信。アクセストークンを扱うのはここだけ |
| `src/session.js` | Supabase のセッション（取得・更新・破棄） |
| `src/settings.js` | 接続先の設定とホスト権限の確認 |
| `src/page.js` | ページの中で動かす関数（画像収集・フレーム抜き出し）。外の変数を参照できない前提で書く |
| `src/popup.js` | 候補の提示と入力。トークンは持たない |
| `src/options.js` | 接続先の設定とホスト権限の要求 |

アプリ側の受け口は `app/app/api/bookmarks`、`app/app/api/bookmarks/lookup`、`app/app/api/tags`。
いずれも `Authorization: Bearer` のアクセストークンを検証し、CORS ヘッダーを返さない。
