import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KaraokeText AI | Timed lyric workspace",
  description: "Transcribe songs, review lyric timing, and prepare synchronized subtitles.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
