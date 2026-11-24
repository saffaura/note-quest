import { defineConfig } from 'vite';

// Relative asset paths let the built site work from any folder, including a GitHub Pages
// project site served at https://<user>.github.io/<repo>/.
export default defineConfig({
  base: './',
});
