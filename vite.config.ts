import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Le build produit un unique index.html autonome : il s'ouvre directement (file://),
// se dépose sur itch.io ou s'embarque dans Electron/Tauri sans serveur.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
  },
});
