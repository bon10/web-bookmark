import {useState, useEffect, ChangeEvent, useRef, createRef} from 'react';
import {supabase} from '../utils/supabaseClient';
import {Video, Tag, Thumbnail} from '../utils/supabaseClient';
import ReactStars from 'react-rating-stars-component';
import {Auth} from '@supabase/auth-ui-react'
import {Session, Subscription} from '@supabase/supabase-js';
import {ThemeSupa} from '@supabase/auth-ui-shared';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({data: {session}}) => {
      setSession(session)
    })

    const {
      data: {subscription},
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])
  const [videos, setVideos] = useState<any[]>([]);

  useEffect(() => {
    fetchVideos();
  }, []);

  async function fetchVideos() {
    const {data: videosData, error: videosError} = await supabase
      .from('videos')
      .select('*, video_tags(tag_id, tags(*)), thumbnails(*)')
      .order('sort_order', {ascending: true});

    if (videosData) {
      const updatedVideos = await Promise.all(
        videosData.map(async (video) => {
          const signedThumbnails = await Promise.all(
            video.thumbnails.map(async (thumbnail) => {
              const {data: signedUrlData, error: signedUrlError} = await supabase.storage
                .from('thumbnails')
                .createSignedUrl(thumbnail.thumbnail_path, 600);

              if (signedUrlError) {
                console.error('Error creating signed URL:', signedUrlError.message);
                return {...thumbnail, signed_url: ''};
              }

              return {...thumbnail, signed_url: signedUrlData.signedUrl};
            }),
          );

          return {...video, thumbnails: signedThumbnails};
        }),
      );

      setVideos(updatedVideos);
    }

    if (videosError) {
      console.error('Error fetching videos:', videosError.message);
    }
  }
  const [videoTags, setVideoTags] = useState<Record<number, Tag[]>>({});

  const fetchTagsForVideo = async (videoId: number) => {
    const {data: videoTags, error} = await supabase
      .from("video_tags")
      .select("tag_id")
      .eq("video_id", videoId);

    if (error || !videoTags) {
      console.error(error?.message || "Error fetching video tags");
      return [];
    }

    const tagIds = videoTags.map((videoTag) => videoTag.tag_id);
    const {data: tags, error: tagError} = await supabase
      .from("tags")
      .select("*")
      .in("id", tagIds);

    if (tagError || !tags) {
      console.error(tagError?.message || "Error fetching tags");
      return [];
    }

    return tags;
  };

  useEffect(() => {
    (async () => {
      const videoTagsPromises = videos.map(async (video) => {
        const tags = await fetchTagsForVideo(video.id);
        return {videoId: video.id, tags};
      });

      const videoTagsData = await Promise.all(videoTagsPromises);
      const videoTagsMap: Record<number, any> = {};
      videoTagsData.forEach(({videoId, tags}) => {
        videoTagsMap[videoId] = tags;
      });

      setVideoTags(videoTagsMap);
    })();
  }, [videos]);


  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newVideoSortOrder, setNewVideoSortOrder] = useState<number | null>(null);
  const [newVideoRating, setNewVideoRating] = useState<number | null>(null);
  const [newThumbnailUrls, setNewThumbnailUrls] = useState<string[]>([]);
  const [newTags, setNewTags] = useState<string[]>([]);
  const [thumbnailsPreview, setThumbnailsPreview] = useState<string[]>([]);

  const addVideo = async () => {
    if (newVideoTitle.length && newVideoUrl.length) {
      const {data: videoData, error: videoError} = await supabase
        .from('videos')
        .insert([
          {
            title: newVideoTitle,
            video_url: newVideoUrl,
            sort_order: newVideoSortOrder || 0,
            rating: newVideoRating,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ])
        .select();

      if (videoError) {
        console.error('Error adding new video:', videoError);
      } else if (videoData) {
        const videoId = videoData[0].id;

        // タグを追加
        await supabase.from('tags').insert(
          newTags.map((tag) => (
            createTagAndVideoTag(tag, videoId)
          ))
        );

        // upload thumbnails
        const updatedThumbnailUrls = await uploadThumbnails(videoId);

        // サムネイルの関連を追加
        console.log("updatedThumbnailUrls", updatedThumbnailUrls)
        await supabase.from('thumbnails').insert(
          updatedThumbnailUrls.map((url) => ({
            video_id: videoId,
            thumbnail_path: url,
          }))
        );

        setNewVideoTitle('');
        setNewVideoUrl('');
        setNewVideoSortOrder(null);
        setNewVideoRating(null);
        setNewTags([]);
        fetchVideos();
        setNewThumbnailUrls([]);
        setThumbnailsPreview([]);
      }
    }
  };

  async function createTagAndVideoTag(tagName: string, videoId: number) {
    // 既存のタグを検索
    const {data: existingTagData, error: existingTagError} = await supabase
      .from("tags")
      .select("id")
      .eq("name", tagName)
    if (existingTagError) {
      console.error("Error searching for tag:", existingTagError);
      return;
    }

    let tagId;

    if (existingTagData.length > 0) {
      // 既存のタグが見つかった場合
      console.log("Tag already exists:", tagName);
      tagId = existingTagData[0].id;
    } else {
      // タグが存在しない場合、新しいタグを作成
      console.log("Creating new tag:", tagName)
      const {data: newTagData, error: newTagError} = await supabase
        .from("tags")
        .insert([{name: tagName}])
        .select();

      if (newTagError) {
        console.error("Error creating tag:", newTagError);
        return;
      }
      tagId = newTagData[0].id;
    }

    // video_tagsテーブルを更新
    const {error: videoTagError} = await supabase
      .from("video_tags")
      .insert([{video_id: videoId, tag_id: tagId}]);

    if (videoTagError) {
      console.error("Error creating video_tag relation:", videoTagError);
    }
  }

  const updateVideoTitle = async (id: number, title: string) => {
    const {data, error} = await supabase.from('videos').update({title}).eq('id', id);
    if (error) console.error('Error updating video title:', error);
    else fetchVideos();
  };

  async function deleteVideo(id: number) {
    // Confirm the deletion with the user
    if (!window.confirm('本当にこの動画を削除してもよろしいですか？')) {
      return;
    }

    // Delete related video_tags records
    const {error: deleteVideoTagsError} = await supabase
      .from('video_tags')
      .delete()
      .match({video_id: id});

    if (deleteVideoTagsError) {
      console.error('Error deleting video_tags:', deleteVideoTagsError.message);
      return;
    }

    // Delete related thumbnails Storage
    // フォルダーを直接消せないので中身のファイルを消すために一旦全ファイル名を取得してから消す
    const {data: thumbnails, error: thumbnailsError} = await supabase
      .storage
      .from("thumbnails")
      .list(`private/thumbnails/${id}`);
    if (thumbnailsError) {
      console.error("Failed to fetch thumbnails:", thumbnailsError);
      return;
    }
    console.log("thumbnails:", thumbnails)
    for (const thumbnail of thumbnails) {
      const {error: deleteThumbnailError} = await supabase
        .storage
        .from("thumbnails")
        .remove([`private/thumbnails/${id}/${thumbnail.name}`]);
      if (deleteThumbnailError) {
        console.error("Failed to delete thumbnail:", deleteThumbnailError);
        return;
      }
    }
    const {data: deletedThumbnails, error: deleteThumbnailsError} = await supabase
      .storage
      .from("thumbnails")
      .remove([`private/thumbnails/${id}/*`]);

    if (deleteThumbnailsError) {
      console.error("Failed to delete thumbnails:", deleteThumbnailsError);
      return;
    }

    // Delete related thumbnails records
    const {error: deleteThumbnailsRecordError} = await supabase
      .from("thumbnails")
      .delete()
      .match({video_id: id});

    if (deleteThumbnailsRecordError) {
      console.error("Failed to delete thumbnails record:", deleteThumbnailsRecordError);
      return;
    }

    // Delete the video record
    const {error: deleteVideoError} = await supabase
      .from('videos')
      .delete()
      .match({id});

    if (deleteVideoError) {
      console.error('Error deleting video:', deleteVideoError.message);
    } else {
      fetchVideos();
    }
  }

  function handleThumbnailUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }

    const files = Array.from(event.target.files);
    const thumbnailsPreview = files.map((file) => URL.createObjectURL(file));
    setThumbnailsPreview(thumbnailsPreview);
  }

  async function uploadThumbnails(videoId: number): Promise<string[]> {
    return new Promise(async (resolve) => {
      const thumbnailInput = thumbnailInputRef.current;
      if (!thumbnailInput || !thumbnailInput.files || thumbnailInput.files.length === 0) {
        return;
      }

      const files = Array.from(thumbnailInput.files);

      for (const file of files) {
        const filePath = `private/thumbnails/${videoId}/${file.name}`;

        // Get the access token for the logged-in user
        const {data: authSession} = await supabase.auth.getSession();
        const accessToken = authSession?.session?.access_token;
        if (!accessToken) {
          console.error("User must be logged in to upload files.");
          return;
        }

        try {
          // Upload the file
          const {data, error: uploadError} = await supabase.storage.from("thumbnails").upload(filePath, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false,
          });
          console.log("File uploaded:", data);
          console.log("file path:", filePath);
          setNewThumbnailUrls((prevUrls) => {
            const updatedUrls = [...prevUrls, filePath];
            resolve(updatedUrls); // Promiseを解決
            return updatedUrls;
          });
        } catch (error) {
          console.error("Failed to upload file:", error);
        }
      }
    });
  }

  if (!session) {
    return (<Auth supabaseClient={supabase} appearance={{theme: ThemeSupa}} />)
  }
  else {
    return (
      <div className="container mx-auto px-4">
        <div className="bg-gray-100 p-8">
          <h2 className="text-2xl font-semibold mb-4">動画を追加</h2>
          <div className="flex flex-col space-y-4">
            <input
              type="text"
              placeholder="動画タイトル"
              value={newVideoTitle}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewVideoTitle(e.target.value)}
              className="border border-gray-300 p-2 rounded"
            />
            <input
              type="text"
              placeholder="動画URL"
              value={newVideoUrl}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewVideoUrl(e.target.value)}
              className="border border-gray-300 p-2 rounded"
            />
            <input
              type="number"
              placeholder="ソート順"
              value={newVideoSortOrder || ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewVideoSortOrder(Number(e.target.value))}
              className="border border-gray-300 p-2 rounded"
            />
            <input
              type="number"
              step="0.1"
              min="0"
              max="5"
              placeholder="評価 (0.0 - 5.0)"
              value={newVideoRating || ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewVideoRating(Number(e.target.value))}
              className="border border-gray-300 p-2 rounded"
            />
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleThumbnailUpload}
              style={{display: 'none'}}
              ref={thumbnailInputRef}
            />
            <button onClick={() => thumbnailInputRef.current?.click()} className="bg-blue-500 text-white py-2 px-4 rounded">
              サムネイルを選択
            </button>
            {
              thumbnailsPreview.map((thumbnail, index) => (
                <img
                  key={index}
                  src={thumbnail}
                  alt={`Thumbnail Preview ${index}`}
                  className="w-20 h-20 mr-2 mb-2"
                />
              ))
            }
            <input
              type="text"
              placeholder="タグ (複数の場合はカンマ区切り)"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setNewTags(e.target.value.split(',').map((tag) => tag.trim()))
              }
              value={newTags.join(', ')}
              className="border border-gray-300 p-2 rounded"
            />
            <button onClick={addVideo} className="bg-green-500 text-white py-2 px-4 rounded">
              追加
            </button>
          </div>
        </div>
        <h1 className="text-4xl font-bold mb-4">動画一覧</h1>
        <ul>
          {videos.map((video) => (
            <li key={video.id} className="mb-8">
              <a
                href={video.video_url}
                className="text-2xl font-semibold text-blue-500 hover:text-blue-700"
              >
                {video.title}
              </a>
              <div className="flex items-center">
                <ReactStars
                  count={5}
                  value={video.rating || 0}
                  size={24}
                  isHalf={true}
                  edit={false}
                  activeColor="#ffd700"
                  className="mr-4"
                />
                {videoTags[video.id] &&
                  videoTags[video.id].map((tag) => (
                    <span
                      key={tag.id}
                      className="bg-gray-200 text-gray-700 rounded px-2 py-1 text-sm mr-2"
                    >
                      {tag.name}
                    </span>
                  ))}
              </div>
              <div className="flex space-x-2 mt-2">
                {video.thumbnails.slice(0, 3).map((thumbnail, index) => (
                  <img
                    key={index}
                    src={thumbnail.signed_url}
                    alt={`サムネイル ${index + 1}`}
                    className="w-20 h-20 object-cover rounded"
                  />
                ))}
              </div>
              <button
                onClick={() => deleteVideo(video.id)}
                className="text-white bg-red-500 px-4 py-2 rounded mt-2"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </div >
    );
  }
}
