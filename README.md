# The Foundry

The Foundry is a local Vite + React asset tool backed by an Express API and an optional Electron desktop shell. It is built for experimenting with image generation, character sheets, texture workflows, VFX texture/recipe output, UV tooling, and visual asset iteration.

This project is still early and very much open to improvement. If you try it, break it, fix it, or have ideas for making the workflows smoother, contributions are welcome.

## Screenshots

![The Foundry workspace overview](assets/screenshots/foundry-overview.jpg)

![Texture Lab controls and output workspace](assets/screenshots/texture-lab-workflow.jpg)

![Texture Lab expansion input and output slot](assets/screenshots/texture-lab-expansion.jpg)

## Current Status

The main generation flows work, but a few areas need extra attention:

- The 3D viewer still needs work before that workflow feels reliable and polished.
- The Visualizer tab has not been thoroughly checked yet.
- Drag and drop works, but the implementation is not as clean or smooth as it should be.

## Requirements

- Node.js
- npm
- A Gemini API key for Gemini-backed generation
- Optional OpenAI credentials for OpenAI-backed image generation and telemetry

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
copy .env.example .env
```

Then fill in the keys you want to use:

```text
GEMINI_API_KEY=
GEMINI_FLASH_MODEL=gemini-3.1-flash-image
GEMINI_FLASH_LITE_MODEL=gemini-3.1-flash-lite-image
GEMINI_PRO_MODEL=gemini-3-pro-image
OPENAI_API_KEY=
OPENAI_ADMIN_KEY=
OPENAI_ORGANIZATION_ID=
OPENAI_PROJECT_ID=
OPENAI_IMAGE_MODEL=gpt-image-2
```

The default image lineup uses OpenAI GPT Image 2 plus Gemini 3.1 Flash Image,
Gemini 3.1 Flash Lite Image, and Gemini 3 Pro Image. The optional model variables
above can pin different provider model IDs when needed.

`.env` is intentionally ignored by git. Do not commit real API keys, auth tokens, signing certificates, local usage logs, or generated release builds.

## Development

Run the client and API server together:

```bash
npm run dev
```

If you want both processes in the current shell:

```bash
npm run dev:inline
```

## Desktop App

Launch the Electron desktop shell locally:

```bash
npm run desktop
```

This builds the frontend and opens The Foundry in a native desktop window with the Express API embedded inside the app process. The app icon is generated from `assets/branding/the-foundry-icon.jpg`.

You can also use the browser-app launcher:

```bash
npm run app
```

On Windows, a shortcut can point at:

```text
scripts\launch-desktop-hidden.vbs
```

That launcher will build the frontend if needed, start the local production server on `http://127.0.0.1:3001`, open the UI in an Edge/Chrome/Brave app window when available, and fall back to the default browser otherwise.

To force a specific browser executable, set `FOUNDRY_DESKTOP_BROWSER` before launch.

## Build A Portable EXE

Build a portable Windows executable with:

```bash
npm run build:exe
```

The packaged app is written to:

```text
release\
```

The executable looks for a `.env` file in these places, in this order:

- the project root during local development
- the packaged app resources directory
- the same folder as the built `.exe`

For distribution, copy `.env.example` to `.env` next to the packaged `.exe` and fill in your own keys. For cheaper OpenAI character-sheet runs, the default values in `.env.example` keep `OPENAI_CHARACTER_SHEET_QUALITY=low` and `OPENAI_CHARACTER_SHEET_REFERENCE_MAX_EDGE_PX=1024`.

## Windows Signing

The packaging flow is ready for standard Electron Builder code signing.

If you have a Windows code-signing certificate, set these environment variables before running `npm run build:exe`:

```text
WIN_CSC_LINK=path-or-base64-to-your-pfx
WIN_CSC_KEY_PASSWORD=your-pfx-password
```

Optional:

```text
REQUIRE_WINDOWS_SIGNING=true
```

With `REQUIRE_WINDOWS_SIGNING=true`, the build will fail instead of silently producing an unsigned executable. Without a signing certificate, Windows SmartScreen may warn when the `.exe` is opened on other machines.

## Commands

```bash
npm run build
npm run test
npm run lint
```

## Contributing

Issues and pull requests are welcome. The best places to help right now are Texture Lab, the 3D viewer, the Visualizer tab, drag-and-drop polish, tests around rough workflows, and clearer setup documentation.


### Texture Lab expansion and editing

Texture Lab offers creative provider editing or local faithful patch synthesis, 1.5×/2×/4× expansion, directional placement, 512/1024 PNG exports, and 1–4 sequential variants. Preserve-original protects the source **after proportional scaling**; Blend allows changes only in its displayed boundary band. The 4× option uses two stages. Seamless adds a localized wrap-offset finishing pass; it does not guarantee that distinctive internal marks disappear in a tiled view.

Use the candidate selector to choose what is previewed and exported. Drag a rectangle in the 1× preview (or use the accessible corner selection and coordinate fields) to regenerate a region. Green outlines the protected interior. The 3×3 and 5×5 previews use browser background tiling without allocating oversized images. Stop takes effect after the active operation; Resume retries only the failed/interrupted operation and then continues queued work. Completed candidates survive failures. Finishing failures retain an explicitly unfinished candidate with Retry Finish.

Creative requests currently generate at 1024×1024 and are explicitly resized to the chosen export size before protected compositing. Native masks are enabled only for the verified GPT Image 2 edit endpoint; other selected providers use reference guidance and deterministic compositing. Mask semantics were verified against https://developers.openai.com/api/reference/python/resources/images/methods/edit on 2026-11-11. Provider dimensions are validated; unexpected sizes are reported rather than cropped. Local synthesis requires no provider key and uses no GPU model. Settings persist, while editing checkpoints and original images remain session-local.

#### Repeatable comparison

Run `npm run compare:textures` first: it processes one synthetic stone fixture with two local variants and spends no credits. `npm run compare:textures -- --all` checks stone, dirt, wood, cloth, and brick. Synthetic fixtures exercise algorithms; use `--fixtures <directory>` with those PNG filenames for real visual evaluation. `--fixture <name>` supports individual failing examples. Import original-pipeline outputs with `--baselines <directory>` using names such as `stone-baseline-1.png` and `stone-baseline-2.png`; missing baselines stay marked missing.

Results, timings, memory samples, metadata, editable visual review fields, and a 1×/tiled HTML gallery are written under `.codex-logs/texture-lab-comparison`. For a single live creative comparison against a running Foundry server, explicitly add `--live --max-calls 4`; this permits exactly two expansion-plus-finish variants, without retries. Use `--url` and `--model` to select the server/model. A configured internal token can be supplied as `FOUNDRY_INTERNAL_TOKEN`. No live batch starts by default. Usage is recorded when available; unknown provider cost stays null. Real failed examples, original baseline images, and human quality review are required before claiming improved appearance.


Initial offline review (2026-11-11): ten seeded local outputs completed across the five synthetic materials. Dirt retained a consistent granular appearance; wood and cloth retained overall direction but showed join/phase artifacts. Large stone cracks and brick courses fragmented outside the protected source, and the preserved source footprint remained recognizable in tiled views. Faithful synthesis is therefore unsuitable for assuming structural continuation on those examples. These observations are not a baseline comparison or a live creative-provider assessment. Use creative expansion for evaluation of newly invented larger features; its visual quality still needs real-texture testing.
