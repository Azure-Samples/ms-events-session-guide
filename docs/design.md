# Project design and event authoring

Maintainer reference for internal teams publishing predefined event guides. Event content is curated by those teams; this document is not a public contribution guide.

The application is a static Hugo site. Event bundles supply metadata, session catalogs, audiences, and curated paths. The browser handles search, personal guides, local agendas, sharing, and calendar downloads without a backend.

## Architecture

The directory loads a small event manifest, not every session catalog. Each event has its own static page at `/events/EVENT_ID/`, normalized catalog, audiences, and paths. Past events remain available. Audience labels and path counts come from event content, not hardcoded JavaScript.

Drafts and agendas are isolated by event and browser origin. Shared guides are validated snapshots carried in URLs; the site stores no guide database. Session text and personal notes are rendered as text, never executable HTML.

## End-to-end testing

The end-user Playwright test specification lives in
[`tests/e2e/e2e-tests.md`](../tests/e2e/e2e-tests.md), with independent reviews
under `tests/e2e/reviews/`. Runnable tests accompany the specification.
`npm run test:pr` combines direct-code regressions with critical Chromium
journeys; `npm run test:e2e:full` runs the full desktop/mobile browser matrix.
GitHub Actions reports named code/smoke checks and the full five-project browser
matrix automatically on PRs. Main pushes retain the fast gate, and full coverage
is also manually dispatchable before release. There is no recurring schedule.
Calendar downloads are checked independently; actual calendar-client imports
remain blocked pending authorized client access.

## DevEx branding

The site uses the transparent phoenix illustration and icon mark from the supplied `DevEx-CoE-Brand.pptx`. Only those two artwork files are included in `assets/images/devex/`; the source presentation, meeting backgrounds, and videos are not published. Hugo generates responsive, fingerprinted WebP images and a cropped 32px PNG phoenix favicon. Shared brand/hero partials and `assets/css/devex.css` apply a compact inline masthead, faceted cards, and local Segoe UI/Cascadia Code font stacks while preserving the existing light/dark theme colors. The DevEx name sits beside "Microsoft Events Guide" in smaller text; no brand tagline is shown. No external fonts or animated assets are loaded.

The event switcher uses native disclosure behavior. Clicking or moving keyboard focus outside closes it; Escape closes it and restores focus to "Switch event." Event links keep their normal navigation behavior.

## Event links

Direct event paths such as `/events/ignite-2026/` remain the canonical entry points. A root link with `?event=ignite-2026` opens that published event and consumes the `event` selector, so the resulting URL is `/events/ignite-2026/`, not `/events/ignite-2026/?event=ignite-2026`. Other query parameters and the fragment, including filters, theme, and shared-guide tokens, are preserved without re-encoding. This also works when the site is deployed under a repository subpath.

Every published event must have an `event` parameter mapping: its permanent `params.eventId` maps to its published URL in the generated event manifest. For example, `event=ignite-2026` maps to `/events/ignite-2026/`. New event bundles supply this mapping automatically through their metadata; no separate alias list or JavaScript change is required.

An empty, repeated, or unknown event selector shows an error and leaves the directory available; it never silently opens Ignite or accepts an arbitrary destination URL. When both `event` and `guide` are present, the selector must match the validated shared guide's event. Existing root links without `event` retain their legacy behavior.

A vanity link such as `https://aka.ms/MsEventGuide?event=ignite-2026` works only if the redirect forwards the query string to the app.

## Calendar behavior

Scheduled sessions and entire built-in, custom, or shared guides export as standard `.ics` downloads. Repeated sessions require a specific occurrence. Import requires the calendar client's confirmation; the app does not silently write to calendars.

Events include their session code, title, description, speakers, room, and absolute UTC start/end times; your calendar displays them in its own time zone. Built-in paths use each session's earliest listed occurrence. Custom and shared guides use their exact saved occurrence snapshots, not potentially changed current listings. Personal attendance notes are not included in calendar events.

Sessions without a valid start and end time are explicitly excluded; import buttons are disabled if none can be exported. Overlapping sessions are retained and flagged, not silently dropped. These are personal calendar entries—not official meeting invitations, seat reservations, or a live calendar subscription. Re-export if session facts change, and check the official catalog before attending.

## How sharing works on a static site

GitHub Pages serves only static files. The browser serializes a versioned guide snapshot, compresses it with the native Compression Streams API, and encodes it in a link:

```text
https://OWNER.github.io/REPOSITORY/events/EVENT_ID/?guide=2.ENCODED_SNAPSHOT#my-guide
```

No guide database is required. Version 2 includes the event identity, and the URL carries the snapshot. Version-1 Ignite links and old root filter links remain readable and route to Ignite without re-encoding their tokens. A share for another known event opens that event; unknown event identities show an error instead of importing into the wrong agenda.

When Pages access is restricted, recipients must authenticate and have site access. A guide link does not grant access.

**Important limits:**

- A guide supports up to **20 unique sessions**, with bounded titles and notes. Share links are limited to **7,500 characters**, including the site's base URL. Shorten notes or use fewer sessions if a guide exceeds that limit.
- Editing a draft does **not** update an existing shared link. Create a new link to share the new snapshot. Old links cannot be revoked centrally.
- Anyone with site access and the URL can read its contents. Encoding is **not encryption**. Do not include private information. Query-string contents can appear in browser history, hosting logs, and messaging tools.
- Links remain usable while this site and its published event paths remain available and their snapshot versions remain supported. They are not short URLs or permanent hosting guarantees.
- Creating and reading links requires a current browser with `CompressionStream` and `DecompressionStream` support. Clipboard access may require HTTPS; a selectable link is provided if copying is blocked.
- Drafts and agendas are stored per event, only in this browser and origin. Legacy Ignite state is migrated without deleting its original keys or overwriting newer state. There is no cross-device or cross-origin sync. Storage failures are visible; copy a share link before leaving if saving fails.

Shared payloads are validated and decompressed with a bounded output size.

## Source data and curation

The Ignite source is **`content/events/ignite-2026/catalog.json`**, moved without changing the original export. It contains 1,500 occurrences representing 1,343 sessions. The event's **`guides.json`** contains its ordered audiences and paths.

The unused root `ignite_sessions.json` speaker export remains ignored and unpublished. Hugo reads the event bundle's source JSON but publishes only a fingerprinted normalized catalog and a small event manifest. Raw bundle catalog/editorial files are not direct website downloads.

For Ignite-format updates, keep stable `sessionId` and `sessionInstanceId` values. Required fields include those IDs, `sessionCode`, and `title`. Build-time normalization strips description markup and rejects missing curated references, invalid identities, or inconsistent event metadata.

Array order in `guides.json` determines audience/path ordering and defaults. Each path belongs to an explicitly declared audience and references real session codes. A published event needs at least one valid nonempty path, not exactly six paths or six steps. These are independent editorial recommendations, not official endorsements.

## Add an event (internal teams)

Add **only a new directory** under `content/events/EVENT_ID/`, containing:

1. `index.md`: copy the Ignite front matter, set a permanent lowercase `params.eventId` equal to the directory name, title, summary, ISO start/end dates, IANA time zone, HTTPS official catalog URL, keywords, and `catalogFormat`. The event ID also defines its required `?event=EVENT_ID` mapping. Keep `build.publishResources: false`.
2. `catalog.json`: use `catalogFormat: normalized` for an object with `updated` and `instances`. Each instance has `id`, `sessionId`, `code`, `title`, `description`, `speakers`, `type`, `level`, `topics`, `delivery`, `audiences`, `viewing`, `start`, `end`, `duration`, and `location`. Use ISO times with offsets; both start/end may be empty for unscheduled sessions. The existing Ignite raw format is also supported through `catalogFormat: ignite`.
3. `guides.json`: ordered `audiences: [{id, label}]` and `paths`. Paths use the existing `id`, `audience`, `name`, `label`, `headline`, `description`, `fit`, `outcome`, and `steps: [{code, stage, why, takeaway}]` fields.

No central registry or shared JavaScript edit is needed. Audience IDs are not restricted to startups/digital-native; `custom` is reserved for the editor. Session/occurrence IDs must be unique within an event but may repeat across events. Never rename, delete, or reuse a published event ID: keep past event bundles in place.

Test-only examples live under `tests/fixtures/content/events/`, including a normalized catalog, novel audiences, reused IDs, and a DST transition. Preview them separately:

```sh
hugo server --config hugo.toml,tests/fixtures/hugo.toml --bind 127.0.0.1 --port 1314 --disableFastRender
```

Fixture content is not included in an ordinary production build.

## Usage analytics

The data-collection notice and user-facing privacy information are in [PRIVACY](../PRIVACY).

The hosted app automatically records explicit custom events for event selection intents, session-brief opens, calendar-download requests, successful custom-guide share creation and its ordered session composition, shared-guide opens, and zero-result filters. They include event/catalog/session identities, action counts, an ephemeral action ID, environment, and build version. They **do not** include guide titles, summaries, personal notes, share tokens, URLs/referrers, raw search text, account/email IDs, or persistent visitor identities. They are best-effort observed actions, not unique users, reservations, or proof of calendar import.

The analytics SDK uses no cookies or persistent/session storage. There is no consent provider, banner, or permission prompt. The event app stores drafts and agendas locally, independently of telemetry. Default local runs and PR builds exclude analytics; deployments enable it automatically. Disposing the telemetry runtime discards buffered events and prevents new sends.

To build or run without application analytics:

```sh
HUGO_TELEMETRY_ENABLED=false npm run dev
HUGO_TELEMETRY_ENABLED=false npm run build
```

Disabling application analytics does not disable GitHub's hosting/access logs, and a requested share URL still reaches its hosting provider.

Explicit analytics builds require `HUGO_TELEMETRY_ENABLED=true`, `HUGO_TELEMETRY_ENV=production` or `test`, `HUGO_TELEMETRY_CONNECTION_STRING`, a matching HTTPS `HUGO_TELEMETRY_ORIGIN`, and an optional bounded `HUGO_TELEMETRY_BUILD_ID`. The runtime starts automatically when that configuration is valid. Invalid configuration, SDK errors, and blocked requests do not prevent use of the app.

Connection strings are public browser ingestion configuration, not query or management credentials. Keep environment-specific values out of source, use deployment-environment variables when publishing later, and never embed workspace shared keys or Azure tokens. Do not give PR builds production configuration.

The Pages workflow reads these repository Actions variables only for deployment builds on `main`:

| Variable | Value |
|---|---|
| `HUGO_TELEMETRY_ENABLED` | Defaults to `true` in deployment builds; set `false` to disable collection |
| `HUGO_TELEMETRY_CONNECTION_STRING` | Connection string from your Application Insights resource |
| `HUGO_TELEMETRY_ORIGIN` | Exact HTTPS origin from the repository's Pages deployment URL, without a path |

The workflow fixes the environment to `production` and tags events with the commit SHA. PR and non-main preview builds explicitly disable telemetry and receive none of these deployment variables. There is no separate release-approval or visitor-permission gate. After changing variables, rebuild and deploy `main` to apply them; they are embedded at build time.

The optional Azure templates provision Application Insights `ms-events-guide`, linked to dedicated workspace `ms-events-guide-logs`, in your selected subscription and existing resource group. Configure `AppEvents` for **730-day interactive and total retention** after its first ingestion. The workspace cap is disabled (`-1`); Application Insights additionally has an **Azure-default 100 GB/day component limit**. Ingestion and two-year retention are billable.

Use an Azure CLI session that can access your target subscription. Every provisioning command explicitly selects the subscription and leaves the CLI default unchanged. Set the required environment variables before using these scripts; no internal subscription or tenant is supplied as a default.

```sh
export AZURE_SUBSCRIPTION_ID="<your-subscription-id>"
export AZURE_TENANT_ID="<your-tenant-id>"
export AZURE_RESOURCE_GROUP="<your-existing-resource-group>"
az account show --subscription "$AZURE_SUBSCRIPTION_ID"
bash scripts/provision-monitoring.sh what-if
# Review the scope/diff before explicitly creating the two resources:
bash scripts/provision-monitoring.sh create
# Apply the separately approved pre-storage privacy transformation:
bash scripts/configure-telemetry-privacy.sh what-if
bash scripts/configure-telemetry-privacy.sh create
# After one test event creates AppEvents:
bash scripts/configure-telemetry-retention.sh
```

Read the connection string from the new component's Overview page. Read back workspace linkage, effective caps, sampling and table retention before enabling production analytics. Never weaken a tenant policy to get client-side ingestion working.

Application Insights can derive geolocation, browser and OS from request metadata even when the client payload omits them. The separately approved `ms-events-guide-privacy` workspace transformation removes those fields and visitor/session/operation identities **before storage in AppEvents**. It does not filter out the business events or their session composition. `infra/privacy-transform.json` and `scripts/configure-telemetry-privacy.sh` configure it only on this dedicated workspace; rerunning the core provisioning script preserves that association.

Transformations apply to newly ingested records, not older smoke-test rows. Verify stored post-transformation rows before production activation; a clean client envelope alone is not proof that server enrichment is absent. Default local builds remain telemetry-disabled; hosted builds collect automatically with valid configuration.

## Analyze the data

`analytics/telemetry-contract.json` documents event semantics and numbered composition parts. `analytics/usage.kql` reconstructs and deduplicates action records in `AppEvents`, reports incomplete/unknown composition explicitly, and provides event/session trends and ordered custom-guide composition. Set its date range and environment; production queries exclude marked test traffic.

A separate custom internal dashboard is deferred. The public guide does not query telemetry or receive query credentials. Analysts use Microsoft sign-in and existing Azure permissions.

Preserve an event/session title lookup for each catalog version when producing a build:

```sh
node scripts/export-analytics-catalog.mjs public > /path/outside/repo/catalog-dimensions.json
```

This exports only controlled catalog event names, session codes/titles and IDs, keyed by `eventId` and `catalogVersion`. It is not visitor data. Store versioned exports with the future internal analytics project; they are not automatically ingested or publicly fetched by the guide. Do not interpret calendar multipart rows as separate download actions.

Unscheduled sessions remain explicitly unscheduled and are excluded from calendar export. Online attendance and recording availability are displayed separately. Verify all session times, seat availability, and attendance details in the [official Ignite catalog](https://ignite.microsoft.com/en-US/sessions).

## Deploy to GitHub Pages

Target repository: [Azure-Samples/ms-events-session-guide](https://github.com/Azure-Samples/ms-events-session-guide).

Use the deployment URL shown in your repository's Pages settings. The app is published after its workflow and source are merged into `main` and Pages is configured.

1. The workflow publishes from `main`; change `.github/workflows/pages.yml` if using a different production branch.
2. With Maintain or Admin access, enable Pages in **Settings → Pages → Build and deployment**, and select **GitHub Actions** as the source. Do not select branch-based deployment: that would publish the repository's README instead of the generated Hugo app.
3. Use a feature branch and pull request for changes. Merge into `main` to publish, or run the workflow manually on `main`.

The workflow installs pinned Hugo and npm dependencies, runs the native Node tests, builds the site, and uploads/deploys `public/`. Pull requests build and run tests without deploying. The deployment base URL comes from GitHub Pages, so repository subpaths and configured custom domains are respected. No hardcoded repository name or client-side routing fallback is needed.

All remote actions are pinned to full-length commit SHAs, with release versions in comments. Pages packaging is performed directly to avoid mutable action references nested inside a composite uploader. `npm test` rejects unpinned remote action references; update SHA pins deliberately when updating action versions.

To preview a production build, use the actual Pages URL shown in repository settings or the deployment workflow:

```sh
hugo --gc --minify --baseURL "https://Azure-Samples.github.io/ms-events-session-guide/"
```

Generated files live in `public/` and are ignored by Git. Enable GitHub Pages before publishing from `main`; the app does not enable hosting automatically. Localhost share links work only on the originating machine; publish the site before distributing links.

Internal repository access policies and JIT templates are not included. The app workflow does not modify repository access grants or visibility.

## Project structure

```text
content/events/EVENT_ID/          Event metadata, catalog, and curated paths
hugo.toml                        Shared site settings
layouts/index.html                Event directory
layouts/events/single.html        Event-specific guide
layouts/partials/catalog.html     Build-time data normalization
layouts/partials/theme.html       Clawpilot theme and detection
assets/css/main.css               Responsive styles
assets/js/catalog.js              Catalog, agenda, and calendar logic
assets/js/guides.js               Validated compressed guide snapshots
assets/js/app.js                  Browser UI and local persistence
assets/js/events.js               Event search, dates, validation, legacy routing
assets/js/event-state.js          Event-scoped storage and legacy migration
assets/js/telemetry*.js            Automatic allowlisted analytics
analytics/                        Telemetry contract and KQL (dashboard deferred)
infra/monitoring.json             Scoped workspace/Application Insights template
tests/                           Native Node tests
.github/workflows/pages.yml       GitHub Pages build and deployment
```

JavaScript is bundled through Hugo/esbuild; assets and normalized catalogs are fingerprinted. Event data is same-origin. A default local build makes no analytics calls. A deployment sends only allowlisted custom telemetry to the configured Azure ingestion endpoint, without loading a consent service or showing a banner.
