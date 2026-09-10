import {createClient} from '@/utils/supabase/server';
import {s3GetSignedUrl} from '@/utils/awsClient';
import LoginForm from '@/components/LoginForm';
import AddVideoForm from '@/components/AddVideoForm';
import VideoTable, {type VideoListItem} from '@/components/VideoTable';

// 署名付きURLは当日0時基準で発行され、閲覧者ごとのセッションにも依存するため、
// ビルド時に固定せずリクエストごとに描画する。
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

  const videos: VideoListItem[] = await Promise.all(
    (data ?? []).map(async (video) => ({
      id: video.id,
      title: video.title,
      videoUrl: video.video_url,
      rating: video.rating,
      tags: video.video_tags.flatMap((videoTag) => (videoTag.tags ? [videoTag.tags] : [])),
      thumbnails: await Promise.all(
        video.thumbnails.map(async (thumbnail) => ({
          id: thumbnail.id,
          signedUrl: await s3GetSignedUrl(thumbnail.thumbnail_path),
        })),
      ),
    })),
  );

  return (
    <main className="container mx-auto px-4">
      <AddVideoForm />
      <h1 className="mb-4 text-4xl font-bold">Webサイト一覧</h1>
      <VideoTable videos={videos} />
    </main>
  );
}
