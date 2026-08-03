# CarvePress

CarvePress is a static site generator for the [Carve](https://github.com/markup-carve/carve) markup language. It discovers `.crv` pages, expands includes, renders through carve-js with a Shiki extension stack, validates links and cross-references at build time, and writes static HTML.

The dogfood documentation site is built by CarvePress from `docs/` and is published at <https://markup-carve.github.io/carve-press/>.

## Install

```sh
npm install --save-dev @markup-carve/carve-press
```

## Quick Start

```sh
npx carve-press init
npx carve-press dev --open
npx carve-press build
```

Add pages under `docs/` using Carve syntax, then configure navigation and sidebar entries in `carve-press.config.ts`.

## CLI

| Command | Description |
| --- | --- |
| `carve-press build` | Build the static site. |
| `carve-press routes` | Print discovered routes and source files. |
| `carve-press dev [--open]` | Build, serve, watch, and live reload. |
| `carve-press serve` | Serve the existing output directory. |
| `carve-press init [--force]` | Scaffold a new site. |
| `carve-press new <path> [--title <title>]` | Create a new page under `srcDir`. |
| `carve-press help` | Print CLI help. |
| `carve-press --help` | Print CLI help. |
| `carve-press --version` | Print the package version. |

Common flags: `--root <dir>`, `--port <n>`, `--host <host>`, `--open`, `--force`, and `--title <title>`.

## Features

- Carve-native `.crv` content, including includes and cross-references.
- Static HTML output with no client framework required for navigation.
- Build-time validation for internal links, nav, sidebars, frontmatter prev/next links, and Carve lint findings.
- Shiki highlighting with Carve grammar, titles, copy buttons, line numbers, highlighted lines, notation transformers, and code groups.
- `::: compare` blocks for source/render demonstrations.
- `::: playground` blocks that ship the Carve engine to the browser only when used.
- Default theme with nav, path-keyed sidebars, outline, edit links, last-updated timestamps, social icons, locale switcher, and custom CSS hooks.
- Built-in site extensions for search index, blog, feed, redirects, sitemap, and `llms.txt`.

## Render Extension Presets

`carve.preset` controls CarvePress' built-in Carve engine extension stack. The default is `docs`.
`carve.extensions` is appended after the preset, so site-specific extensions can override earlier renderers.

| Preset | Engine factories |
| --- | --- |
| `minimal` | none of the optional Carve preset factories; CarvePress still adds Shiki, table scroll, compare, playground, code group, heading permalinks, and image defaults |
| `docs` | `tabs`, `details`, `mathBlock`, `externalLinks`, `tocPlacement`, `wikilinks` |
| `full` | all `docs` factories plus `headingNumbers`, `glossary`, `index`, `citations`, `codeCallouts`, `colorSwatch`, `spoiler`, `listTable`, `imgFence`, `defaultAttributes` |

`tableOfContents` is deliberately not in any preset: it injects a table of contents into every document, which duplicates the theme's outline column. Use a `::: toc` block on the pages that want one - that is what `tocPlacement` is for.

Executable or remote-content diagram factories such as `mermaid`, `d2`, `graphviz`, `wavedrom`, `abc`, `plantuml`, `vegaLite`, `chart`, and `fencedRender` are deliberately left out of every preset because they can require extra runtimes, execute renderers, or embed remote-capable content.

## `::: compare` renders live HTML

The `::: compare` admonition shows a Carve fence next to its rendered output. The "Rendered" pane injects the block's `html` fence *verbatim and unescaped* - by design, so the live view can never drift from the HTML shown beside it. This is the one place in the render pipeline where Carve's dangerous-attribute and URL-scheme filtering does not apply.

If a `html` fence contains a `<script>`, `<iframe>`, `<object>`, `<embed>`, an `on<event>=` attribute, or a `javascript:` URL, that markup executes live on the published page. CarvePress warns in the build log the first time each pattern is seen, but does not block the build.

Add `{.no-render}` to a `::: compare` block to suppress the live pane when a fence is meant to demonstrate raw or unsafe markup rather than execute it:

````
{.no-render}
::: compare
```carve
*bold*
```
```html
<script>alert(1)</script>
```
:::
````

## Documentation

Use the published docs for details: <https://markup-carve.github.io/carve-press/>.
