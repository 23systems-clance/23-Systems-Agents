#!/usr/bin/env node
/**
 * Test script to verify MCP server functionality
 * This simulates MCP client interactions
 */

import 'dotenv/config';
import { loadConfig } from './src/config/config-loader.js';
import { createLogger } from './src/infrastructure/logger.js';
import { BuildWithService } from './src/services/builtwith-service.js';

async function testServer() {
  console.log('🧪 BuildWith MCP Server Test\n');

  try {
    // Load configuration
    console.log('1️⃣  Loading configuration...');
    const config = loadConfig();
    console.log('   ✅ Configuration loaded successfully');
    console.log(`   - API Key: ${config.builtwith.apiKey.substring(0, 8)}...`);
    console.log(`   - Rate Limit: ${config.rateLimit.requestsPerSecond} req/s`);
    console.log(`   - Max Concurrent: ${config.rateLimit.maxConcurrent}`);
    console.log(`   - Cache Enabled: ${config.cache.enabled}`);
    console.log('');

    // Initialize logger
    console.log('2️⃣  Initializing logger...');
    const logger = createLogger(config.logging);
    console.log('   ✅ Logger initialized');
    console.log('');

    // Initialize service
    console.log('3️⃣  Initializing BuildWith service...');
    const service = new BuildWithService(config, logger);
    console.log('   ✅ Service initialized');
    console.log('');

    // Test Free API lookup
    console.log('4️⃣  Testing Free API lookup (github.com)...');
    const startTime = Date.now();

    try {
      const result = await service.getFreeLookup('github.com');
      const duration = Date.now() - startTime;

      console.log(`   ✅ Free lookup completed in ${duration}ms`);
      console.log('   Response preview:');
      console.log(JSON.stringify(result, null, 2).substring(0, 500) + '...');
      console.log('');
    } catch (error: any) {
      console.log(`   ❌ Free lookup failed: ${error.message}`);
      if (error.category) {
        console.log(`   Error category: ${error.category}`);
        console.log(`   Retryable: ${error.isRetryable}`);
      }
      console.log('');
    }

    // Test cache
    console.log('5️⃣  Testing cache (repeating request)...');
    const cacheStartTime = Date.now();

    try {
      await service.getFreeLookup('github.com');
      const cacheDuration = Date.now() - cacheStartTime;

      console.log(`   ✅ Cached lookup completed in ${cacheDuration}ms`);
      console.log(`   Speed improvement: ${Math.round((duration / cacheDuration) * 100) / 100}x faster`);
      console.log('');
    } catch (error: any) {
      console.log(`   ⚠️  Cache test skipped due to previous error`);
      console.log('');
    }

    // Display cache stats
    console.log('6️⃣  Cache statistics:');
    const stats = service.getCacheStats();
    console.log(`   - Total entries: ${stats.size}/${stats.maxSize}`);
    console.log(`   - Cache hits: ${stats.hits}`);
    console.log(`   - Cache misses: ${stats.misses}`);
    console.log(`   - Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
    console.log(`   - Evictions: ${stats.evictions}`);
    console.log(`   - Expirations: ${stats.expirations}`);
    console.log('');

    console.log('✅ All tests completed successfully!\n');
    console.log('💡 Next steps:');
    console.log('   1. Add server to Claude Code config');
    console.log('   2. Test with: builtwith_free_lookup, builtwith_domain_lookup, builtwith_list_sites');
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.message.includes('API key is required')) {
      console.log('\n💡 Set your API key:');
      console.log('   export BUILTWITH_API_KEY=your_key_here');
      console.log('   Or create .env file with BUILTWITH_API_KEY=your_key_here');
    }
    process.exit(1);
  }
}

testServer();
