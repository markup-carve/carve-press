## [Unreleased]

### Added

- `substitutions` config: `|token|` placeholders in prose are replaced at render time, with optional bold, italic, or code formatting. Off unless configured, and never applied inside code.
- `themeConfig.versions`: an opt-in version switcher in the header plus a banner on builds that are not the current version.

- Dogfood documentation site authored in Carve under `docs/`.
- Root `carve-press.config.ts` for GitHub Pages output at `.site`.
- Blog collection, generated tags, RSS feed, sitemap, and `llms.txt`.
- Documentation pages covering setup, configuration, authoring, code blocks, Carve syntax, playground, theme, i18n, blog, deployment, extensions, CLI, config types, and comparison.
- GitHub Pages workflow that builds and tests pull requests, and deploys only pushes to `main` or manual runs.
- Public logo and site CSS overrides for the docs.
- Page `redirectFrom` frontmatter and route manifest rename detection.

### Changed

- The code block copy control is an icon that appears on hover or keyboard focus, so a label no longer covers the first line of code. It stays visible on touch devices, which have no hover.
- README now describes the implemented CLI, quick start, features, and docs site.
- npm scripts include `docs:build`, `docs:dev`, and `docs:serve`.

### Fixed

- The feed's channel link now carries the site base, so a project site's feed points at the site rather than at the domain root.
- Documentation output no longer collides with compiled TypeScript output because the docs build writes `.site`.
- `.site/` is ignored by Git.
