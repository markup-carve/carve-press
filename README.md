# CarvePress

CarvePress is a static site generator for the [Carve](https://github.com/markup-carve/carve) markup language: it discovers `.crv` pages, renders them through carve-js with a Shiki-highlighting extension stack, resolves navigation and outline, validates links, and writes a static site to `dist/`.

## Install

```sh
npm install --save-dev @markup-carve/carve-press
```

## CLI

| Command | Job |
|---|---|
| `carve-press init` | scaffold a project |
| `carve-press dev` | watch, serve, and live-reload during development |
| `carve-press build` | static build into `dist/` |
| `carve-press serve` | serve a built site |
