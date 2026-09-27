import type { Metadata } from 'next';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';
export const metadata: Metadata = {
  title: 'CDTA-HoloMap · Albany bus map',
  description: 'See the latest reported locations of buses on your selected CDTA routes.',
  icons: { icon: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
