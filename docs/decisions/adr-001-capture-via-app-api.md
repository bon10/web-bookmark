# ADR-001: 拡張からのブックマーク登録はアプリの API 経由にする

## ステータス

承認済み（Accepted、2026-09-11 決定）

## タグ

`Chrome拡張` `認証` `取り込み` `CORS` `RLS`

## コンテキスト

**きっかけ**：2026-09-11、ブックマークの登録を手作業（タイトルと URL の転記、画像を自分でスクリーンショットして添付）から減らすため、開いているページから画像候補とタグを拾って登録する Chrome 拡張を作ることになった。拡張がどの経路でデータを書くかを決める必要が出た。

**観察した事実**：

- 登録と削除は Server Action（`app/app/actions.ts`）で、セッションは Cookie として `@supabase/ssr` が持つ（`app/proxy.ts`）。**拡張は別オリジンで動くためこの Cookie を送れない**
- サムネイルの保存は R2 の資格情報を使うサーバー側の処理（`app/utils/r2Client.ts`）。オブジェクトキーは `thumbnails/<ブックマークID>/<内容のSHA-256先頭16桁>.<拡張子>` という規則を持つ
- DB への接続キーはブラウザへ配信される publishable key（`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`）
- 着手時点で `videos` / `tags` / `video_tags` / `thumbnails` / `related_videos` の5テーブルは **RLS が無効で、anon ロールに全権限の GRANT が残っていた**。ポリシー自体は存在したが、RLS が無効な間は評価されない（[PostgreSQL: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) — "policies can exist for a table even if row-level security is disabled. In this case, the policies will _not_ be applied"）。つまり公開キーを入手した第三者が REST API 経由で全件を読み書きできる状態だった。2026-09-11 に `app/supabase/migrations/20260911120000_enable_rls.sql` で塞いだ
- 画像を「URL で渡してサーバーに取得させる」方式は、参照元ページの Cookie と Referer が付かないため 403 を返すサイトがある

**既存ドキュメントで判断できなかった理由**：[ユビキタス言語](../ubiquitous-language.md) は語の定義を扱い、経路の判断は扱わない。ルートの `README.md` は構成の記述のみ。`decisions/` は本 ADR が最初。

## Intent（意図）

1. **最優先：拡張に持たせる資格情報を「本人のアクセストークンだけ」に抑える。** 拡張のファイルは誰でも展開して読めるため、R2 の資格情報と secret key を拡張に置かない
2. **次点：画面と拡張で登録結果が一致すること。** 入力検査（枚数・サイズ・形式・評価の範囲）とタグの引き当てが二重実装にならない
3. **次点：画像の取得に失敗しにくいこと。** 参照元ページの資格情報を使える側が画像を取る
4. **将来：入口が増えても書き込みの境界を1つに保てること。** いまは画面と拡張の2つだが、3つ目が出ても同じ関数を通る

## 選択肢

### 案A: 拡張から Supabase を直接叩く

**メリット:**

- アプリ側の改修が不要
- アプリが停止していても登録できる

**デメリット:**

- R2 への保存経路が無い。署名付き URL を発行する口を別途作るか、拡張に R2 の資格情報を置くことになる（Intent 1 に反する）
- サムネイルのオブジェクトキー規則を拡張側に複製することになり、片方だけ直すとキャッシュ制御が壊れる
- 入力検査とタグの引き当てが画面側と二重実装になる（Intent 2 に反する）
- 拡張の不具合が DB へ直接届く

### 案B: アプリに Route Handler を新設し、拡張はそこだけを叩く（推奨）

**メリット:**

- 既存の書き込み処理・R2 への保存・入力検査をそのまま再利用できる
- 拡張が持つ資格情報はアクセストークンだけで済む
- API が発行するクエリは利用者のロール（`authenticated`）で走るので、RLS が最後の門として効く

**デメリット:**

- アプリ側の改修が必要
- アプリが停止していると登録できない
- 公開エンドポイントが常設される

### 案C: 登録画面をパラメータ付きで開くだけ

**メリット:**

- 実装が最小。認証も既存の Cookie のまま

**デメリット:**

- ワンクリックで納まらず、手作業を減らすという目的を満たさない
- 画像は URL でしか渡せないため、403 を返すサイトの問題が残る

## 決定

**案B: アプリに Route Handler を新設し、拡張はそこだけを叩く** を採用する。

ただし**ログイン（アクセストークンの発行と更新）だけは Supabase Auth を直接叩く**。

受け口は `app/app/api/bookmarks/route.ts`（登録）、`app/app/api/bookmarks/lookup/route.ts`（重複確認）、`app/app/api/tags/route.ts`（タグ候補）。

## 根拠

### 1. 資格情報の最小化（Intent 1）

案Bでは R2 の資格情報がサーバー側に留まる。案Aは R2 への書き込み経路を別に用意する必要があり、どう作っても「拡張に鍵を置く」か「署名を発行する口を公開する」のどちらかに寄る。前者は Intent 1 に正面から反し、後者は結局アプリ側の改修が要るので案Aの利点（無改修）が消える。

### 2. 境界を1つに保つ（Intent 2, 4）

書き込みを `app/utils/bookmarks.ts` に寄せ、Server Action と Route Handler はそれを呼ぶだけにした。DB のテーブル名の読み替え（`videos` → ブックマーク）もこの1ファイルに閉じる。[ユビキタス言語](../ubiquitous-language.md) の「守るルール」に追記済み。

### 3. 画像は取りに行ける側が取る（Intent 3）

画像の本文（multipart）で送る方式にした。拡張の service worker はホスト権限があれば自オリジン外へ fetch でき、CORS を受けない。content script からの fetch は注入先ページのオリジン扱いになるため使えない（[Network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) — "A script executing in an extension service worker or foreground tab can talk to remote servers outside of its origin, as long as the extension requests host permissions" / "content scripts are also subject to the same origin policy"）。

### 4. CORS ヘッダーを付けないことが守りになる

3 と同じ非対称を裏返して使う。**Route Handler に `Access-Control-Allow-Origin` を返さない**と、拡張の service worker からは通り、任意の Web ページからは CORS で止まる。ヘッダーを足さないことが設定そのものなので、ここは「書き忘れ」と区別できるようコードにコメントを残してある。

### 5. ログインだけ直叩きにする理由

アクセストークンを発行できるのは認証サーバーだけで、アプリに中継の口を作っても守りは増えず、経路が一段増えるだけになる。拡張が Supabase に送るのはメールアドレスとパスワード、受け取るのはトークンで、DB には触れない。

## Consequence（結果・トレードオフ）

**得られるもの:**

- 拡張が保持する秘密はアクセストークンとリフレッシュトークンのみ
- 画面と拡張で検査・タグ解決・R2 のキー規則が完全に共通
- 403 を返す画像配信元でも、ページを開いている側が取るため取得できる
- 3つ目の入口を足すときも同じ受け口を使える

**失うもの / 引き受けるトレードオフ:**

- アプリが停止していると拡張から登録できない
- 認証必須の公開エンドポイントが常設される。受け止めは「トークン検証」「CORS ヘッダーを返さない」「枚数・サイズ・形式・評価範囲の検査」の3点
- **画像の配信元ごとにホスト権限が要る。** 権限が無い状態では service worker の fetch も通常の Web ページと同じ CORS の対象になり、`Access-Control-Allow-Origin` を返さない配信元では必ず失敗する。納めるときに、選んだ画像の配信元をまとめて要求する形にした（まとめて許可したい場合は設定画面から「すべてのサイト」を許可できる）
- 別オリジンの埋め込みプレーヤーからフレームを抜くには、そのフレームのホスト権限が要る。`activeTab` だけではタブの主フレームにしか触れない（[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)）
- 画像の本文を送るぶん、URL を送るより通信量が増える

## 決定していないこと

- **レート制限**：自分1人で使う前提のため入れていない。複数人で使う、または API を他のクライアントへ開くときに決める
- **既存ブックマークへの追記**：更新系のアクションがアプリに無いため、重複を検出しても「既存に画像を足す」ができない。追記の需要が出たら更新系の新設とあわせて決める
- **タグの削除・リネーム・統合**：タグは登録の副作用でしか増えず、減らす手段が無い。管理 UI を作るときに決める
- **拡張の配布方法**：現状は `chrome://extensions` から未パッケージで読み込む。他端末でも使う必要が出たら決める
- **RLS の粒度**：いまは所有者列を持たず `authenticated` に全行を許している。利用者が2人以上になったときに所有者列の追加とあわせて決める（本 ADR の範囲外）
- **画像候補の重複判定**：候補の段階では URL の完全一致だけを見ている。内容が同じで URL が違う画像は別候補として出る

## 再検討のトリガー

- アプリを経由できない入口（iOS ショートカット、別端末のブラウザなど）を足す必要が出たとき
- アプリを停止したままブックマークを登録したい要件が出たとき
- `/api/bookmarks` を拡張以外のクライアントに開くとき（「CORS ヘッダーを返さない」前提が崩れる）
- 利用者が2人以上になったとき（RLS の粒度と、トークンだけで足りるかを同時に見直す）
- R2 の公開 URL 配信をやめて署名付き URL に変えるとき（サムネイルの受け渡し方が変わる）
- Chrome が service worker の fetch に対するホスト権限の扱いを変えたとき（根拠 3・4 の前提が崩れる）

## 設計ルール

- **R1.** 拡張が Supabase を直接叩くのは、トークンの発行（`grant_type=password`）と更新（`grant_type=refresh_token`）だけ。DB と R2 には触らない
- **R2.** ブックマークの書き込みは `app/utils/bookmarks.ts` を通す。Route Handler と Server Action はそれを呼ぶだけで、DB の実名（`videos` 等）に触れない
- **R3.** Route Handler に CORS ヘッダーを付けない。`OPTIONS` も実装しない
- **R4.** アクセストークンを扱うのは拡張の service worker だけ。content script には渡さない（content script は注入先ページと DOM を共有するため）
- **R5.** 画像は本文（multipart）で送る。URL をサーバーに渡してサーバーに取得させない。取得に必要なホスト権限は、納める操作の中で配信元ごとに要求する（`permissions.request` は利用者の操作の中からしか呼べないため、`await` を挟む前に呼ぶ）
- **R6.** 動画からの静止画は canvas を第一手にし、読み出せない場合だけ画面キャプチャに切り替える。キャプチャの枚数と間隔は `tabs.captureVisibleTab` の毎秒2回制限に合わせる
- **R7.** 枚数・サイズ・MIME・評価の範囲の検査は、画面からの経路でも拡張からの経路でも必ず R2 の境界で行う

## データモデルへの影響

テーブル・カラムの追加は無い。関連する変更は2つ。

- RLS を5テーブルで有効化し、`authenticated` 限定のポリシーを貼った（`app/supabase/migrations/20260911120000_enable_rls.sql`）。これは本 ADR の前提であって、本 ADR の決定事項ではない
- **正規化した URL は保存しない。** 重複確認は取得後にアプリ側で突き合わせる（`app/utils/bookmarkUrl.ts`）。URL は貼り付け用途で使うため、利用者が確定した文字列をそのまま残す

## 影響を受けるドキュメント

- [x] [`docs/ubiquitous-language.md`](../ubiquitous-language.md) — **影響あり（対応済み）**。書き込みの境界を `actions.ts` から `utils/bookmarks.ts` へ変更、サムネイルの用意経路に拡張を追記、「画像候補」「正規化した URL」を追加
- [x] [`extension/README.md`](../../extension/README.md) — **影響あり（作成済み）**。権限の根拠と取れない場合の説明を含む
- [ ] `README.md`（リポジトリルート） — **影響あり（未対応）**。「構成」の節に拡張が無く、Storage が `AWS S3` のままで R2 への移行（コミット `731777f`）が反映されていない
- [x] [`docs/README.md`](../README.md) — **影響あり（対応済み）**。ドキュメント一覧に `decisions/` の行を追加
- [ ] [`docs/design-system.md`](../design-system.md) — 影響なし。拡張は淡／濃の選択を読めないため OS の設定に従う。アプリの意匠の判断は変わらない
- [ ] `app/AGENTS.md` — 影響なし（`next dev` が生成するファイル）
- [ ] `app/types/schema.ts` — 影響なし（テーブル定義は変えていない）
