import { motion } from 'framer-motion';
import { ApolloCacheStatsCard } from '@/components/cache/ApolloCacheStatsCard';
import { ApolloCacheConfigPanel } from '@/components/cache/ApolloCacheConfigPanel';

export default function ApolloCachePage() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Apollo Cache</h2>
        <p className="text-sm text-muted-foreground">
          Monitor and manage Apollo people search and contact enrichment caches.
        </p>
      </div>

      <ApolloCacheStatsCard />
      <ApolloCacheConfigPanel />
    </motion.div>
  );
}
