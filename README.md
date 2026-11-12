# MS Events Session Guide

Find Microsoft events, explore curated session paths, and build a personal guide with calendar downloads and shareable links.

[Open the MS Events Session Guide](https://aka.ms/MsEventGuide).

Predefined guides are curated and published by internal Microsoft teams.

## Features

- Search events and session catalogs.
- Follow audience-specific paths or build your own guide.
- Save event-specific agendas, spot conflicts, and download calendar events.
- Share a snapshot of your guide, including session order and notes.

Paths are learning sequences, not conflict-free itineraries; saving a session does not reserve a seat. Share links are not encrypted, so do not include private information.

## Run locally

Requires **Hugo 0.159.1 or later** and **Node.js 22+**.

```sh
npm ci
npm run dev
```

Open **http://localhost:1313/**. Use `npm run build` to generate the site and `npm test` to run the tests.

## Testing

Use the fast PR gate for routine changes:

```sh
npx playwright install chromium
npm run test:pr
```

| Command | Scope | When |
| --- | --- | --- |
| `npm test` | Direct-code unit/model regressions, workflow guards, and Hugo build checks; no browser processes. | Every PR; during development. |
| `npm run test:e2e:smoke` | 12 tagged critical Chromium journeys: Save/reload/repeats, event isolation, guide/share/download, navigation, and recovery. | Every PR. |
| `npm run test:pr` | Both fast gates above. | Local pre-PR check. |
| `npm run test:e2e:chromium` | Broader single-engine browser regression. | Relevant UI changes/debugging. |
| `npm run test:e2e:full` | Full desktop/mobile Chromium, Firefox, and WebKit matrix (also `npm run test:e2e`). | On demand before merge or release. |

For the full matrix, first run `npx playwright install chromium firefox webkit`.
GitHub Actions runs code regressions plus smoke on PRs and main pushes; the full
workflow runs only through manual dispatch, for example before merge or release.
There is no recurring schedule.
The manual workflow isolates the five browser projects on separate runners with
two workers each, retaining a separate report artifact for each project.
Functional journeys use reduced motion to avoid scrolling-animation races;
responsive presentation checks retain normal motion.

The runner builds isolated, telemetry-free fixtures and owns `127.0.0.1:1414`;
leave that port free and run browser tiers sequentially. Smoke builds only the
two-event site; the full tier also builds repository-prefix, extended, real-content,
and long-prefix sites. Neither changes your running preview or browser profile.
`npm run test:e2e:smoke:report` opens smoke results; `npm run test:e2e:report` opens
full results. Smoke uses `test-results/e2e-smoke*`, so it does not overwrite the
full run's reports, downloads, traces, or build/coverage evidence.
See [the coverage specification](tests/e2e/e2e-tests.md) for implemented scope and
calendar-client prerequisites; browser download checks are not calendar imports.

The hosted app collects usage telemetry automatically; [run locally](#run-locally) without telemetry. See [PRIVACY](PRIVACY).

## Maintainer reference

See [Project design and event authoring](docs/design.md) for the expected project structure, adding events, and deployment configuration.
