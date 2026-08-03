## [Unreleased]

### Added

- A skip link as the first tab stop on every page. Reaching the text previously took 23 tab stops through the header and sidebar.


- Locale-aware derived outputs: search records carry their locale and the client filters to the reader's, feeds are written per locale with each page linking its own, and sitemap entries carry `hreflang` alternates for translations that exist.
- A scale fixture in `test/perf` covering a 300-page full build and an incremental dev rebuild, asserting work done rather than wall-clock time.

- `robots.txt` is generated, advertising the sitemap when `hostname` is set. `robots: false` disables it, and a `robots.txt` in `publicDir` is never overwritten.

- `rewrites`: publish a page at a route that does not follow its source path, by exact path or directory pattern.
- `islands`: opt-in mount points hydrated by site-supplied ES modules, with `load`, `idle`, or `visible` strategies and the block's own content as the fallback. No client framework is bundled.

- Content-hashed asset filenames, so a deploy is never served from a stale cache. `assets: { hash: false }` restores the plain names.
- Prefix redirects: `'/old/*': '/new/*'` expands against the real route table, one stub per page, while `_redirects` keeps the splat.
- Sitemap entries carry `lastmod` when a page's last-updated time is known.

- `substitutions` config: `|token|` placeholders in prose are replaced at render time, with optional bold, italic, or code formatting. Off unless configured, and never applied inside code.
- `themeConfig.versions`: an opt-in version switcher in the header plus a banner on builds that are not the current version.

- Dogfood documentation site authored in Carve under `docs/`.
- Root `carve-press.config.ts` for GitHub Pages output at `.site`.
- Blog collection, generated tags, RSS feed, sitemap, and `llms.txt`.
- Documentation pages covering setup, configuration, authoring, code blocks, Carve syntax, playground, theme, i18n, blog, deployment, extensions, CLI, config types, and comparison.
- GitHub Pages workflow that builds and tests pull requests, and deploys only pushes to `main` or manual runs.
- Public logo and site CSS overrides for the docs.
- Page `redirectFrom` frontmatter and route manifest rename detection.
- Opt-in `dev.incremental` render reuse for the dev server, with rebuild logs reporting rendered and reused page counts.

### Changed

- The code block copy control is an icon that appears on hover or keyboard focus, so a label no longer covers the first line of code. It stays visible on touch devices, which have no hover.
- README now describes the implemented CLI, quick start, features, and docs site.
- npm scripts include `docs:build`, `docs:dev`, and `docs:serve`.

### Fixed

- Every page advertised a feed for its locale, but a locale with no posts had no feed written, so the link 404'd. Locale feeds are now always written.


- The mobile menu's links could not be tapped. The nav drawer is nested inside the header, which is a stacking context at mobile widths, so the drawer painted below the scrim however high its own z-index was: every tap landed on the scrim and closed the menu instead of following the link.

- Search indexes every page. Records existed only per heading, so a page written without an `##` produced none at all and could not be found, and prose above a page's first heading belonged to no record on any page. Each page now carries a record of its own alongside its sections, and results are deduplicated per page in the client.

- The feed's channel link now carries the site base, so a project site's feed points at the site rather than at the domain root.
- Documentation output no longer collides with compiled TypeScript output because the docs build writes `.site`.
- `.site/` is ignored by Git.
