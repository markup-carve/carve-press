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
