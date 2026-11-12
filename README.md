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

Optional analytics is disabled by default and consent-gated when enabled; see [PRIVACY](PRIVACY).

## Maintainer reference

See [Project design and event authoring](docs/design.md) for the expected project structure, adding events, and deployment configuration.
