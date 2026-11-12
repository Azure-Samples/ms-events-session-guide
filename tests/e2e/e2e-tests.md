# End-to-end test cases: Microsoft Events Guide

## Purpose and status

This is the end-user coverage specification, backed by executable Playwright
specs beside this file. It covers the event directory, event pages, personal
agenda, custom guides, share-link recipients, calendar downloads, and actual
calendar imports. Executable browser coverage is a subset of this full target:
neither passing unit tests nor the browser subset certifies unimplemented
variants or actual client imports. Do not push or deploy as part of local testing.

For routine PRs run `npm ci`, `npx playwright install chromium`, then
`npm run test:pr`: direct-code unit/model/build regressions followed by 13
tagged Chromium UI journeys. The smoke config builds only the two-event site
and writes `test-results/e2e-smoke*`, including a separate HTML report; use
`npm run test:e2e:smoke:report` to open it. Smoke uses the same actual tests as
the full suite, not a second simplified implementation.

The full matrix remains `npm run test:e2e:full` (or `npm run test:e2e`), after
`npx playwright install chromium firefox webkit`. Hugo 0.159.1+ and Node.js 22+
are prerequisites. GitHub Actions runs code regressions and smoke for PRs/main
pushes, and the full matrix automatically on PRs or by manual workflow dispatch
before release. The five `Browser E2E` jobs report directly in PR checks, without
manually posted statuses. There is no recurring schedule.
Functional journeys use reduced motion; the responsive presentation variants
retain normal motion. The full workflow isolates projects on separate runners
with two workers each and retains per-project reports.
The runner
builds fixture sites and owns `127.0.0.1:1414` for the run, without reusing a
possibly stale server. `npm run test:e2e:chromium` runs only desktop Chromium.
`npm run test:e2e:report` opens the HTML report. There are no retries hiding
flaky outcomes. Traces/screenshots remain on failure; real downloads and share
URLs are test attachments. `test-results/e2e-build.json` records build/fixture
provenance, `e2e-results.json` records project/variant outcomes, and
`e2e-coverage.json` maps executable outcomes to these case IDs and explicitly
lists cases without automation. A filtered run reports only that selected scope.
Smoke does not overwrite these full-run artifacts; its coverage report marks
unselected cases as unselected, not successful. Browser tiers share port 1414
and must run sequentially. Direct-code `tests/model-regressions.test.mjs`
connects filtering, snapshots, shares, stored event state, DST and independently
parsed calendars without launching browsers. Existing catalog/guide/state tests
own exhaustive invalid-input and boundary permutations; smoke protects real
UI wiring, persistence, independent recipients and actual downloaded artifacts.

### Executable scope

| Executable file | Cases covered (some contain multiple variants) |
| --- | --- |
| `journey.spec.mjs` | 001: connected author/independent-recipient/download/Save/reload journey. |
| `integration.spec.mjs` | 014, 039, 059, 078, 086 sequential downloads, 088 two-tab persisted edits. |
| `workflows.spec.mjs` | Agenda, repeated occurrence choice, guide editing, immutable shares, changed/removed catalog snapshots, actual calendar downloads; case IDs are in each test title. |
| `navigation.spec.mjs` | 070-075, 080-081: directory, selectors, actual `/repo/` deployment, dropdown, exact filters, retry and no-JavaScript fallback. |
| `registration.spec.mjs` | 090: event-specific registration, sticky event-bar placement, external navigation, absent URLs, past dates, failed catalogs, repository prefixes and no-JavaScript access. |
| `resilience.spec.mjs` | 082 access/quota faults, 083 corrupt JSON recovery, 087 attempted-telemetry observation, 089 real held Web Lock. |
| `share-errors.spec.mjs` | 033 denied clipboard; 040 malformed/semantic/expansion errors; 041 unavailable compression/decompression; 042-043 gated native stream races. |
| `clipboard.spec.mjs` | 033 native allowed clipboard round-trip and 077 copied public view links on desktop Chromium only. |
| `timezones.spec.mjs` | 057: nine browser/app zone combinations and independent UTC calendar parsing. |
| `presentation.spec.mjs` | 085: six widths in both themes on desktop Chromium. |
| `extended.spec.mjs` | 017 conflicts/boundaries, 026 twenty-step limit, 027 input boundaries, 058 repeated/conflicting UID exports, 060 browser-only Unicode calendar round trip, 076 pagination/repeat grouping. Generated fixture manifests and hashes live under `test-results/e2e-extended/`. |
| `compatibility.spec.mjs` | 019 actual browser-profile restart, 079 real-content Ignite legacy routes/v1/migration; 084 real keyboard-only journey on desktop Chromium. |
| `share-limits.spec.mjs` | 041 high-entropy token limit with recovery, plus full-URL limit on an actually served long-baseURL build. |

Default projects are Chromium/Firefox/WebKit desktop and 390px mobile
Chromium/WebKit; the current runner executes the workflow, navigation, resilience,
share-error and time-zone files in all five. Presentation and allowed-clipboard
sampling are as listed above, not the full aspirational matrix below. E2E-084
uses desktop Chromium's full Tab traversal; macOS WebKit/Firefox native
keyboard-accessibility preferences are not silently assumed or changed.
Actual Outlook imports and native Apple Calendar checks are **not implemented or
executed by this runner** and need an authorized dedicated account/client plus
disposable destinations. They remain blocked, not successful skipped tests.
Remaining prose-only cases/variants are explicitly visible in the coverage
report; no empty placeholder tests count as coverage.

Each case uses **Given** (initial state), **When** (user actions), and **Then**
(observable expected behavior). P0 cases protect the essential user journeys;
P1 cases cover important alternatives and regressions; P2 cases cover extended
compatibility. Missing prerequisites are reported as **blocked**, never passed
or silently skipped.

## Execution contract

1. Use a fresh browser context per independent case, with downloads enabled.
   Create separate author and recipient contexts for sharing. Opening a second
   page in the author's context is not evidence that a share works independently.
   Use temporary persistent profiles only for explicit browser-restart cases.
2. Drive navigation, typing, filtering, saving, guide editing, sharing, and
   downloads through visible UI controls. Prefer role/name and label locators,
   scoped to a card, dialog, guide section, or agenda row. Stable IDs may
   disambiguate controls with the same label. Do not call application functions,
   inject saved state, or generate the share token to make a positive case pass.
3. Setup may seed legacy/corrupt storage, deny browser capabilities, intercept
   network failures, or serve a prepared changed catalog only where the Given
   explicitly requires it. Record every such fault injection. Never mock the
   behavior being verified or replace a normal download with a fabricated file.
4. Wait for visible readiness, counts, enabled controls, URL changes, download
   completion, and persisted UI after reload. Do not use arbitrary sleeps or
   `networkidle` as the sole readiness oracle. Search is debounced. Storage
   writes are asynchronous. After UI actions, bounded read-only polling of
   `ms-events-guide:EVENT_ID:agenda:v1` or `:draft:v1` for the independently
   expected IDs/fields is permitted as a write-completion signal. Then reload
   and assert the restored UI: storage alone is not the pass oracle. Never
   populate those keys to satisfy a positive Save/draft case. Allow 10 seconds
   for a normal write; a timeout fails rather than falling back to a sleep.
5. Before clicking an export control, register Playwright's download listener;
   await that actual download, check `failure()`, save it under the case artifact
   directory, and inspect its bytes. Register popup listeners before opening a
   shared view. A toast, `.ics` filename, HTTP status, or nonempty token alone
   is not a successful end-to-end assertion.
6. Expected session facts come from the pinned test-data table below, not from
   the application's calendar serializer, share decoder, or the same UI being
   checked. Reading the downloaded file with an independent iCalendar parser
   is allowed. UI assertions remain necessary even when a payload parses.
7. Normal runs use telemetry-disabled local builds on isolated ports/origins.
   Do not use the running user's profile, modify their saved guides, send test
   telemetry to Azure, or import into a personal/work calendar.
8. Capture browser/version, viewport, time zone, build commit plus dirty-diff
   identifier, catalog fixture version, case ID, inputs, outcome, and reason.
   On failure retain trace, screenshot, relevant console/network errors, exact
   test share URL, and the actual downloaded file. Use synthetic text only.
9. Browser Back/Forward tests must exercise real history entries. Filter edits
   use `replaceState`; do not assume each keystroke creates a Back entry.
10. A normal successful action must not produce an unexpected page error,
    unhandled rejection, duplicate download, or unrelated draft/agenda change.
    For negative cases identify the expected failure explicitly.
11. Observe beforeunload dialogs before intentional reload/navigation. An
    unexpected unsaved-change prompt fails a normal durability case. Only the
    explicitly pending/failed-storage cases may accept that expected prompt
    to leave an isolated test page; record it and do not claim the data persisted.

### Location and growth

Keep this specification in `tests/e2e/`, beside executable Playwright specifications
grouped by user workflow (for example, agenda, custom guides, sharing, and
calendars). The existing `tests/*.test.mjs` unit/build tests and shared
`tests/fixtures/` stay where they are; reuse those fixtures before introducing
E2E-specific data. Keep review records under `tests/e2e/reviews/`, not among
executable specs. Generated downloads, traces, and reports belong in ignored
test-result directories, not in this source directory. Do not add a second
copy of this plan at the repository root.

This is the initial cross-feature coverage index. Preserve case IDs when
implementing or splitting it by workflow, map each case to its executable spec,
and add cases as features grow. `npm test` runs existing unit/build tests only;
`npm run test:e2e` runs Playwright separately.

### Environments and coverage matrix

| Environment | Setup and purpose |
| --- | --- |
| Real-content local preview | `HUGO_TELEMETRY_ENABLED=false hugo server --bind 127.0.0.1 --port 1413 --baseURL http://localhost:1413/ --disableFastRender`; smoke the real Ignite catalog without touching the review preview on port 1313. |
| Existing two-event fixture preview | `HUGO_TELEMETRY_ENABLED=false hugo server --config hugo.toml,tests/fixtures/hugo.toml --bind 127.0.0.1 --port 1414 --baseURL http://localhost:1414/ --disableFastRender`; supplies Contoso and Fabrikam, not Ignite. |
| Repository-subpath fixture preview | Serve a separately generated fixture build under `/repo/`, with the Hugo base URL set to that actual host and prefix; exercise routing and asset links without redirecting to `/`. |
| Extended fixtures | Isolated test-only data variants described below. They are prerequisites to create during test implementation, not assets already present in the repository. Never copy them into production content. |
| Calendar client | Dedicated authorized Outlook test account and a new disposable calendar per import case; Playwright drives its visible web import UI. Apple Calendar is a separately recorded manual interoperability check, not browser automation. |

The following rows define the required projects; do not take their full Cartesian
product. Each case's named variants run within each project that lists that case.

| Project | Required cases/variants | Browser, viewport, theme, browser zone |
| --- | --- | --- |
| Core desktop | All P0 browser-only cases; all named variants | Each of Chromium/Firefox/WebKit, 1280x900, light, America/New_York, two-event fixtures. |
| Extended desktop | All P1 browser-only cases not already in core or assigned solely to time-zone/prefix/real-Ignite/presentation rows, and E2E-088 | Chromium, 1280x900, light, America/New_York; relevant extended/error fixtures. |
| Mobile core | 001, 009, 010, 011, 012, 020, 021, 022, 030, 033, 036, 050, 051, 053, 054, 055, 056, 073 | Chromium and WebKit, 390x844, light, America/New_York; all variants except explicitly fault-only variants. |
| Responsive presentation | E2E-085 | Chromium at each of 320/390/768/820/1024/1440px, light and dark, height 900; additionally mobile WebKit at 390x844 in both themes. |
| Time-zone conversion | E2E-057 | Chromium at 1280x900, light; each browser zone America/New_York, America/Los_Angeles, UTC crossed with each app choice event/local/UTC: nine rows. |
| Repository prefix | E2E-001, 030, 039, 070, 071 | Chromium, 1280x900, light, America/New_York, actual `/repo/` deployment. |
| Real Ignite | E2E-079, plus 070/direct and 070/selector using `ignite-2026` | Chromium, 1280x900, light, America/Los_Angeles, real-content preview; do not apply C/F facts to this project. |
| Outlook imports | 060/UTC, 061/NY, 062/UTC, 063/Chicago, 064/UTC; optional 065/UTC | Chromium desktop with pinned Outlook web build/account prerequisites; set the actual client's display zone named in the variant. |
| Native interoperability | E2E-066/individual, /guide, /DST | Manual Apple Calendar on a recorded supported macOS/Calendar version; NY, UTC, Chicago respectively. |

Use `/variant` suffixes in result rows. Mandatory multi-variant cases are:
011 `/unfiltered`; 012 `/agenda-remove`, `/dialog-toggle`; 021 `/filtered-card`,
`/filtered-dialog`, `/saved-time-independent-card`, `/saved-time-independent-dialog`,
`/duplicate-repeat`; 027 `/lengths`, `/unicode-markup`, `/title-trim`;
033 `/clipboard-allowed`, `/clipboard-denied`; 036 `/empty`, `/already-saved-repeat`;
037 `/shared`, `/persisted-draft`, `/edit-copy`; 038 `/shared`, `/persisted-draft`;
040 `/truncated`, `/base64`, `/version`, `/unknown-event`, `/selector-mismatch`,
`/duplicate-session`, `/invalid-time`, `/expanded-limit`;
041 `/oversize-token`, `/oversize-full-url`, `/no-compression`, `/no-decompression`;
043 `/leave-share`, `/newer-share`, `/stale-error`; 050 `/card`, `/dialog`, `/agenda`;
070 `/card`, `/direct`, `/selector`; 071 `/valid`, `/empty`, `/repeated`, `/unknown`;
073 `/outside`, `/escape`, `/focus-away`, `/toggle`, `/navigate`, `/private-state`;
080 `/catalog-http`, `/manifest-http`, `/invalid-catalog`;
081 `/manifest-http`, `/javascript-off`;
082 `/access-denied`, `/quota-failed`; 083 `/agenda-json`, `/draft-json`,
`/wrong-event`, `/removed-occurrence`. The remaining cases have one row unless
their steps explicitly request independently reset variants; record those
steps as subassertions, not an unexplained sampled pass.

For example `core-webkit/E2E-050/dialog` and `outlook/E2E-062/UTC` are distinct
results. Feature-capability absence is Blocked or Fail with the actual reason,
not an implicit cross-browser skip. Calendar imports are not required on every
mobile/browser combination.

### Test data and independent oracles

The existing fixture catalog is small and deliberately reuses IDs across events.
These facts must be asserted explicitly, not discovered by choosing the first
card that happens to be visible.

| Alias | Existing event/session facts |
| --- | --- |
| C | `contoso-dev-days-2026`; event zone `America/New_York`; title `Contoso Dev Days 2026 (fixture)`. |
| C1a | `DEV100`, `Contoso keynote`, session `S100`, occurrence `S100-a`; 2026-11-09 14:00-15:00 UTC; Hall A. |
| C1b | Same session/code/title as C1a, occurrence `S100-b`; 2026-11-10 14:00-15:00 UTC; Hall A. |
| C2 | `DEV200`, `Shipping small`, `S200-a`; 2026-11-10 15:30-16:15 UTC; Hall A. |
| C3 | `DEV300`, `Grants and impact`, `S300-a`; 2026-11-13 16:00-17:00 UTC; Hall A. |
| CU | `DEV400`, `Unscheduled lab`, `S400-a`; no start/end; no calendar event may be invented. |
| C path | Startup / `Launch fast`: DEV100, DEV200, DEV300 in that learning order; earliest DEV100 occurrence is C1a. Nonprofit / `Impact first`: DEV300 only. |
| F | `fabrikam-summit-2027`; event zone `America/Chicago`; title `Fabrikam Summit 2027 (fixture)`. |
| F1 | `FAB100`, `Fabrikam opening`, occurrence `S100-a`; 2027-03-13 21:00-22:00 UTC; Room 1. Its occurrence ID deliberately collides with C1a. |
| FDST | `FAB200`, `Across the DST change`, occurrence `S200-a`; 2027-03-14 07:30-08:30 UTC, displayed locally as 01:30-03:30 across spring-forward; elapsed time is 60 minutes. |
| F repeat | Same FAB200 session, `S200-b`; 2027-03-15 14:00-15:00 UTC. |
| FU | `FAB500`, `Unscheduled hallway track`, `S500-a`; no start/end. |

**Golden custom guide G, exact UI recipe:** start in C with empty agenda/draft
and select UTC for displayed times. Reset filters, set Day to 2026-11-10, search
DEV100, and Add its card to custom guide, producing C1b. Reset filters, search
DEV200, and Add C2. Reset again, select Time not listed, search DEV400, and Add CU.
Open Create a guide; move C2 earlier once to produce **C2, C1b, CU**. Name it
`E2E team: cloud & cafe`; summary `Three stops, one shared plan.`. Set C2's note
to `Compare deployment choices.`, C1b's to `E2E_NOTE_NOT_FOR_CALENDAR_42`, and
CU's to `Ask about the lab schedule.`. Await the exact persisted draft, then
reload and verify all fields. The expected guide calendar is **C1b, C2** in
chronological order; CU is excluded. Construct G anew through UI in each case.
No Save action is part of this recipe.

**Complete G snapshot oracle:** each step has the following common values:
`speakers="Fixture Speaker"`, `type="Breakout"`, `level="Intermediate (200)"`,
`delivery=["In-person"]`, `audiences=["Developers"]`, `viewing=["In-person"]`,
and `location="Hall A"`. The remaining snapshot fields are pinned below; arrays
have the stated order and no extra labels.

| G position | id / sessionId / code | title; plain description | topics; start/end; duration |
| --- | --- | --- | --- |
| 1 | `S200-a` / `S200` / `DEV200` | `Shipping small`; `Shipping small & fixture details.` | `["Apps"]`; `2026-11-10T15:30:00Z` / `2026-11-10T16:15:00Z`; 45 |
| 2 | `S100-b` / `S100` / `DEV100` | `Contoso keynote`; `Contoso keynote & fixture details.` | `["Cloud"]`; `2026-11-10T14:00:00Z` / `2026-11-10T15:00:00Z`; 60 |
| 3 | `S400-a` / `S400` / `DEV400` | `Unscheduled lab`; `Unscheduled lab & fixture details.` | `["Labs"]`; empty strings for both start/end; 0 |

Each plain Contoso description in this table includes a final LF (`\n`) from
Hugo's existing paragraph-to-plain-text normalization. Pin that whitespace in
snapshot and calendar DESCRIPTION comparisons rather than changing the app to
fit a test oracle. The visible text assertions may normalize whitespace.

The shared payload is version 2, event `contoso-dev-days-2026`, G's trimmed
title, exact summary, and these three session objects with their exact notes. Assert
all three UI-visible steps, including CU and its empty schedule; open each
snapshot brief to check visible facts. A secondary independent base64url,
native zlib/deflate, and JSON reader may compare the actual URL payload with
this complete object for nonvisible fields. Do not use the app's encode/decode/
snapshot helpers as either the producer or expected-value generator.

**Calendar oracle additions:** C1b's UID is
`contoso-dev-days-2026:S100-b@ms-events-guide`; C2's is
`contoso-dev-days-2026:S200-a@ms-events-guide`. C1a's and F1's are respectively
`contoso-dev-days-2026:S100-a@ms-events-guide` and
`fabrikam-summit-2027:S100-a@ms-events-guide`. Other non-Ignite fixture UIDs use
that event ID, a colon, the occurrence ID, then `@ms-events-guide`; legacy Ignite
uses `OCCURRENCE_ID@ignite-field-guide`. G's export has exactly the C1b/C2 UID set.
Its event DESCRIPTION is each pinned plain session description followed by:
`\nSpeakers: Fixture Speaker\nVerify times and attendance in the official Contoso Dev Days 2026 (fixture) catalog: https://example.com/contoso-dev-days/sessions. Saving is not a reservation.`
For other C exports, C1a has C1b's same non-timing facts, and C3's description
is `Grants and impact & fixture details.\n`, topic Nonprofit, duration 60, with
the other common C values above. Launch fast's copied step notes are exactly
`Fixture reason for CODE.\n\nTake this home: Fixture takeaway for CODE.`
with each declared DEV code substituted; its description is `Fixture description.`.
For F the description template is `{title} \u2014 normalized fixture.` with
`\u2014` meaning the actual Unicode em dash. Its common facts are Fixture
Speaker, Workshop, Advanced (300), topics `["Government"]`, delivery
`["In-person","Online"]`, audiences `[]`, viewing `["Live"]`, Room 1, duration
60 for scheduled occurrences and 0 for FU. Use its full fixture event title
and official URL `https://example.com/fabrikam-summit/sessions` in the notice.
These strings/UIDs are expectations, not calls to the serializer. The final LF
in a normalized C paragraph plus the export's added LF means two LFs before
`Speakers:`; the oracle intentionally preserves both.

**Reusable state arrangements, always through UI:** A is the agenda C1b/C2/CU,
count three (save each explicitly, not a bulk path). D is a distinct recipient
draft with only C3, title `Recipient plan`, summary `Keep this local.`, and note
`Recipient C3 note.`. Cross-event sentinel F-state is saved F1 plus a one-step
F1 draft titled `F isolation draft`, summary `Keep F unchanged.`, note
`F1 sentinel note.`. Edited G is titled `Edited E2E plan`, summary `Updated plan.`,
ordered C1b/C2 after CU removal, with C1b note `Prioritize this keynote.` and C2's
original note. Snapshot these exact expected UI states before destructive tests.

**Required extended-data recipes:** prepare deterministic build variants for
an overlapping scheduled pair and a touching/nonoverlapping pair; at least
21 unique sessions for guide limits and pagination; special-character and long
Unicode session facts; a current catalog where a shared occurrence changed
time/title/room but kept its ID; a catalog with a previously shared occurrence
removed; and a high-entropy guide whose real generated URL exceeds 7,500
characters despite valid individual field lengths. Pin the full expected
values and hashes with those fixtures. The existing fixtures do not provide
all of these. Legacy/malformed share payloads must be fixed test artifacts;
positive share tests must always obtain the link from the UI.

| Prerequisite ID | Exact preparation/expected facts and dependent cases |
| --- | --- |
| FX-OVERLAP | Build-valid C variant adding `S500-a`/`S500`/DEV500, title `Overlap control`, at 2026-11-10 14:30-15:30 UTC (60 minutes), and `S600-a`/`S600`/DEV600, title `Boundary control`, at 15:00-15:30 UTC (30 minutes). Other fields copy C2, with each description set to its own title. Against C1b, DEV500 overlaps and DEV600 only touches. E2E-017/058. |
| FX-LIMIT | Build-valid C variant with at least 21 unique scheduled sessions, predictable code/title/time ordering, at least ten initial matching cards, and existing curated references retained. Pin all added records and expected first/second page IDs. E2E-026/076. |
| FX-CHANGED | In C's raw source change both DEV100 titles to `Contoso keynote - updated` and descriptions to `Updated keynote facts.`; change C1b to 2026-11-10 14:15-15:15 UTC and Hall B, keeping all IDs/codes and path references. Build and pin the normalized result. E2E-037. |
| FX-REMOVED | Remove only C1b from C, retaining C1a so curated DEV100 remains build-valid. E2E-038/083. |
| FX-TEXT | Build-valid extra session whose title/description/speaker/room contain prescribed escaped punctuation, newlines where supported, and long Unicode. Store the literal expected strings and imported rendering before implementation. E2E-060; author-entered text in E2E-027 can use ordinary C. |
| FX-OVERSIZE | Two independently prepared UI recipes: high-entropy valid field contents exceeding the token's compressed limit; and a token within that limit whose full URL exceeds 7,500 because of an actually served long repository prefix. Pin inputs, base URL, measured lengths, and hashes per project; do not merely assume a long note is enough. E2E-041. |
| LINK-BAD | Fixed, independently serialized artifacts for truncated/base64/version errors, unknown event, duplicate session, end-before-start, and deflate data expanding beyond 256 KiB. Route root errors to the root and semantic/current-event errors to C. No fixture should depend on `decodeGuide` accepting it. E2E-040. |
| LINK-LEGACY | Fixed valid version-1 Ignite link plus legacy storage artifacts with independently pinned session facts; production-content local build only. E2E-079. |
| FAULT-HTTP | Intercept the actual generated catalog/manifest URL with HTTP 503; separate invalid-catalog variant returns syntactically valid but schema-invalid JSON at runtime. Do not try to build and serve source data that Hugo correctly rejects. E2E-080/081. |
| GATE-STREAM | Before app boot, narrowly wrap the real native CompressionStream or DecompressionStream with a gate on readable completion; preserve its real algorithm and bytes. Select one operation by ordinal and leave later operations ungated; expose started/release controls keyed to that operation. Wait for started before the newer edit/navigation, then release; never return a canned successful token/guide. E2E-042/043. |
| GATE-LOCK | After app boot completes, an auxiliary same-origin page holds the actual `ms-events-guide:contoso-dev-days-2026:storage` Web Lock until explicitly released; no app persistence function is mocked. E2E-089. |

The runner now supplies overlap/limit/text build fixtures and hashes through
`extended-fixtures.mjs`, an actual long-prefix build plus deterministic
high-entropy UI inputs, malformed/legacy independent tokens, and native
stream/lock gates. Changed/removed-catalog cases explicitly intercept the
generated catalog at runtime; they do not claim a new raw-source Hugo build.
HTTP/schema/capability/storage faults are likewise runtime-only negative
arrangements. Further prerequisite variants remain blocked until implemented;
never silently substitute an unlisted test for a named variant.

For E2E-075, independently expect four C session cards before filters; topic
Apps yields DEV200; Day November 10 yields DEV100/C1b and DEV200; Day Time not
listed yields DEV400; Cloud plus November 10 yields only DEV100; Cloud plus
November 13 yields none. Apps + Breakout + Intermediate (200) + In-person yields
only DEV200. Title A-Z yields DEV100/DEV300/DEV200/DEV400; chronological default
occurrences yield C1a/C2/C3/CU. Pin extended-fixture facet values separately.

**State distinctions:** Save bookmarks an occurrence to the personal agenda;
Add to custom guide creates an independently stored snapshot; Create share
link produces an immutable URL snapshot; downloading/importing a calendar
does not perform any of those other actions. The app does not import an `.ics`
file into itself, reserve seats, send invitations, or synchronize calendars.

## A. Critical connected journey

### E2E-001 [P0] Author -> custom guide -> download -> recipient -> Save
**Given** separate clean author/recipient contexts on C and the exact G recipe.
**When** the author creates G through the catalog and editor, reloads, downloads
its guide calendar, creates a share link, and opens that exact link in the
recipient context; the recipient downloads the shared guide calendar and
clicks "Save available sessions to my agenda", then reloads.
**Then** the author's draft survives reload with the exact title, summary,
three step snapshots, order, and notes; the recipient initially sees that
same shared guide without author storage and with an empty agenda; both actual
downloads contain exactly C1b and C2 with matching UTC instants and no personal
notes; recipient Save adds exactly C1b, C2, and CU to its agenda, visible after
reload with a saved count of three; exporting that agenda contains two events;
the author's agenda remains empty and neither shared view changes.

## B. Personal agenda and Save

### E2E-009 [P0] Managing a filtered-out saved repeat does not toggle the wrong time
**Given** C1b saved through UI, Day set to November 9 so only C1a matches, and
an empty custom draft.
**When** the user clicks DEV100's already-Saved card control.
**Then** occurrence management opens, C1b remains saved, C1a remains unsaved,
the count stays one, and no new custom-guide step appears; the click does not
silently save C1a or remove C1b. After explicit removal of C1b and reload,
neither repeat remains saved.

### E2E-010 [P0] Save a single occurrence and restore it
**Given** C with an empty agenda, UTC display selected, and C2 visible in the catalog.
**When** the user clicks its Save control, views My agenda, reloads, and opens
the same event again through the directory.
**Then** C2 appears exactly once at 15:30-16:15 UTC when UTC is selected,
the catalog control is pressed/Saved, the header count is one, and those states
survive reload/navigation; no custom-guide step is created.

### E2E-011 [P0] Repeated-session Save requires an explicit occurrence
**Given** both DEV100 times are visible and neither is saved.
**When** the user clicks the card's Save control, then saves only C1b in the
session dialog and closes it.
**Then** clicking the card alone opens the choice dialog rather than silently
saving C1a; only C1b is saved, its dialog control is pressed, the card is marked
Saved, and the agenda and header show exactly one saved occurrence after reload.

### E2E-012 [P0] Unsave is synchronized and persistent
**Given** C2 is saved and its card, detail dialog, and agenda can be opened.
**When** the user removes it from the agenda in `/agenda-remove`, or uses the
pressed dialog Save toggle in a fresh `/dialog-toggle` variant, then reloads.
**Then** each removal leaves an empty agenda, count zero, and unpressed catalog/
dialog controls after reopening; re-saving never creates a duplicate.

### E2E-013 [P0] Saving a path does not replace an already chosen repeat time
**Given** C1b is already saved and Startup / Launch fast is selected.
**When** the user clicks "Save this path" twice.
**Then** the agenda contains C1b, C2, and C3 exactly once; C1a is not silently
substituted or added, and the second click does not increase the count.

### E2E-014 [P1] Individually saving both repeats is supported
**Given** DEV100 has no saved occurrence.
**When** the user saves C1a and C1b individually in the dialog and exports
the agenda.
**Then** both distinct times remain saved, count two, and the calendar has
two distinct UIDs/events; removing one does not remove the other.

### E2E-015 [P0] Save an unscheduled session without inventing a time
**Given** C has an empty agenda and CU is visible.
**When** the user saves CU and reloads.
**Then** count one and CU under Time not listed persist; agenda export remains
disabled and no per-session calendar download is available.

### E2E-016 [P0] Agenda clear confirmation and scope
**Given** agenda A, G, its existing share URL, and F-state in the same context.
**When** the user opens Clear agenda and cancels, then repeats and confirms.
**Then** cancel preserves all saved occurrences; confirmation removes only
this event's agenda and resets its controls/count after reload; G, its notes,
and the old share URL remain intact. Switch to F and reload to prove F1 and
the exact F draft still exist; an implementation clearing all event keys fails.

### E2E-017 [P1] Conflicts are visible and resolvable
**Given** FX-OVERLAP, with independent overlapping-pair and touching-pair variants.
**When** the user saves C1b and DEV500 in the overlap variant, then removes
DEV500; in a fresh variant saves C1b and DEV600.
**Then** the overlap pair is flagged in the agenda/save feedback, removal clears
that warning, and the touching pair alone has no conflict; exports retain all
scheduled selected occurrences without silently dropping conflicts.

### E2E-018 [P0] Save state is isolated by event, even with colliding IDs
**Given** C1a is saved and C has a custom draft.
**When** the user switches to F, saves F1, edits an F draft, and switches back
and forth, reloading both events.
**Then** each event shows only its own occurrence, title, time, agenda count,
and draft; the shared `S100-a` ID does not mix state.

### E2E-019 [P1] Browser persistence is not cross-device synchronization
**Given** C2 and G were created in a temporary persistent author profile.
**When** the browser closes and reopens that profile on the same origin,
and another fresh context opens C without the share URL.
**Then** the original profile restores its agenda/draft; the fresh context
has neither. Do not preload `storageState` and claim this proves restart
persistence or cross-device synchronization.

## C. Creating and editing custom guides

### E2E-020 [P0] Add is separate from Save
**Given** an empty draft/agenda and C2 visible.
**When** the user clicks "Add DEV200 to custom guide" and then the same
Add control again.
**Then** the editor contains one C2 snapshot, its catalog Add control is
pressed, duplicate addition has visible feedback, and the agenda stays empty.

### E2E-021 [P0] Add the intended repeat occurrence
**Given** DEV100 has two times and neither is in the custom guide.
**When** the user selects Day 2026-11-10, searches DEV100, and adds its filtered
card to the guide; repeat independently using the filtered Session brief's Add.
**Then** both entry points create exactly C1b, not C1a; its snapshot dialog
and downloaded event show 2026-11-10 14:00-15:00 UTC. Saving an agenda
occurrence alone must not be treated as choosing a custom-guide occurrence.
In `/saved-time-independent-card` and `/saved-time-independent-dialog`,
first save C1b, reset Day to Any day, then Add from the unfiltered card or brief:
expect a C1a custom snapshot while the agenda stays C1b. In `/duplicate-repeat`,
add C1a, filter to C1b and try Add again: exactly one C1a snapshot and its note
remain; set the first note to `Keep first occurrence.` before the second Add
and assert that exact note afterward. The new occurrence must not replace it.

### E2E-022 [P0] Edit fields, notes, sequence, and remove a step
**Given** G.
**When** the user applies the exact Edited G changes, moves C1b earlier once,
removes CU, awaits persistence, and reloads.
**Then** Edited G persists with numbering 01=C1b, 02=C2 and the exact edited fields,
first/last move controls are disabled at boundaries, CU's catalog Add control
is unpressed, and the agenda is unaffected.

### E2E-023 [P0] Seed from a curated path, including replacement confirmation
**Given** C with an empty draft and Launch fast selected.
**When** the user chooses "Make this path your own"; later, with that nonempty
draft, creates a share URL, changes its title to `Do not replace yet.` and its
DEV100 note to `Keep this edit until confirmed.`, then chooses Nonprofit /
Impact first and first cancels, then confirms replacement.
**Then** the first copy contains its declared session order, earliest occurrences,
and editorial reasons/takeaways; cancel preserves those exact edits; confirm
replaces the draft with Impact first and its single C3 step/editorial note,
not the agenda or the original Launch fast share URL.

### E2E-024 [P0] Blank titles are recoverable local drafts, not shareable guides
**Given** a nonempty custom guide.
**When** the user empties or whitespace-fills its title, reloads, then tries
Create share link; afterwards the user enters a valid title and retries.
**Then** the unfinished title, steps, and notes survive reload; sharing the
blank title produces a visible actionable error and no usable new link;
the corrected guide can be shared without rebuilding its steps.

### E2E-025 [P0] Empty guide and clear confirmation
**Given** a clean draft, and separately G with its existing URL, agenda A, and
F-state created in the same context.
**When** the user examines the empty editor; in the G variant opens Clear
draft and first cancels, then confirms.
**Then** an empty guide cannot share or export; cancel preserves G; confirmation
restores the event's default empty draft, resets Add indicators, survives reload,
and does not clear agenda A or alter the old shared snapshot. Reopen F and
verify its exact saved agenda/draft also survive.

### E2E-026 [P1] Twenty-session limit and recovery
**Given** the extended fixture with 21 unique sessions and an empty draft.
**When** the user adds 20 through the UI, attempts the 21st, removes one,
and then adds the previously rejected session.
**Then** the count never exceeds 20, rejection explains the limit without
replacing a step, and removal permits another unique session to be added.

### E2E-027 [P1] Field limits, Unicode, and literal markup
**Given** a draft and synthetic text including accented characters, emoji,
quotes, commas, backslashes, newlines, and `<img src=x onerror=alert(1)>`.
**When** the user enters boundary-length title/summary/notes, attempts one
character beyond each limit, creates a valid link, and opens it as a recipient.
**Then** UI limits are 100/600/600 JavaScript string units respectively,
tested through actual typing/paste rather than assuming a scripted fill enforces
native maxlength. Summary/note text and newlines round-trip exactly, Unicode
is intact, and markup stays inert visible text without script/dialog/request.
Titles are single-line: surrounding title whitespace may remain in the local
draft but is intentionally trimmed in the shared snapshot. `/title-trim` enters
`  E2E trimmed title  ` and expects recipient title `E2E trimmed title`.
Use ASCII for exact boundary lengths and test Unicode preservation separately.

## D. Sharing and recipient behavior

### E2E-030 [P0] Share URL truly reconstructs the complete guide
**Given** G created by UI in an author context with filters and a theme selected.
**When** the user clicks Create share link and opens the returned URL in
a clean recipient context with no copied browser state.
**Then** the URL uses this event's canonical path, `guide=2...`, and `#my-guide`,
without unrelated search/filter/theme parameters; the shared view shows the
exact title, summary, ordered three sessions, occurrence times, and notes;
each session opens the expected Saved snapshot brief; editor inputs are not
mistaken for the shared view and nothing is automatically saved to the agenda.

### E2E-031 [P0] The Open shared view control opens the actual returned link
**Given** G has a visible generated permalink.
**When** the author uses "Open shared view".
**Then** its popup uses exactly the displayed link and renders G's shared
snapshot; it is not merely another view of the existing editor. The independent
recipient proof is still required by E2E-030.

### E2E-032 [P0] Links are immutable snapshots
**Given** a UI-generated URL U1 for G.
**When** the author changes title, order, note, and membership, creates U2,
and opens both links in clean recipient contexts.
**Then** U1 still shows G, U2 shows exactly the edited guide, and editing hides
the stale share-result panel until a new link is created.

### E2E-033 [P0] Copy link success and denied clipboard
**Given** a generated link and, in separate contexts, allowed and denied
clipboard access.
**When** the user clicks Copy link and then uses the copied or manually selected
permalink in a fresh recipient context.
**Then** the successful clipboard text equals the displayed URL; denial gives
visible manual-copy guidance and a selectable full URL; both URLs reconstruct
the correct guide. Permission denial is not treated as loss of the guide.

### E2E-034 [P0] Viewing and leaving a share preserve the recipient's own draft
**Given** a recipient with exact draft D and agenda A, arranged through UI.
**When** it opens G's URL, then clicks Back to my draft, reloads, and reopens G.
**Then** D and exact agenda A remain unchanged, leaving shared view removes the
`guide` parameter, and reopening the original URL still shows G.

### E2E-035 [P0] Edit a copy does not edit the author's snapshot
**Given** a recipient with exact draft D and agenda A viewing G.
**When** it clicks Edit a copy and cancels replacement; then repeats, confirms,
edits the copy, and generates its own link.
**Then** cancel preserves D and A; confirmation copies G into the recipient's local
draft before editing; the new URL shows the recipient edits, whereas G's URL,
the author's draft, and both agendas remain unchanged.

### E2E-036 [P0] Save a shared guide is explicit and idempotent
**Given** a clean recipient viewing G and, in a second variant, C1a already saved.
**When** it clicks Save available sessions to my agenda twice and reloads.
**Then** after awaiting persistence and reloading in both variants, the clean
variant stores C1b, C2, CU exactly once; the second keeps
its already-chosen C1a rather than adding C1b for the same session, plus C2
and CU; the shared snapshot stays G, and the recipient's custom draft is not
replaced. The header counts saved occurrences, not guide steps.

### E2E-037 [P0] Snapshot export and Save use different data after catalog changes
**Given** G's URL and a prepared current-catalog variant retaining C1b's ID
but changing its title, time, and room.
**When** a fresh recipient opens the old URL, exports its shared calendar,
then saves available sessions and exports its agenda.
**Then** the shared view and shared download retain G's original facts;
the saved agenda and agenda download use the changed current facts;
feedback explains the distinction, and no snapshot is silently rewritten.
For `/persisted-draft`, construct and persist G in the author's context before
switching the served catalog to FX-CHANGED and reloading: all three draft steps
and snapshot briefs retain G's original facts, and draft export still matches
G's original UID/timing/room oracle. For `/edit-copy`, open the original G URL
against FX-CHANGED, confirm Edit a copy, reload, and make the same assertions.
Neither route may silently rebuild snapshots from current listings.

### E2E-038 [P0] Missing shared occurrence is not silently replaced
**Given** G's URL and a catalog variant removing C1b but keeping C1a.
**When** a recipient opens G, downloads its shared calendar, and saves
available sessions.
**Then** G and its calendar still contain the original C1b snapshot;
Save does not substitute C1a, warns that one shared session cannot be saved,
and adds only current C2 and CU. After reload those two agenda entries remain.
For `/persisted-draft`, instead persist G before serving FX-REMOVED and reloading:
the draft, its snapshot briefs, and draft download still retain original C1b.

### E2E-039 [P1] Share opens in the correct event, including root entry
**Given** a real UI-generated F share URL and an existing C draft/agenda.
**When** the recipient opens its token on the site's root, and separately
on C's event path.
**Then** both resolve to F, show that F snapshot, preserve the token/fragment,
and leave C's state unchanged; navigation does not loop.

### E2E-040 [P1] Invalid shared URLs fail safely
**Given** exact draft D/agenda A and LINK-BAD's truncated token, invalid base64,
unsupported version, unavailable event, event-selector/token mismatch, duplicate
session, invalid time range, and bounded-decompression overflow as separate variants.
**When** the user opens each bad URL via the appropriate root or event route.
**Then** a visible route/share error describes the problem, no arbitrary event
or external destination is silently substituted, and existing state is not
overwritten; the user can still reach a usable directory/editor.

### E2E-041 [P1] Oversized share and browser capability failures are recoverable
**Given** a valid high-entropy extended draft exceeding the actual 7,500-character
full URL limit; separately a context without CompressionStream, or a recipient
without DecompressionStream.
**When** the user creates or opens a share link, then reduces the guide or
uses a supported context and retries.
**Then** failures are visible and actionable, no truncated link is offered as
success, editor controls recover from Creating link, the draft remains intact,
and the supported/reduced case succeeds. Highly repetitive text is not an
adequate oversized fixture because it may compress below the limit.

### E2E-042 [P1] Editing during link creation does not publish a stale result
**Given** G and GATE-STREAM delaying the real native compression completion.
**When** the user starts Create share link and changes the title or a note
after the harness confirms compression started, releases the gate, then creates
a new link.
**Then** the first attempt reports that the draft changed instead of exposing
a stale link as current; the second round-trips the latest exact contents,
and the share control is enabled again.

### E2E-043 [P1] A late share decode cannot overwrite a newer view
**Given** a recipient with D and A, two distinct author-UI-generated shares G
and Edited G, GATE-STREAM on decompression, and prepared same-document browser
history for the two URLs after ordinary C boot.
History setup may use the native History API solely to arrange the Given;
push the real G URL and then the real Edited G URL, without calling app handlers
or fabricating data. Back now starts G's decode; Forward targets Edited G.
**When** real Back/Forward starts a gated share decode, the harness observes
started, then the user follows the visible Build your own entry in
`/leave-share`, or visits the other prepared history entry in `/newer-share`;
release the older decode last.
**Then** the newer editor or share remains visible with the latest URL/token,
the local draft is unchanged, and no old result or late error resurrects the
discarded view. `/stale-error` uses a fixed LINK-BAD URL for the older entry;
releasing that failed old operation also cannot clobber the newer successful
share or surface its obsolete error. The ordinary ungated history test is E2E-078.

## E. Calendar downloads and semantic file checks

For every positive export below, apply the **calendar oracle**: the actual
download completes, has a useful `.ics` filename containing the event identity,
and parses as one VCALENDAR with VERSION 2.0 and METHOD PUBLISH. Compare the
exact VEVENT count and UID set, session-code/title SUMMARY, UTC DTSTART/DTEND,
LOCATION, description, speakers, and official catalog notice against the
fixture facts. Require positive durations, stable event identity, no fabricated
unknown times, and no `E2E_NOTE_NOT_FOR_CALENDAR_42`, guide summary, or share token
in event descriptions. Ignore only expected volatile DTSTAMP differences.
Unfold continuation lines before comparing decoded text; separately check
CRLF line endings and folding at 75 UTF-8 bytes without broken Unicode.
Do not assume event order equals guide order: export is chronological.

### E2E-050 [P0] Single-occurrence exports from each entry point
**Given** C2 is available and, for the agenda variant, saved.
**When** the user downloads its Calendar (.ics) from the catalog card,
session dialog, and agenda row in independent runs.
**Then** each actual file contains exactly C2 with the same UID and
15:30-16:15 UTC on 2026-11-10; downloads do not change Save or guide membership.

### E2E-051 [P0] Repeated-session calendar choice exports exactly that time
**Given** DEV100's two occurrences and an empty agenda.
**When** the user clicks Choose calendar time, then the Calendar (.ics)
control scoped to C1b's dialog occurrence.
**Then** the file has exactly C1b on 2026-11-10, not C1a or both times;
the agenda remains empty and no custom guide is created.

### E2E-052 [P0] Built-in path export needs no agenda setup
**Given** Launch fast selected with an empty agenda and draft.
**When** the user clicks the path's Add all 3 sessions to calendar (.ics).
**Then** one download contains exactly C1a, C2, C3 with the earliest
DEV100 occurrence and accurate independent times; agenda/draft remain empty.

### E2E-053 [P0] Custom draft export honors snapshots, not agenda or sequence
**Given** G, an empty agenda, and its order C2/C1b/CU.
**When** the author downloads the draft's guide calendar.
**Then** the file contains only C1b and C2 in chronological order, the calendar
name is G's title, CU is explicitly counted as excluded, and all private
attendance notes are absent. No Save action is required.

### E2E-054 [P0] Fresh recipient can download a complete shared guide
**Given** G's UI-generated URL in a fresh recipient context with no draft
or saved agenda.
**When** the recipient downloads the shared guide calendar.
**Then** it contains precisely the same session facts/UIDs as E2E-053
independently of the author's storage, with no agenda mutation.

### E2E-055 [P0] Agenda export contains only saved scheduled occurrences
**Given** C1b, C2, and CU were saved through UI, but C3 was only added to a draft.
**When** the user clicks Export calendar (.ics).
**Then** `my-contoso-dev-days-2026-agenda.ics` contains exactly C1b and C2,
excludes CU with visible feedback, excludes unsaved C3, and leaves all Save states
unchanged. Removing C2 and re-exporting leaves exactly C1b.

### E2E-056 [P0] No time means no invented calendar entry
**Given** an empty guide/agenda, and separately one containing only CU.
**When** the user examines guide/agenda export and CU's per-session controls.
**Then** no active export can produce an empty or fabricated-timing calendar;
empty/all-unscheduled aggregate export is disabled and the UI explains that
listed start/end times are needed.

### E2E-057 [P1] Display time zone and DST do not change exported instants
**Given** FDST saved or in a custom guide; browser zone Los Angeles.
**When** the user selects event time, My local time, and UTC, exporting at
each setting.
**Then** every file has DTSTART 20270314T073000Z and DTEND 20270314T083000Z;
Chicago displays 01:30-03:30 despite 60 elapsed minutes, and other display
zones change labels/date groups without shifting the event. Independent local
time expectations are March 14 03:30-04:30 in New York, March 13 23:30 to
March 14 00:30 in Los Angeles, and March 14 07:30-08:30 in UTC.

### E2E-058 [P1] Conflicts and repeat UIDs are retained correctly
**Given** an extended conflicting agenda and separately both DEV100 occurrences.
**When** the user exports each selection twice.
**Then** all scheduled conflicts remain present with visible overlap feedback;
same-occurrence UIDs stay stable across re-exports, distinct repeats have
distinct UIDs, and no occurrence is duplicated within a file.

### E2E-059 [P1] Event namespaces prevent cross-event calendar collisions
**Given** UI-downloaded C1a and F1 calendars, which share occurrence ID S100-a.
**When** both real downloads are independently parsed and their UID fields compared.
**Then** the exact UIDs match the pinned C1a/F1 oracle and differ by event
identity. This browser-only case does not require E2E-064 to run or complete;
actual calendar coexistence is separately verified by that client case.

### E2E-060 [P1, client] Escaping, Unicode, and line folding survive download/import
**Given** an extended session with independently recorded comma, semicolon,
backslash, newline, accented/emoji, and long-description values, plus G-like notes.
**When** the user exports it and imports that same file via the calendar client.
**Then** the parsed file and imported appointment preserve the intended visible
text, no characters become extra ICS properties/events, Unicode is intact, and
personal notes are absent; verify the calendar oracle rather than byte equality.

## F. Actual calendar-client imports

These are not satisfied by parsing a file or observing a browser download.
Playwright cannot automate native calendar applications. Outlook web import
is a browser E2E test; Apple Calendar is an explicit manual companion.
Obtain authorization for the dedicated account, create a uniquely named
disposable calendar, record its initial event count, upload the exact artifact
downloaded in the linked app case, and remove the entire disposable calendar
in teardown even if assertions fail. Never send invitations or use a real
team/personal calendar. A missing account/client is a blocked case.

**Independent artifact setup:** no client case depends on an earlier case
passing, sharing a worker/profile, or leaving a file behind. Each case arranges
its input by replaying the linked UI download recipe itself, or by retrieving
a retained artifact from that exact build/fixture/project with verified SHA-256.
Record producer recipe ID/variant, build/diff ID, fixture hash, exact URL used,
download timestamp, filename, checksum, and independent parsed expectations.
Retries use a fresh destination calendar and verified input; do not generate
an `.ics` through the serializer to bypass the app.

**Bounded Outlook verification:** record and pin the supported web client build,
authorized test account/tenant, and actual client display zone. Select only the
named empty test calendar as both import destination and visible calendar.
After confirmation, poll its UI for at most 120 seconds; navigate to the fixture
dates, not today's week, and expand to 24-hour/all-day visibility. Enumerate
appointments across the entire expected file date range plus the adjacent day
on each side, across months/years when necessary. Compare the count delta and
each code/date/time with the pinned oracle, open every appointment, and inspect
title, exact start/end, room, description/speakers/notice, and absence of notes.
An import-success toast, two matching search hits, or one screenshot is not an
exact-count proof. The actual input's parsed event set also rules out extra
off-range events in that file. If the client UI cannot establish count/facts,
mark that assertion Blocked rather than claiming success. Client-side re-export
may corroborate UID/count only if available; it does not replace the UI checks.
Do not repeatedly click import on a timeout; fail, preserve evidence, and clean
up. Confirm the disposable calendar is deleted afterward.

### E2E-061 [P0, client] Import an individual downloaded occurrence
**Given** the completed E2E-051 C1b file, a disposable empty Outlook calendar,
and Outlook's display zone set to America/New_York.
**When** the user uses Outlook's visible Add calendar / Upload from file
workflow, selects that exact file and destination, and confirms import.
**Then** exactly one appointment appears on 2026-11-10 09:00-10:00 local,
with DEV100/Contoso keynote, Hall A, and the expected description/speaker
notice; it is not on November 9 and no invitation is sent.

### E2E-062 [P0, client] Import a custom guide downloaded by its recipient
**Given** the completed E2E-054 file and a new empty Outlook test calendar
set to UTC.
**When** the recipient imports that exact multi-event file through the client UI.
**Then** the calendar gains exactly two appointments: DEV100 on November 10
14:00-15:00 and DEV200 15:30-16:15; no CU, extra duplicate, personal note,
or guide-only summary appears. The app's agenda remains unchanged.

### E2E-063 [P1, client] Import across DST and cancel an import
**Given** the actual FDST file from E2E-057 and an empty Outlook test calendar
set to America/Chicago.
**When** the user first cancels the visible import before confirmation, checks
the calendar, then repeats and confirms.
**Then** cancellation adds nothing; confirmation adds one event on March 14,
2027 at 01:30-03:30 local with 60 elapsed minutes and the expected session facts.

### E2E-064 [P1, client] Different events with the same source ID coexist
**Given** the C1a and F1 artifacts from E2E-059 and a new empty test calendar.
**When** the user imports both files through the visible calendar-client UI.
**Then** both appointments exist at their independently recorded dates/times
and neither is lost or replaced because both source catalogs used S100-a.

### E2E-065 [P2, client] Re-import behavior is characterized, not invented
**Given** C1b's actual file already imported into a disposable calendar.
**When** the user deliberately downloads C1b again from the app, compares both
files' UIDs, then re-imports the original file and records the client's prompts/result.
**Then** the app's two exports have stable UIDs, and the report states whether
this client deduplicates, updates, or duplicates; do not promise client-side
deduplication the app does not control. Unexpected appointments are cleaned up.

### E2E-066 [P2, manual] Native default-calendar handoff
**Given** a test machine with Apple Calendar configured and an isolated calendar.
**When** a tester opens the app-downloaded individual and multi-event `.ics`
files, explicitly confirms the destination/import, and opens the appointments.
**Then** facts, counts, time-zone conversion, and absence of notes match the
linked browser cases. `/individual` uses E2E-051/C1b in New York, `/guide`
uses E2E-054/G in UTC, and `/DST` uses E2E-057/FDST in Chicago. Record the
supported macOS/Calendar version, actual client zone, artifact checksums,
destination cleanup, and manual evidence; never label it a Playwright pass.

## G. Discovery, navigation, and catalog

### E2E-070 [P0] Directory, direct entry, and event selector agree
**Given** clean contexts on the two-event fixture site.
**When** the user reaches C through its directory card, its direct event URL,
and `/?event=contoso-dev-days-2026`.
**Then** all show C's catalog/audiences; the selector route ends at the clean
canonical event path without `event`, and the other contexts' state is untouched.

### E2E-071 [P1] Invalid selectors and repository subpaths
**Given** the `/repo/` preview and, separately, empty, repeated, and unknown
event selectors.
**When** the user follows valid and invalid root links including an unrelated
query value and fragment.
**Then** valid navigation stays under `/repo/`, removes only `event`, preserves
other query/fragment values, and loads CSS/JS/artwork/favicon/catalog; invalid
selectors show an explicit usable error instead of silently opening C or Ignite.

### E2E-072 [P1] Directory search, statuses, and archived access
**Given** the two-event site with browser Date fixed at 2026-11-10 12:00 UTC
without freezing timers.
**When** the user searches for Contoso, Montreal/Montréal, Fabrikam, and a
nonmatch, resets, and opens each event.
**Then** results match the fixture's supported search normalization, nonmatch
has a visible reset path, C is in progress and F is upcoming; at fixed dates
after an event ends, it remains accessible in All events, not deleted.

### E2E-073 [P0] Event dropdown dismissal and ordinary navigation
**Given** C, a closed Switch event dropdown, and F available.
**When** the user opens it, clicks outside, reopens and presses Escape,
reopens and tabs away, then reopens and follows F.
**Then** outside click/focus close it; Escape closes it and restores summary
focus; another click on the summary toggles normally; inside interaction is not
prematurely dismissed; the F link navigates normally with no lingering overlay.
For `/private-state`, start in C's shared G view with explicit `scoutTheme=dark`
and nondefault search/day parameters; follow Switch event to F and, separately,
All events. Only the explicit supported theme may propagate: no `guide`, search,
day, audience, route, or other private view state appears in those destinations.
Reopen C to verify its stored agenda/draft were not changed by navigation.

### E2E-074 [P1] Audience/path selection remains data-driven
**Given** C exposes Startup and Nonprofit, with its documented paths.
**When** the user switches audiences, selects a path, and uses See these
in the catalog.
**Then** the correct audience label, path sequence/reasons, and catalog filter
appear; no Ignite-specific audience or six-step assumption leaks into C.

### E2E-075 [P1] Search and facets combine and reset correctly
**Given** the pinned fixture catalog and the exact E2E-075 match sets above.
**When** the user searches by code/title/speaker, combines topic/format/level/
attendance/day/path facets, changes sort, submits with Enter, and clears filters.
**Then** only matching grouped sessions remain, controls/count/URL agree,
Enter does not reload, nonmatching combinations show an actionable empty state,
and Reset restores default results without changing the agenda or draft.
Run each listed match/sort set from reset state, then exercise the combined
facets; broad "some result exists" assertions are not sufficient.

### E2E-076 [P1] Pagination, repeat grouping, and filtered occurrence choice
**Given** the >9-session extended fixture with known expected sort order and repeats.
**When** the user loads more results, changes a filter, and opens a repeated
session with only one matching occurrence.
**Then** rows are not duplicated, the result/shown counts are exact, a filter
resets pagination, the brief still shows all occurrences with matching-time
indication, and Save/calendar actions target the occurrence the user selects.

### E2E-077 [P1] Copy view link is not a private custom-guide link
**Given** a filtered view with an active audience/path/time zone and optionally
a `guide` token in the current URL.
**When** the user copies the catalog view link and opens it in a fresh context.
**Then** it restores the supported catalog view at `#catalog`, excludes the
guide token/notes, and imports neither the author's agenda nor custom draft.

### E2E-078 [P1] Reload and real browser history restore the right view
**Given** bookmarked filter URLs and two separate navigation history entries,
one showing a shared guide and one showing an editable draft.
**When** the user reloads, follows the second entry, then uses Back and Forward.
**Then** filters/audience/path/time zone, shared/editor visibility, and URL
agree with the visited entry. Deliberately delayed decode interleavings are
separately exercised with the controlled gate in E2E-043, not inferred here.

### E2E-079 [P1] Legacy links still reach Ignite without damaging modern state
**Given** the real-content local preview, fixed legacy root filter links,
a valid version-1 guide artifact, and a newer Ignite draft/agenda.
**When** the user opens those legacy URLs and separately launches with valid
legacy browser storage in an isolated profile.
**Then** routes open Ignite and preserve supported view/share state; compatible
old storage is restored without deleting its original keys or overwriting newer
event-scoped state. The two-event-only fixture build is not sufficient here.

## H. Failure recovery, accessibility, and presentation

### E2E-080 [P1] Failed catalog request can be retried without losing data
**Given** exact draft D and agenda A and an intercepted failed catalog request,
then separately failed manifest or invalid catalog responses.
**When** the user opens the event, sees the error, restores the response,
and clicks Try again.
**Then** the failure is explicit; retry restores the intended event and stored
state with no duplicate filter options or handlers; the event switcher still
opens/closes even before catalog recovery.

### E2E-081 [P1] Directory enhancement failures leave static links usable
**Given** a failed manifest request, and separately JavaScript disabled.
**When** the user opens the directory and follows its static C link.
**Then** the directory remains navigable; a failed enhancement has visible
feedback, while an event page without JavaScript explains its requirement and
links to the official catalog rather than presenting working search/Save.

### E2E-082 [P0] Denied/quota-failed storage never claims durable saving
**Given** an isolated context where localStorage access or writes fail.
**When** the user saves C2, edits a guide, and creates a share link if the
browser still supports it.
**Then** a visible warning explains that state is not persistent and suggests
keeping a share link; the current UI remains usable, the valid URL independently
opens the draft snapshot, and a later reload is not reported as durable recovery.

### E2E-083 [P1] Corrupt or obsolete storage is visible and contained
**Given** invalid agenda JSON, invalid draft JSON, a wrong-event draft, and a
saved occurrence absent from the current catalog in separate contexts.
Arrange D as the valid counterpart when corrupting the agenda, A when corrupting
the draft, and F-state in all variants; the removed-occurrence variant starts
with A then serves FX-REMOVED.
**When** the user opens the affected event, then explicitly saves C3 in agenda
variants or builds a one-step C3 draft after a draft failure, titled
`Recovered plan`, summary `Recovered.`, note `C3 recovery note.`.
**Then** visible warnings describe unreadable/removed state, unaffected data
and other events remain intact, and valid new actions recover without silently
rewriting an existing shared link. Reload to verify the new valid state and
the untouched counterpart/F-state; FX-REMOVED initially restores only C2/CU
from A and warns that C1b was removed, then explicit Save adds C3 for count
three. Corrupt agenda JSON followed by Save instead recovers just C3.

### E2E-084 [P1] Keyboard-only primary journey and modal dismissal
**Given** a clean event page without a mouse.
**When** the user follows Skip to content, navigates the switcher, opens/closes
a session brief, saves a time, edits/reorders a draft, cancels a destructive
dialog, and creates a share link using keyboard controls.
**Then** controls have meaningful accessible names, focus is visible,
modal focus is contained while open, Escape/Close work, and focus can resume
the intended workflow; validation/Save/empty states are announced through status
or alert regions rather than being color-only.

### E2E-085 [P1] Compact branding and functional responsive layouts
**Given** the specified desktop/mobile widths in both themes.
**When** the user views directory, event header, dropdown, editor, dialog,
shared guide, and agenda, including at 200% zoom.
**Then** Microsoft Events Guide and smaller DevEx attribution remain readable,
the phoenix favicon loads, the removed tagline is absent, no horizontal overflow
or overlap hides controls, and Save/export/share remain operable. Theme changes
preserve the current event/view and supported navigation links.

### E2E-086 [P1] Repeated exports and slow operations remain usable
**Given** G and an independently saved agenda.
**When** the user exports twice sequentially, then creates a share while
interacting with other non-destructive controls; separately reload under a
slow catalog-response profile before attempting actions once the app is ready.
**Then** each deliberate export yields one complete file, no stale/empty object
URL is downloaded, export does not mutate data, and sharing either completes
for the unchanged draft or reports the explicit changed-draft outcome.
Network throttling is not claimed to delay local compression/decompression;
the actual race controls are GATE-STREAM in E2E-042/043.

### E2E-087 [P1] Local testing does not accidentally enable hosted analytics
**Given** the normal local and fixture previews without telemetry build settings,
with a context-level request observer installed before navigation.
**When** the user navigates, searches, saves, downloads, creates/opens a share,
and switches events.
**Then** no Application Insights ingestion request or consent banner appears,
including attempted/blocked requests. Keep observation active through all
actions, navigation away, and page close; blocking a domain alone is not proof
that a send was never attempted. The disabled build configuration is supporting
evidence. Blocking analytics must not break flows; this does not claim that
production telemetry is disabled.

### E2E-088 [P2] Multiple tabs do not imply live collaboration
**Given** two pages in the same context/event with a saved draft in the first.
**When** the second reloads, reads it, and then sequentially edits it before
the first reloads.
**Then** the reloaded pages show the last completed persisted edit; do not
assert live cross-tab updates or conflict merging that the app does not promise.
Any storage-coordination warning must be visible rather than swallowed.

### E2E-089 [P1] Delayed durable writes retain the final user state
**Given** C fully booted with empty agenda and a one-step C2 draft arranged
through UI and durably persisted before GATE-LOCK is acquired.
**When** the user rapidly saves C2, unsaves it, saves it again, and successively
types `Earlier locked title` then `Latest locked title`, and C2's note
`Earlier locked note` then `Latest locked note`, while the real write lock is held;
release the lock, poll the final expected storage state, then reload.
**Then** only C2 is saved, count one, and the one-step draft restores only
`Latest locked title` and `Latest locked note`. Intermediate writes do not
replace the final edit. While the gate is
held, a deliberately attempted navigation may show the expected unsaved-change
prompt; cancel that navigation, release the lock, and require normal durability
before the final reload. Capture that prompt rather than globally auto-accepting
unexpected beforeunload dialogs in other cases.

## Event registration

### E2E-090 [P0] Event registration is distinct from agenda saving and seat reservations
**Given** C has `registrationUrl: https://example.com/contoso-dev-days/register`
and F omits it.
**When** a user opens C's registration link.
**Then** the exact configured URL opens in a new tab without a referrer, private
view-state parameters, or changes to the local agenda/draft. This link is not a
session-seat reservation or proof of registration.

The compact registration button precedes "Switch event" in the sticky event header.
A separate visible reminder below the hero links to the official registration
website and states that saving sessions does not register attendees or reserve
session seats. The reminder is not hidden as screen-reader-only text.
The header button remains in the viewport after
choosing a journey, with the guide heading below the header rather than obscured.
Desktop guide cards remain fully visible on initial opening at a 900px height.
F has no registration control. C's link remains usable without JavaScript or when
catalog loading fails. After C's event-local end date, the CTA offers registration
details and notes the event has ended, without inventing a registration-closed
state. The external URL stays unchanged under `/repo/`. The `/real/` Ignite page
uses `https://aka.ms/MSIgniteFY27RegNow`. Browser tests mock only the known fixture
destination; they never submit a registration or visit the real booking service.

## Completion and reporting

Create one result row per case and required browser/variant, with status
Not run / Pass / Fail / Blocked, artifact references, and a precise reason.
The files in this change specify coverage; they do not prove execution.
Before a later release, require every P0 case/variant in every project listing
it to pass, including the actual Outlook P0 imports, or obtain an explicit
documented exception naming the case/project/variant and risk owner. Blocked
P0s do not satisfy that gate. Require a disposition for every P1 failure/blocked
row; P2 results are compatibility characterization, not invented guarantees.
Classify unavailable fixture/client prerequisites separately from app defects.
Any deviation between these expectations and the app must be reported and
triaged, not hidden by weakening assertions to match a bug.

The independent review is recorded in `reviews/e2e-tests-critique.txt`. Preserve its
original findings and append dispositions after revising this specification.
