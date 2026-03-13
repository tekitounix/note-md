# Third-Party Notices

This project (MIT License) includes or depends on the following third-party
software. Each component is distributed under its own license terms.

---

## Runtime dependencies (bundled in VSIX)

### markdown-it

- License: MIT
- Copyright: (c) 2014 Vitaly Puzrin, Alex Kocharin
- <https://github.com/markdown-it/markdown-it>

### argparse (dependency of markdown-it)

- License: Python-2.0
- Copyright: (c) 2001-2021 Python Software Foundation
- <https://github.com/nodeca/argparse>

### entities (dependency of markdown-it)

- License: BSD-2-Clause
- Copyright: (c) Felix Böhm
- <https://github.com/fb55/entities>

### linkify-it (dependency of markdown-it)

- License: MIT
- Copyright: (c) 2015 Vitaly Puzrin
- <https://github.com/markdown-it/linkify-it>

### mdurl (dependency of markdown-it)

- License: MIT
- Copyright: (c) 2015 Vitaly Puzrin
- <https://github.com/markdown-it/mdurl>

### punycode.js (dependency of markdown-it)

- License: MIT
- Copyright: (c) Mathias Bynens
- <https://github.com/mathiasbynens/punycode.js>

### uc.micro (dependency of markdown-it / linkify-it)

- License: MIT
- Copyright: (c) 2015 Vitaly Puzrin
- <https://github.com/markdown-it/uc.micro>

### Jimp

- License: MIT
- Copyright: (c) 2014 Hage Yaapa and contributors
- <https://github.com/jimp-dev/jimp>

Pure JavaScript image processing library used for raster format conversion
(WebP, BMP, TIFF → PNG). No native binaries required.

### @resvg/resvg-wasm

- License: MPL-2.0
- Copyright: (c) 2021 yisibl and contributors
- <https://github.com/nicolo-ribaudo/resvg-js>

WebAssembly build of resvg for SVG rasterization. No native binaries required.
The full text of the MPL-2.0 is available at
<https://www.mozilla.org/en-US/MPL/2.0/>.

---

## Webview CDN assets (loaded at runtime, not bundled)

The preview Webview loads the following assets from public CDNs. They are **not**
included in this extension package. Their licenses and terms are governed by
their respective upstream projects.

| Library | License | URL |
|---|---|---|
| Font Awesome (Free) | CC BY 4.0 / SIL OFL 1.1 / MIT | <https://fontawesome.com/license/free> |
| Highlight.js | BSD-3-Clause | <https://github.com/highlightjs/highlight.js> |
| KaTeX | MIT | <https://github.com/KaTeX/KaTeX> |
| Mermaid | MIT | <https://github.com/mermaid-js/mermaid> |

---

## Upload services

This extension can upload user-selected local images to third-party temporary
hosting services. Those services are not operated by this project. Their terms,
privacy practices, retention periods, and abuse processes are governed by each
service provider.
