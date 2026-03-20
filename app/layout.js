import './globals.css';
import '../theme.css';
import { ThemeProvider, FeaturesProvider } from '23wf/chat';

export const metadata = {
  title: '23 Systems',
  description: '23 Systems AI Agent',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

const features = {
  codeWorkspace: true,
  clusterWorkspace: true,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <FeaturesProvider features={features}>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </FeaturesProvider>
      </body>
    </html>
  );
}
