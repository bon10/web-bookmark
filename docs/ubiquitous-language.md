# ユビキタス言語（用語辞書）

このアプリで扱うドメイン概念の呼び方を一箇所に定める。実装（変数名・関数名・型名・コンポーネント名）と UI ラベルは、すべてこの辞書に従う。疑義が出たらまずこの辞書を直し、そのあとで実装を直す。実装の都合で辞書を歪めない。

関連ドキュメント：

- [デザイン方針](design-system.md) — 画面の意匠・トークン・テーマ切り替え
- `app/AGENTS.md` — Next.js のバージョン固有の注意（自動生成）

---

## ブックマーク関連

### ブックマーク（Bookmark）

このアプリの中心となるエンティティ。**URL・タイトル・サムネイル画像・評価・タグ**をひとまとめにした1件の記録を指す。マスタ。

参照先は Web ページであれば何でもよい。動画に限らず、服・商品・記事なども対象になる（README の「Pinterest のように画像と URL とタグを使って Web サイトをブックマークする」がこの概念の出発点）。**「画像と URL を組み合わせて保存したもの」が定義であり、参照先の種類は定義に含めない。**

データソースは DB の `videos` テーブル（テーブル名は旧称のまま。後述の「用語の不一致」を参照）。アプリ層での型は `Bookmark`（`app/components/BookmarkArchive.tsx`）。

**使わない語**：ビデオ / 動画 / video、アイテム / item、エントリ / entry、リンク / link。
これらはすべて「ブックマーク」に統一する。ただし DB のテーブル名・カラム名を直接指すときだけは `videos` `video_url` 等の実名を使ってよい。

### サムネイル（Thumbnail）

1件のブックマークに 0 枚以上ぶら下がる画像。ユーザーが自分で用意する（自動取得はしない）。マスタ。

実体は Cloudflare R2 上のオブジェクトで、キーは `thumbnails/<ブックマークID>/<内容のSHA-256先頭16桁>.<拡張子>`。DB の `thumbnails` テーブルにはこのオブジェクトキーだけを持ち、**表示用 URL は `NEXT_PUBLIC_R2_PUBLIC_URL` と連結して組み立てる派生値**（`app/utils/thumbnailUrl.ts`）。

キーに内容ハッシュを含めるため、画像を差し替えない限り URL は変わらない。R2 側で `immutable` を返しているので、その間はブラウザも Next の画像キャッシュも再取得しない。

### タグ（Tag）

ブックマークを分類する短い語。マスタは `tags` テーブル、ブックマークとの関連は `video_tags` テーブル。

**同名のタグは再利用し、無ければ作る**（`resolveTagId`）。したがって「タグの新規作成」は独立した操作ではなく、ブックマーク登録の副作用として起きる。

### 評価（Rating）

ブックマークに付ける 1.0〜5.0 の値。マスタ（`videos.rating`）。

- 入力は **0.5 刻み**（`StarRatingInput`）
- DB 側に 1〜5 の CHECK 制約があるため、**未評価は `0` ではなく `null`**
- 表示は 0.5 刻みに丸めず、値をそのまま星の塗り幅の割合に変換する（`StarRating`）

### 表示順（Sort order）

一覧の並び順を決める整数。マスタ（`videos.sort_order`）。未指定は 0。

### URL の表示

一覧では **URL を省略せず全文で出す**。ブックマークを開くためではなく、**URL 自体を貼り付けたい場面が多い**ため。

以前はホスト名だけを表示していたが（`hostOf`）、貼り付け用途を満たせないので廃止した。現在は全文表示に `user-select: all` を当て、あわせてコピーボタンを置いている（`BookmarkUrl`）。

---

## 画面・操作

### 書架

ブックマークの一覧そのものを指す UI 上の呼称。「一覧」「アーカイブ」と混在させない。

- 一覧画面＝「書架」
- 登録＝「書架に納める」
- 削除の確認文＝「本当にこのブックマークを削除してもよろしいですか？」

### 栞（しおり）

本アプリのシンボル。朱の角印の意匠（`Seal`）。プロダクト名ではなく**マーク**を指す語なので、文章中で本アプリを指すときは「本アプリ」または「Webサイトブックマーク」を使う。

### 絞り込み

一覧に対する検索語とタグによる限定。「フィルタ」「検索」と混在させない。**タグを複数選んだときは AND**（選んだタグをすべて持つブックマークだけが残る）。

### 淡 / 濃（テーマ）

表示テーマの呼称。UI 上のラベルは `auto` / `light` / `dark`（欧文小ラベルの体裁に合わせる）。文章中で説明するときは「淡（ライト）」「濃（ダーク）」と書く。詳細は [デザイン方針](design-system.md)。

---

## UI ラベル一覧

| 概念 | UI ラベル | コード上の識別子 | データソース |
| --- | --- | --- | --- |
| ブックマーク | ブックマーク / 書架（一覧） | `Bookmark`, `bookmarks`, `addBookmark`, `deleteBookmark` | `videos` |
| ブックマークのURL | URL（**全文表示・省略しない**） | `Bookmark.url`, `BookmarkUrl` | `videos.video_url` |
| タイトル | タイトル | `Bookmark.title` | `videos.title` |
| 評価 | Rating（欧文小ラベル） | `Bookmark.rating` | `videos.rating` |
| タグ | Tags（欧文小ラベル） | `Bookmark.tags` | `tags` × `video_tags` |
| サムネイル | Thumbnails（欧文小ラベル） | `Bookmark.thumbnails`, `ThumbnailCarousel` | `thumbnails` ＋ R2 |
| 表示順 | Sort order（欧文小ラベル） | `sort_order`（フォーム項目名） | `videos.sort_order` |
| 表示テーマ | auto / light / dark | `ThemeMode`, `ResolvedTheme` | `localStorage` ＋ OS 設定 |

---

## 用語の不一致（DB 側が旧称のまま）

このアプリは当初「動画（video）」を対象に作られたため、**DB のテーブル名・カラム名に `video` が残っている**。一方でアプリ層の用語は「ブックマーク」に統一済み。

| DB の実名 | 意味 | 本来あるべき名 |
| --- | --- | --- |
| `videos` | ブックマーク | `bookmarks` |
| `videos.video_url` | ブックマークのURL | `bookmarks.url` |
| `video_tags` | ブックマークとタグの関連 | `bookmark_tags` |
| `video_tags.video_id` | ブックマークID | `bookmark_tags.bookmark_id` |
| `thumbnails.video_id` | ブックマークID | `thumbnails.bookmark_id` |
| `related_videos` | 関連ブックマーク（**アプリからは未使用**） | `related_bookmarks` |

### 守るルール

1. **`video` という語を書いてよいのは、DB の実名を直接指すときだけ。** それ以外の変数名・型名・コメント・UI 文言では使わない。
2. **読み替えは境界の2ファイルに閉じる。** `app/app/page.tsx`（取得時）と `app/app/actions.ts`（登録・削除時）だけが `videos` / `video_url` / `video_id` に触れる。この2ファイルより下の層に `video` を持ち込まない。
3. この2ファイルの冒頭には、この辞書への参照コメントを置く。

### 宿題：DB のリネーム

上表のリネームは未実施。実施するなら以下が必要。

1. `supabase/migrations` が存在しないため、**初のマイグレーションになる**。まず現行スキーマのベースラインを取る
2. テーブル・カラムの `RENAME`。外部キー制約名とインデックス名も追随させる
3. **RLS ポリシーがテーブル名を参照していないか確認**（参照していれば貼り直し）
4. `app/types/schema.ts` を `supabase gen types` で再生成
5. 境界2ファイルの読み替えを削除し、`Bookmark` の項目名と DB カラム名を一致させる
6. R2 のオブジェクトキー `thumbnails/<ID>/...` は **ID が変わらないため影響なし**（移行不要）
