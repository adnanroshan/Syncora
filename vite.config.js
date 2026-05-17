import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config — tuned for CodeOnTime drop-in deployment.
//
// `base: './'` makes the built assets relative-pathed so the bundle works no
// matter what URL prefix CodeOnTime serves it from (~/Content/syncora/, a
// subdirectory, a custom virtual path, etc.). Drop the contents of `dist/`
// into any folder on the server and it just works.
//
// `build.outDir` defaults to `dist`. We also inline assets under 8KB to
// reduce the file count you have to copy.

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 8192,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Predictable asset names — easier to reference from CodeOnTime if needed.
        entryFileNames: 'assets/syncora.[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
