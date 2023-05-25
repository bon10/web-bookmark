import {useState, useEffect, ChangeEvent, useRef, createRef} from 'react';
import {supabase} from '../utils/supabaseClient';
import {Video, Tag, Thumbnail} from '../utils/supabaseClient';
import ReactStars from 'react-rating-stars-component';
import {Auth} from '@supabase/auth-ui-react'
import {Session, Subscription} from '@supabase/supabase-js';
import {ThemeSupa} from '@supabase/auth-ui-shared';
import {uploadFileToS3, s3GetSignedUrl, deleteFromS3, s3ListObjectsInDirectory} from "@/utils/awsClient";
import Image from 'next/image'
import ReactPaginate from 'react-paginate';


export default function Home() {
  const bucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME || '';

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

  // 動画情報一覧を取得
  const [currentPage, setCurrentPage] = useState(0);
  const videosPerPage = 30;
  const pageCount = Math.ceil(videos.length / videosPerPage);
  const currentVideos = videos.slice(currentPage * videosPerPage, (currentPage + 1) * videosPerPage);

  function handlePageClick({selected: selectedPage}) {
    setCurrentPage(selectedPage);
  }

  useEffect(() => {
    // ページ遷移時にページトップにスクロールする
    window.scrollTo(0, 0);
  }, [currentPage]);

  useEffect(() => {
    setCurrentPage(0);  // データが変更されたら最初のページに戻す
  }, [videos]);

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
              const signedUrl = await s3GetSignedUrl(bucketName, thumbnail.thumbnail_path)
              return {...thumbnail, signed_url: signedUrl};
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
        await supabase.from('thumbnails').insert(
          updatedThumbnailUrls.map((url) => ({
            video_id: videoId,
            thumbnail_path: url,
          }))
        );

        console.log("Video added successfully!")
        setNewVideoTitle('');
        setNewVideoUrl('');
        setNewVideoSortOrder(null);
        setNewVideoRating(null);
        setNewTags([]);
        fetchVideos();
        setThumbnailsPreview([]);
        thumbnailInputRef.current!.value = ''; // 初期化
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
    const objectKeys = await s3ListObjectsInDirectory(bucketName, `thumbnails/${id}`);
    for (const objectKey of objectKeys) {
      await deleteFromS3(bucketName, objectKey);
    }
    // フォルダーを直接消せないので中身のファイルを消すために一旦全ファイル名を取得してから消す
    // const {data: thumbnails, error: thumbnailsError} = await supabase
    //   .storage
    //   .from("thumbnails")
    //   .list(`private/thumbnails/${id}`);
    // if (thumbnailsError) {
    //   console.error("Failed to fetch thumbnails:", thumbnailsError);
    //   return;
    // }
    // for (const thumbnail of thumbnails) {
    //   const {error: deleteThumbnailError} = await supabase
    //     .storage
    //     .from("thumbnails")
    //     .remove([`private/thumbnails/${id}/${thumbnail.name}`]);
    //   if (deleteThumbnailError) {
    //     console.error("Failed to delete thumbnail:", deleteThumbnailError);
    //     return;
    //   }
    // }

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

      // アップロードプロミスを作成
      const uploadPromises = files.map(async (file) => {
        const filePath = `thumbnails/${videoId}/${file.name}`;
        try {
          await uploadFileToS3(bucketName, filePath, file);
          console.log("Upload succeeded for", filePath);
          return filePath;
        } catch (error) {
          console.error("Failed to upload file:", error);
          return null;
        }
      });

      // 全てのプロミスが解決されたら、成功したファイルパスだけを返す
      const urls = await Promise.all(uploadPromises);
      resolve(urls.filter((url) => url !== null) as string[]);
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
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">タイトル</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[150px]">評価</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">タグ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[300px]">サムネイル</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {currentVideos.map((video) => (
              <tr key={video.id}>
                <td className="px-6 py-4 whitespace-normal">
                  <span className="text-sm text-gray-500">{video.id}</span>
                </td>
                <td className="px-6 py-4 whitespace-normal">
                  <a
                    href={video.video_url}
                    className="text-l font-semibold text-blue-500 hover:text-blue-500"
                  >
                    {video.title}
                  </a>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <ReactStars
                    count={5}
                    value={video.rating || 0}
                    size={12}
                    isHalf={true}
                    edit={false}
                    activeColor="#ffd700"
                    className="mr-4"
                  />
                  <span className="text-sm text-gray-500">({video.rating?.toFixed(1) || 0})</span>
                </td>
                <td className="px-6 py-4 whitespace-normal">
                  {videoTags[video.id] &&
                    videoTags[video.id].map((tag) => (
                      <div
                        key={tag.id}
                        className="bg-gray-200 text-gray-700 rounded px-2 py-1 text-sm mr-2 whitespace-nowrap mb-1 inline-block"
                      >
                        {tag.name}
                      </div>
                    ))}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex space-x-2 mt-2">
                    {video.thumbnails.map((thumbnail, index) => (
                      <Image
                        key={index}
                        src={thumbnail.signed_url}
                        alt={`サムネイル ${index + 1}`}
                        className="w-20 h-20 object-cover rounded"
                        width={80}
                        height={80}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => deleteVideo(video.id)}
                    className="text-white bg-red-500 px-4 py-2 rounded"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ReactPaginate
          previousLabel={"← 前"}
          nextLabel={"次 →"}
          breakLabel={"..."}
          breakClassName={"break-me"}
          pageCount={pageCount}
          marginPagesDisplayed={2}
          pageRangeDisplayed={5}
          onPageChange={handlePageClick}
          containerClassName={"pagination"}
          activeClassName={"active"}
          pageClassName={"page"}
          previousClassName={"previous"}
          nextClassName={"next"}
          pageLinkClassName={"page-link"}
          previousLinkClassName={"previous-link"}
          nextLinkClassName={"next-link"}
          disabledClassName={"disabled"}
          activeLinkClassName={"active-link"}
          forcePage={currentPage}
        />
      </div >
    );
  }
}
