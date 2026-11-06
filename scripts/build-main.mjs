// Ana süreç ve preload'u esbuild ile CommonJS olarak paketler.
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main/main.ts', preload: 'src/main/preload.ts' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  outdir: 'dist-electron',
  // native/worker kullanan paketler node_modules'tan yüklenir
  external: ['electron', 'tesseract.js', 'koffi', 'pngjs'],
  logLevel: 'info',
});
