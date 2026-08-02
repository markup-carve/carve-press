import { defineConfig, llmsTxt, pageLayout, sitemap } from './dist/index.js'

export default defineConfig({
  title: 'CarvePress',
  description:
    'A static documentation generator for Carve markup with build-time validation and zero client framework output.',
  hostname: 'https://markup-carve.github.io',
  base: '/carve-press/',
  srcDir: 'docs',
  outDir: '.site',
  publicDir: 'docs/public',
  srcExclude: ['snippets/**'],
  theme: {
    extraCss: ['docs/public/site.css'],
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'Compare', link: '/comparison' },
      { text: 'Blog', link: '/blog/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Writing Content', link: '/guide/writing-content' },
            { text: 'Code Blocks', link: '/guide/code-blocks' },
            { text: 'Carve Syntax', link: '/guide/carve-syntax' },
            { text: 'Playground', link: '/guide/playground' },
            { text: 'Theme', link: '/guide/theme' },
            { text: 'Internationalization', link: '/guide/i18n' },
            { text: 'Blog', link: '/guide/blog' },
            { text: 'Deploying', link: '/guide/deploying' },
            { text: 'Extensions', link: '/guide/extensions' },
          ],
        },
        {
          text: 'Reference',
          collapsed: true,
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Config', link: '/reference/config' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Config', link: '/reference/config' },
          ],
        },
        {
          text: 'Guide',
          collapsed: true,
          items: [{ text: 'Configuration', link: '/guide/configuration' }],
        },
      ],
      '/blog/': [
        {
          text: 'Blog',
          generate: '/blog/',
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/markup-carve/carve-press' }],
    editLink: {
      pattern: 'https://github.com/markup-carve/carve-press/edit/main/docs/:path',
      text: 'Edit this page',
    },
    footer: {
      message: 'Built by CarvePress from Carve source.',
      copyright: 'Released under the MIT License.',
    },
    lastUpdated: true,
    outline: { level: [2, 4] },
  },
  blog: {
    dir: 'blog',
    route: '/blog/',
    title: 'CarvePress Blog',
    description: 'Release notes and notes on building docs with Carve.',
    perPage: 10,
    tagsRoute: '/blog/tags/',
  },
  feed: {
    filename: 'feed.xml',
    title: 'CarvePress Blog',
    description: 'Updates from the CarvePress project.',
    type: 'rss',
  },
  redirects: {
    '/old-guide/': '/guide/getting-started',
  },
  extensions: [
    sitemap({ hostname: 'https://markup-carve.github.io' }),
    llmsTxt({
      title: 'CarvePress',
      summary:
        'CarvePress documentation, generated from Carve source by CarvePress itself.',
    }),
  ],
  locales: {
    '/': { lang: 'en-US', label: 'English' },
    '/de/': {
      lang: 'de-DE',
      label: 'Deutsch',
      title: 'CarvePress',
      description: 'Ein statischer Dokumentationsgenerator fuer Carve.',
      themeConfig: {
        nav: [
          { text: 'Start', link: '/de/' },
          { text: 'Guide', link: '/guide/getting-started' },
        ],
        labels: {
          search: 'Suchen',
          onThisPage: 'Auf dieser Seite',
        },
      },
    },
  },
  layouts: {
    comparison: (ctx) => pageLayout(ctx),
  },
})
