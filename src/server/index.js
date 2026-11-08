import { pathToFileURL } from 'node:url';
import { loadConfig, ConfigError } from './config.js';
import { createApp } from './app.js';

/**
 * Load configuration, start the server and wire signal handlers.
 * @returns {Promise<ReturnType<typeof createApp>>}
 */
export async function main() {
  const config = loadConfig();
  const app = createApp(config);
  const { url } = await app.listen();
  console.info(`BricoHams listening on ${url} (TX ${config.tx.enabled ? 'ENABLED' : 'disabled'})`);
  const shutdown = () => app.close().finally(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof ConfigError ? err.message : `Startup failed: ${err.message}`);
    process.exit(1);
  });
}
