# CarvePress

CarvePress is a static site generator for the [Carve](https://github.com/markup-carve/carve) markup language: it discovers `.crv` pages, renders them through carve-js with a Shiki-highlighting extension stack, resolves navigation and outline, validates links, and writes a static site to `dist/`.

## Install

```sh
npm install --save-dev @markup-carve/carve-press
```

## CLI

| Command | Job |
|---|---|
| `carve-press build` | static build into `dist/` |
| `carve-press routes` | print the resolved route table |

Planned, not yet implemented: `init`, `new`, `dev`, `serve`.

## Render Extension Presets

`carve.preset` controls CarvePress' built-in Carve engine extension stack. The default is `docs`.
`carve.extensions` is appended after the preset, so site-specific extensions can override earlier renderers.

| Preset | Engine factories |
|---|---|
| `minimal` | `codeGroup`, `headingPermalinks` |
| `docs` | `codeGroup`, `headingPermalinks`, `tabs`, `details`, `mathBlock`, `externalLinks`, `tableOfContents`, `tocPlacement`, `wikilinks` |
| `full` | all `docs` factories plus `headingNumbers`, `glossary`, `index`, `citations`, `codeCallouts`, `colorSwatch`, `spoiler`, `listTable`, `imgFence`, `defaultAttributes` |

CarvePress always adds its own Shiki, table-scroll, compare, playground, and image-default extensions around
those engine factories. Executable or remote-content diagram factories such as `mermaid`, `d2`, `graphviz`,
`wavedrom`, `abc`, `plantuml`, `vegaLite`, `chart`, and `fencedRender` are deliberately left out of every
preset because they can require extra runtimes, execute renderers, or embed remote-capable content.

## `::: compare` renders live HTML

The `::: compare` admonition shows a Carve fence next to its rendered output. The "Rendered" pane injects the block's `html` fence **verbatim and unescaped** - by design, so the live view can never drift from the HTML shown beside it. This is the one place in the render pipeline where Carve's dangerous-attribute and URL-scheme filtering does not apply.

If a `html` fence contains a `<script>`, `<iframe>`, `<object>`, `<embed>`, an `on<event>=` attribute, or a `javascript:` URL, that markup executes live on the published page. CarvePress warns in the build log the first time each pattern is seen, but does not block the build.

Add `{.no-render}` to a `::: compare` block to suppress the live pane (only the source and HTML-source panes render) when a fence is meant to demonstrate raw or unsafe markup rather than execute it:

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
