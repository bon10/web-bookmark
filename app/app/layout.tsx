import '@/styles/globals.css';
import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {THEME_BOOTSTRAP_SCRIPT} from '@/utils/theme';

export const metadata: Metadata = {
  title: 'Webサイトブックマーク',
  description: '評価とタグで束ねる、個人用のブックマーク書架。',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    // data-theme は下のスクリプトがハイドレーション前に書き込むため、
    // サーバー出力との差分は警告させない。
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: THEME_BOOTSTRAP_SCRIPT}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
