/** @type {import('@cloudflare/vite').Options} */
export default {
  build: {
    outdir: 'out',
    rollupOptions: {
      input: {
        main: './app/page.tsx',
      },
    },
  },
}