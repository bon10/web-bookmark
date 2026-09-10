import {createClient} from '@/utils/supabase/server';
import {thumbnailUrl} from '@/utils/thumbnailUrl';
import LoginForm from '@/components/LoginForm';
import AddVideoForm from '@/components/AddVideoForm';
import VideoTable, {type VideoListItem} from '@/components/VideoTable';

// 一覧の内容はログイン中のセッションに依存するため、ビルド時に固定せずリクエストごとに描画する。
export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await createClient();

  // getSession() はサーバー側でトークンを検証しないため、認可判定には getClaims() を使う。
  const {data: claimsData} = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    return <LoginForm />;
  }

  const {data, error} = await supabase
    .from('videos')
    .select('id, title, video_url, rating, video_tags(tags(id, name)), thumbnails(id, thumbnail_path)')
    .order('sort_order', {ascending: true});

  if (error) {
    return (
      <main className="container mx-auto px-4 py-8">
        <p role="alert" className="text-red-600">
          一覧の取得に失敗しました: {error.message}
        </p>
      </main>
    );
  }

  // R2 は公開URLで直接配信するため、署名の発行が不要になり同期処理で済む。
  const videos: VideoListItem[] = (data ?? []).map((video) => ({
    id: video.id,
    title: video.title,
    videoUrl: video.video_url,
    rating: video.rating,
    tags: video.video_tags.flatMap((videoTag) => (videoTag.tags ? [videoTag.tags] : [])),
    thumbnails: video.thumbnails.map((thumbnail) => ({
      id: thumbnail.id,
      url: thumbnailUrl(thumbnail.thumbnail_path),
    })),
  }));

  return (
    <main className="container mx-auto px-4">
      <AddVideoForm />
      <h1 className="mb-4 text-4xl font-bold">Webサイト一覧</h1>
      <VideoTable videos={videos} />
    </main>
  );
}
