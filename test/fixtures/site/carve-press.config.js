export default {
  title: 'Fixture',
  srcDir: '.',
  outDir: process.env.CP_OUT_DIR ?? 'dist',
  themeConfig: {
    sidebar: {
      '/': [
        {
          text: 'G',
          items: [
            { text: 'Home', link: '/' },
            { text: 'Start', link: '/start' },
          ],
        },
      ],
    },
  },
}
