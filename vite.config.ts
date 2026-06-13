import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  // Served from https://hoangdinhcong.github.io/Orrery/ on GitHub Pages.
  base: '/Orrery/',
  plugins: [react(), tailwindcss()],
});
