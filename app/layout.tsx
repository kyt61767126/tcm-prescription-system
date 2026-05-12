export const runtime = "edge";
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '中医处方系统',
  description: '云端中医处方管理系统',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}