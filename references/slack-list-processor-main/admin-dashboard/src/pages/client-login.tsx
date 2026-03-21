/**
 * Client Login page (T058).
 *
 * "Sign in with Slack" button that redirects to the OAuth flow.
 */

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function ClientLoginPage() {
  const handleLogin = () => {
    window.location.href = '/api/v1/client/auth/login';
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="w-[400px]">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Client Dashboard</CardTitle>
            <CardDescription>
              Sign in with your Slack workspace to manage enrichments, billing, and settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button size="lg" onClick={handleLogin} className="w-full">
              Sign in with Slack
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
