import IORedis from 'ioredis';
import { config } from '../config/index.js';

const MAX_RETRIES = 10;

/**
 * Creates a singleton IORedis client with exponential backoff reconnect strategy.
 */
const redis = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null, // Required by BullMQ
  retryStrategy(times: number): number | null {
    if (times > MAX_RETRIES) {
      console.log(
        JSON.stringify({
          level: 'error',
          message: `Redis max retries (${MAX_RETRIES}) exceeded. Giving up.`,
          timestamp: new Date().toISOString(),
          retryCount: times,
        }),
      );
      return null; // Stop reconnecting
    }

    const delay = Math.min(times * 200, 5000); // Exponential backoff, cap at 5s
    console.log(
      JSON.stringify({
        level: 'warn',
        message: `Redis reconnecting in ${delay}ms`,
        timestamp: new Date().toISOString(),
        retryCount: times,
        delayMs: delay,
      }),
    );
    return delay;
  },
});

redis.on('connect', () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Redis connected',
      timestamp: new Date().toISOString(),
    }),
  );
});

redis.on('error', (err: Error) => {
  console.log(
    JSON.stringify({
      level: 'error',
      message: 'Redis connection error',
      timestamp: new Date().toISOString(),
      error: err.message,
    }),
  );
});

export { redis };
export default redis;
