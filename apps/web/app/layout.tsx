import './globals.css';
import { ReactNode } from 'react';
import { TopNav } from '@/components/TopNav';
import { ToastContainer } from '@/components/ToastContainer';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased bg-gray-50 text-gray-900">
        <TopNav />
        {children}
  <ToastContainer />
      </body>
    </html>
  );
}
