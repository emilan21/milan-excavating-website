import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const production = process.env.BUILD_ENV === 'production';
const config = {
  apiBaseUrl: process.env.PUBLIC_API_BASE_URL || 'http://localhost:8787',
  spacetimeUri: process.env.SPACETIMEDB_URI || 'ws://localhost:3000',
  spacetimeDatabase: process.env.SPACETIMEDB_DATABASE || 'milan-excavating-local',
  spacetimeAuthAuthority: process.env.SPACETIMEAUTH_AUTHORITY || 'https://auth.spacetimedb.com/oidc',
  spacetimeAuthClientId: process.env.SPACETIMEAUTH_CLIENT_ID || '',
};

if (production) {
  const required = ['PUBLIC_API_BASE_URL', 'SPACETIMEDB_URI', 'SPACETIMEDB_DATABASE', 'SPACETIMEAUTH_CLIENT_ID'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing production client configuration: ${missing.join(', ')}`);
}

await mkdir('frontend/js', { recursive: true });
await writeFile(
  'frontend/js/runtime-config.js',
  `window.MILAN_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`,
  'utf8',
);

await Promise.all([
  build({ entryPoints: ['src/public.ts'], bundle: true, minify: true, format: 'iife', outfile: 'frontend/js/site.js', target: 'es2022' }),
  build({ entryPoints: ['src/admin.ts'], bundle: true, minify: true, format: 'iife', outfile: 'frontend/js/admin.js', target: 'es2022' }),
]);
