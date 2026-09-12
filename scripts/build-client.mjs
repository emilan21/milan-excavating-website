import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const config = { apiBaseUrl: process.env.LOCAL_API_BASE_URL || '' };

await mkdir('frontend/js', { recursive: true });
await writeFile('frontend/js/runtime-config.js', `window.MILAN_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`, 'utf8');

await Promise.all([
  build({ entryPoints: ['src/public.ts'], bundle: true, minify: true, format: 'iife', outfile: 'frontend/js/site.js', target: 'es2022' }),
  build({ entryPoints: ['src/admin.ts'], bundle: true, minify: true, format: 'iife', outfile: 'frontend/js/admin.js', target: 'es2022' }),
]);
