# Third-party licenses

Vellum incorporates code and assets from the following projects. Ported files
carry a header comment pointing back to this document.

## ALLWEONE Presentation AI (MIT)

Source: https://github.com/allweonedev/presentation-ai
Ported portions: streaming XML slide parser (`src/lib/generation/parser/`),
layout catalog and generation prompts, theme system (`src/lib/themes/`,
`src/styles/presentation.css`), selected Plate custom elements and plugins
(`src/components/editor/custom-elements/`), chart rendering approach, and the
local-model wiring pattern.

```
MIT License

Copyright (c) 2024 ALLWEONE Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Presenton (Apache-2.0)

Source: https://github.com/presenton/presenton
Ported portions: ComfyUI provider logic (`src/lib/images/comfyui.ts`), SearXNG
integration (`src/lib/generation/research/searxng.ts`), schema-retry pattern
(`src/lib/generation/llm/schema-retry.ts`), icon search assets
(`assets/icons/`), and the late `slide_assets` SSE event pattern.
Licensed under the Apache License, Version 2.0:
https://www.apache.org/licenses/LICENSE-2.0
See also the `NOTICE` file in this repository.

## Phosphor Icons (MIT)

Source: https://phosphoricons.com — the SVG icon set under
`public/static/icons/` (1,512 icons × 6 weights).

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
