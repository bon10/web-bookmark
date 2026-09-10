'use client';

import {useEffect, useState, useTransition} from 'react';
import Image from 'next/image';
import ReactPaginate from 'react-paginate';
import StarRating from '@/components/StarRating';
import {deleteVideo} from '@/app/actions';

export type VideoListItem = {
  id: number;
  title: string | null;
  videoUrl: string;
  rating: number | null;
  tags: {id: number; name: string}[];
  thumbnails: {id: number; url: string}[];
};

const VIDEOS_PER_PAGE = 30;

export default function VideoTable({videos}: {videos: VideoListItem[]}) {
  const [currentPage, setCurrentPage] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  const pageCount = Math.ceil(videos.length / VIDEOS_PER_PAGE);
  const currentVideos = videos.slice(
    currentPage * VIDEOS_PER_PAGE,
    (currentPage + 1) * VIDEOS_PER_PAGE,
  );

  // ページを移動したら先頭まで戻す。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPage]);

  function handleDelete(videoId: number) {
    if (!window.confirm('本当にこのブックマークを削除してもよろしいですか？')) {
      return;
    }
    startDeleting(async () => {
      const result = await deleteVideo(videoId);
      setErrorMessage(result.error);
    });
  }

  return (
    <>
      {errorMessage && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {errorMessage}
        </p>
      )}
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">タイトル</th>
            <th className="min-w-[150px] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">評価</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">タグ</th>
            <th className="min-w-[300px] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">サムネイル</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {currentVideos.map((video) => (
            <tr key={video.id}>
              <td className="whitespace-normal px-6 py-4">
                <span className="text-sm text-gray-500">{video.id}</span>
              </td>
              <td className="whitespace-normal px-6 py-4">
                <a href={video.videoUrl} className="text-l font-semibold text-blue-500">
                  {video.title}
                </a>
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <StarRating value={video.rating ?? 0} size={12} />
                <span className="ml-4 text-sm text-gray-500">({video.rating?.toFixed(1) ?? 0})</span>
              </td>
              <td className="whitespace-normal px-6 py-4">
                {video.tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="mb-1 mr-2 inline-block whitespace-nowrap rounded bg-gray-200 px-2 py-1 text-sm text-gray-700"
                  >
                    {tag.name}
                  </div>
                ))}
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <div className="mt-2 flex space-x-2">
                  {video.thumbnails.map((thumbnail, index) => (
                    <Image
                      key={thumbnail.id}
                      src={thumbnail.url}
                      alt={`サムネイル ${index + 1}`}
                      className="h-20 w-20 rounded object-cover"
                      width={80}
                      height={80}
                    />
                  ))}
                </div>
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <button
                  onClick={() => handleDelete(video.id)}
                  disabled={isDeleting}
                  className="rounded bg-red-500 px-4 py-2 text-white disabled:opacity-50"
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReactPaginate
        previousLabel={'← 前'}
        nextLabel={'次 →'}
        breakLabel={'...'}
        breakClassName={'break-me'}
        pageCount={pageCount}
        marginPagesDisplayed={2}
        pageRangeDisplayed={5}
        onPageChange={({selected}) => setCurrentPage(selected)}
        containerClassName={'pagination'}
        activeClassName={'active'}
        pageClassName={'page'}
        previousClassName={'previous'}
        nextClassName={'next'}
        pageLinkClassName={'page-link'}
        previousLinkClassName={'previous-link'}
        nextLinkClassName={'next-link'}
        disabledClassName={'disabled'}
        activeLinkClassName={'active-link'}
        forcePage={currentPage}
      />
    </>
  );
}
