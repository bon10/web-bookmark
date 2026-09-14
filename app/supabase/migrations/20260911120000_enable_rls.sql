-- ユビキタス言語: docs/ubiquitous-language.md
--
-- このリポジトリ初のマイグレーション。スキーマのベースラインは含めず、RLS の設定だけを入れる。
--
-- 背景: public スキーマのテーブルは PostgREST 経由で公開されており、anon ロールへの
-- 既定の GRANT が残っている。本アプリの publishable key はブラウザへ配信される前提の
-- 公開キーなので、RLS が無効な間は「キーを入手した第三者が REST API で全件を読み取り・
-- 書き換え・削除できる」状態になる。ログイン画面は UI の入口を塞ぐだけで、DB の入口は
-- 塞いでいない。そこで DB 側で「ログイン済み（authenticated）のみ」を強制する。
--
-- 粒度について: 本アプリのテーブルに所有者を表す列（user_id 等）は無く、1 アカウントで
-- 使う前提のため、行の絞り込みはせず authenticated 全員に全行を許す。アカウントを
-- 増やして利用者ごとにブックマークを分けるときは、所有者列の追加とポリシーの書き直しが
-- 別途必要になる。

-- RLS が無効だった間に作られ、評価されていなかったポリシー。
-- 名前は「insert のみ」だが実体は cmd=ALL の全操作許可で、下で作るポリシーと内容が同じ。
-- permissive なポリシーは OR で合成されるため残しても結果は変わらないが、名前が実態と
-- ずれていて「読み取りは塞がれている」と誤読させるので落とす。

-- videos: ブックマーク本体
alter table public.videos enable row level security;

drop policy if exists "Enable insert for authenticated users only" on public.videos;
drop policy if exists videos_authenticated_all on public.videos;
create policy videos_authenticated_all on public.videos
  for all
  to authenticated
  using (true)
  with check (true);

-- tags: タグのマスタ
alter table public.tags enable row level security;

drop policy if exists "Enable insert for authenticated users only" on public.tags;
drop policy if exists tags_authenticated_all on public.tags;
create policy tags_authenticated_all on public.tags
  for all
  to authenticated
  using (true)
  with check (true);

-- video_tags: ブックマークとタグの関連
alter table public.video_tags enable row level security;

drop policy if exists "Enable insert for authenticated users only" on public.video_tags;
drop policy if exists video_tags_authenticated_all on public.video_tags;
create policy video_tags_authenticated_all on public.video_tags
  for all
  to authenticated
  using (true)
  with check (true);

-- thumbnails: R2 のオブジェクトキーを持つ行
alter table public.thumbnails enable row level security;

drop policy if exists "Enable insert for authenticated users only" on public.thumbnails;
drop policy if exists thumbnails_authenticated_all on public.thumbnails;
create policy thumbnails_authenticated_all on public.thumbnails
  for all
  to authenticated
  using (true)
  with check (true);

-- related_videos: アプリからは未使用だが、PostgREST には公開されているため同様に塞ぐ
alter table public.related_videos enable row level security;

drop policy if exists "Enable insert for authenticated users only" on public.related_videos;
drop policy if exists related_videos_authenticated_all on public.related_videos;
create policy related_videos_authenticated_all on public.related_videos
  for all
  to authenticated
  using (true)
  with check (true);

-- ポリシーを貼っていない anon は RLS だけでも弾かれるが、GRANT 自体も落として
-- 「ポリシーを消したら素通しに戻る」状態を残さない。
-- Supabase Auth のログイン処理は auth スキーマを使うため、public スキーマの権限を
-- 落としてもログインには影響しない。
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 既定 GRANT も落として、今後テーブルを足したときに anon へ自動で権限が付くのを止める。
-- alter default privileges は「このマイグレーションを実行したロールが作るオブジェクト」にしか
-- 効かないため、別のロールでテーブルを作る運用に変えたときは貼り直しが必要。
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
