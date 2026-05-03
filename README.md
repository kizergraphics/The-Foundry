# The Foundry

The Foundry is a Vite + React frontend backed by a local Express server for image generation, texture tooling, and export workflows.

## Run Modes

### Desktop Window

Use this to launch the Electron desktop shell locally:

```bash
npm run desktop
```

This builds the frontend and opens The Foundry in a native desktop window with the Express API embedded inside the app process.
The app icon is generated from `assets/branding/the-foundry-icon.jpg`.

### Browser App Window

```bash
npm run app
```

This uses the lightweight browser-app launcher from before.

On Windows, you can still point a launcher or shortcut at:

```text
scripts\launch-desktop-hidden.vbs
```

That launcher will:

- build the frontend if `dist/index.html` is missing
- start the local production server on `http://127.0.0.1:3001`
- open the UI in an Edge/Chrome/Brave app window when available
- fall back to the default browser if no Chromium-based browser is found

If you want to force a specific browser executable, set `FOUNDRY_DESKTOP_BROWSER` before launch.

## Build An EXE

Build a portable Windows executable with:

```bash
npm run build:exe
```

The packaged app will be written to:

```text
release\
```

The executable looks for a `.env` file in these places, in this order:

- the project root during local development
- the packaged app resources directory
- the same folder as the built `.exe`

For distribution, copy `.env.example` to `.env` next to the packaged `.exe` and fill in `GEMINI_API_KEY`.
If you are using OpenAI image generation with a project-scoped key, also set `OPENAI_API_KEY` and, when needed, `OPENAI_PROJECT_ID` (plus `OPENAI_ORGANIZATION_ID` for legacy multi-org keys).
For cheaper OpenAI character-sheet runs, you can leave the new defaults in place: `OPENAI_CHARACTER_SHEET_QUALITY=low` and `OPENAI_CHARACTER_SHEET_REFERENCE_MAX_EDGE_PX=1024`.

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

With `REQUIRE_WINDOWS_SIGNING=true`, the build will fail instead of silently producing an unsigned executable.
Without a signing certificate, Windows SmartScreen may still warn when the `.exe` is opened on other machines.

### Development

```bash
npm run dev
```

This opens separate client and API terminals. If you want both processes in the current shell instead:

```bash
npm run dev:inline
```

## Other Commands

```bash
npm run build
npm run test
npm run lint
```
