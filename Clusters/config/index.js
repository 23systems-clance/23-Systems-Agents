/**
 * Next.js config wrapper for 23wf.
 * Enables instrumentation hook for cron scheduling on server start.
 *
 * Usage in user's next.config.mjs:
 *   import { with23WF } from '23wf/config';
 *   export default with23WF({});
 *
 * @param {Object} nextConfig - User's Next.js config
 * @returns {Object} Enhanced Next.js config
 */
export function with23WF(nextConfig = {}) {
  return {
    ...nextConfig,
    distDir: process.env.NEXT_BUILD_DIR || '.next',
    transpilePackages: [
      '23wf',
      ...(nextConfig.transpilePackages || []),
    ],
    env: {
      ...nextConfig.env,
      NEXT_PUBLIC_CODE_WORKSPACE: process.env.CLAUDE_CODE_OAUTH_TOKEN && process.env.BETA ? 'true' : '',
    },
    serverExternalPackages: [
      ...(nextConfig.serverExternalPackages || []),
      'better-sqlite3',
      'drizzle-orm',
    ],
  };
}
