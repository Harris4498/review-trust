import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '리뷰체크 — 네이버 플레이스 리뷰 신뢰도 분석',
  description: 'AI가 네이버 플레이스 리뷰를 분석해 가짜 리뷰 의심 정황과 신뢰 신호를 찾아드립니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col bg-[#F5F5F5]">{children}</body>
    </html>
  );
}
