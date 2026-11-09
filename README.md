# Ignite Field Guide 2026

A Hugo-powered single-page session guide for startups and digital-native companies attending Microsoft Ignite 2026. Find **what to attend, why it matters, and in what learning order**—then build and share your own edition.

## Run locally

Requires **Hugo 0.159.1 or later**. Standard Hugo is sufficient; no theme, Node dependency installation, API keys, or backend is needed.

```sh
# macOS, if Hugo is not installed
brew install hugo

# From the project directory
hugo server --bind 127.0.0.1 --disableFastRender
```

Open **http://localhost:1313/**. Hugo watches the templates, styles, JavaScript, and editorial data. After replacing the root catalog JSON, restart the server to guarantee a fresh data build.

Optional npm aliases (Node.js 22+):

```sh
npm run dev
npm run build
npm test
```

`npm install` is not required: the project has no npm dependencies. Node is needed only for the test suite, not for Hugo itself.

## What's inside

- **Three clear starting points, visible at the top:** Startup, Digital Native, and Build your own & share. Each opens the relevant journey or editor directly.
- **Three built-in, six-session paths:** From idea to market; Build an AI-native product; Scale without the sprawl. Each stop explains its purpose and offers a concrete takeaway.
- **Full catalog:** search titles, descriptions, speakers, topics, and session codes; filter by topic, format, level, attendance, day, and learning path. Repeat occurrences stay grouped under one session.
- **Your own guide:** start from a built-in path or add individual sessions using the route button beside Save. Name the guide, explain its audience, reorder sessions, and add “why attend” notes.
- **Shareable snapshots:** create a permalink that opens the exact guide, including its order, notes, and session facts. Recipients can read it or explicitly edit a local copy.
- **Personal agenda:** save specific occurrences, see overlapping times, switch between Pacific, local, and UTC time, and export scheduled sessions to `.ics`.
- **Accessible, responsive UI:** keyboard-operable controls and dialogs, screen-reader status messages, reduced-motion support, and light/dark themes. Override the theme with `?scoutTheme=light` or `?scoutTheme=dark`.

The paths are **learning sequences, not conflict-free live itineraries**. Agenda saving is not event registration and does not reserve a seat.

## How sharing works on a static site

GitHub Pages serves only static files. The browser serializes a versioned guide snapshot, compresses it with the native Compression Streams API, and encodes it in a link:

```text
https://OWNER.github.io/REPOSITORY/?guide=1.ENCODED_SNAPSHOT#my-guide
```

No guide database or account is required. The URL itself carries the guide; a recipient does not need your browser's local storage. Stored session snapshots preserve the shared content even if the source catalog changes. Current listings can be opened separately; importing a shared guide into the agenda uses current catalog times.

**Important limits:**

- A guide supports up to **20 unique sessions**, with bounded titles and notes. Share links are limited to **7,500 characters**, including the site's base URL. Shorten notes or use fewer sessions if a guide exceeds that limit.
- Editing a draft does **not** update an existing shared link. Create a new link to share the new snapshot. Old links cannot be revoked centrally.
- Anyone with the URL can read its contents. Encoding is **not encryption**. Do not include private information. Query-string contents can appear in browser history, hosting logs, and messaging tools.
- Links remain usable while this site stays available at the same address and supports version 1. This is a self-contained snapshot link, not a short URL or permanent hosting guarantee.
- Creating and reading links requires a current browser with `CompressionStream` and `DecompressionStream` support. Clipboard access may require HTTPS; a selectable link is provided if copying is blocked.
- Drafts and agendas are stored only in this browser, on this origin. There is no cross-device sync. Export or copy a link before clearing browser data. Storage failures are shown in the UI.

Session text and custom notes are rendered as text, never executable HTML. Shared payloads are validated and decompressed with a bounded output size.

## Source data and curation

The source of truth is **`2026_ignite_session_catalog.json`** in the project root, selected by `params.catalogFile` in `hugo.toml`. The initial export contains 1,500 instances representing 1,343 unique sessions. All instances have titles and descriptions; 119 have no schedule and some have no speaker listing.

The earlier `ignite_sessions.json` is a speaker-profile export. It is ignored by Git, is not used by the app, and is not published by Hugo. Neither root JSON is copied verbatim to the website: Hugo emits a fingerprinted, normalized catalog containing only fields the app needs.

Update the guide by replacing the catalog with an export in the same schema. Keep stable `sessionId` and `sessionInstanceId` values. Required fields include the IDs, `sessionCode`, and `title`; descriptions, speaker names, times, locations, and taxonomy arrays use the source's native fields. `layouts/partials/catalog.html` performs normalization, strips description markup, and fails the build if a curated session code disappears.

Edit built-in paths in **`data/guide.json`**. Each path defines its intended audience, purpose, outcome, and ordered steps; each step references a real session code and provides an editorial reason and takeaway. These are independent recommendations, not official Microsoft endorsements. Avoid presenting a product-specific session as general-purpose advice.

Unscheduled sessions remain explicitly unscheduled and are excluded from calendar export. Online attendance and recording availability are displayed separately. Verify all session times, seat availability, and attendance details in the [official Ignite catalog](https://ignite.microsoft.com/en-US/sessions).

## Deploy to GitHub Pages

Repository: [Azure-Samples/ms-ignite-2026-session-guide](https://github.com/Azure-Samples/ms-ignite-2026-session-guide).

1. The workflow publishes from `main`; change `.github/workflows/pages.yml` if using a different production branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Use a feature branch and pull request for changes. Merge into `main` to publish, or run the workflow manually on `main`.

The workflow installs pinned Hugo, runs the dependency-free Node tests, builds the site, and uploads/deploys `public/`. Pull requests build and run tests without deploying. The deployment base URL comes from GitHub Pages, so repository subpaths and configured custom domains are respected. No hardcoded repository name or client-side routing fallback is needed.

All remote actions are pinned to full-length commit SHAs, with release versions in comments. Pages packaging is performed directly to avoid mutable action references nested inside a composite uploader. `npm test` rejects unpinned remote action references; update SHA pins deliberately when updating action versions.

To preview a production build:

```sh
hugo --gc --minify --baseURL "https://azure-samples.github.io/ms-ignite-2026-session-guide/"
```

Generated files live in `public/` and are ignored by Git. Enable GitHub Pages before publishing from `main`; the app does not enable hosting automatically. Localhost share links work only on the originating machine; publish the site before distributing links.

## Project layout

```text
2026_ignite_session_catalog.json  Authoritative event export
hugo.toml                        Hugo settings and source filename
data/guide.json                   Built-in editorial learning paths
layouts/index.html                Single-page shell
layouts/partials/catalog.html     Build-time data normalization
layouts/partials/theme.html       Clawpilot theme and detection
assets/css/main.css               Responsive styles
assets/js/catalog.js              Catalog, agenda, and calendar logic
assets/js/guides.js               Validated compressed guide snapshots
assets/js/app.js                  Browser UI and local persistence
tests/                           Native Node tests
.github/workflows/pages.yml       GitHub Pages build and deployment
```

JavaScript is bundled by Hugo's built-in esbuild integration. Assets and normalized data use content fingerprints. No external fonts, analytics, client libraries, or runtime API calls are used; the only application data request is the same-origin generated catalog.
