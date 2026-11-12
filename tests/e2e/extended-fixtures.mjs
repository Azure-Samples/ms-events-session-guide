import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceContent = join(root, 'tests/fixtures/content');
const generatedRoot = join(root, 'test-results/e2e-extended');
export const EXTENDED_PATH = '/extended/events/contoso-dev-days-2026/';
export const EXTENDED_TOPIC = 'Extended pagination';
export const LIMIT_CODES = Object.freeze([
  'X001', 'X002', 'X003', 'X004', 'X005', 'X006', 'X007', 'X008',
  'X009', 'X010', 'X011', 'X012', 'X013', 'X014', 'X015', 'X016',
  'X017', 'X018', 'X019', 'X020', 'X021', 'X022', 'X023', 'X024',
]);

const common = {
  speakers: 'Fixture Speaker', type: 'Breakout', level: 'Intermediate (200)',
  delivery: ['In-person'], audiences: ['Developers'], viewing: ['In-person'],
  location: 'Hall A',
};

// Literal expectations are independent of Hugo normalization and the app serializer.
export const EXTENDED_FACTS = Object.freeze({
  overlap: {
    ...common, id: 'S500-a', sessionId: 'S500', code: 'DEV500', title: 'Overlap control',
    description: 'Overlap control', topics: ['Apps'],
    start: '2026-11-10T14:30:00Z', end: '2026-11-10T15:30:00Z', duration: 60,
  },
  boundary: {
    ...common, id: 'S600-a', sessionId: 'S600', code: 'DEV600', title: 'Boundary control',
    description: 'Boundary control', topics: ['Apps'],
    start: '2026-11-10T15:00:00Z', end: '2026-11-10T15:30:00Z', duration: 30,
  },
  text: {
    ...common, id: 'TEXT900-a', sessionId: 'TEXT900', code: 'TXT900',
    title: 'Café, code; paths \\ 東京 🚀',
    description: 'Comma, semicolon; backslash \\ and café 東京 🚀.\nSecond line: ' +
      'Montréal naïve résumé 東京 🚀; slash \\ comma, '.repeat(12) +
      '\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:This must stay description text.',
    speakers: 'Zoë, 李雷; Renée \\ Dev',
    location: 'Room, Nord; aile \\ 東京 🚀',
    topics: ['Text escaping'],
    start: '2026-11-12T12:00:00Z', end: '2026-11-12T12:45:00Z', duration: 45,
  },
});

export const LIMIT_FACTS = Object.freeze(LIMIT_CODES.map((code, index) => ({
  ...common, id: `${code}-a`, sessionId: code, code, title: `Extended session ${code}`,
  description: `Pagination fixture ${code}.`, topics: [EXTENDED_TOPIC],
  start: `2026-11-11T${String(8 + Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 15).padStart(2, '0')}:00Z`,
  end: `2026-11-11T${String(8 + Math.floor((index + 1) / 4)).padStart(2, '0')}:${String((index + 1) % 4 * 15).padStart(2, '0')}:00Z`,
  duration: 15,
})));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const htmlText = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function fileHashes(directory) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push({ path: relative(directory, path).split('\\').join('/'), sha256: sha256(await readFile(path)) });
    }
  }
  await visit(directory);
  return files;
}

/**
 * Called once by server.mjs before Hugo starts.
 * Returns absolute { configPath, contentDir, manifestPath, manifest }.
 * Build with --config hugo.toml,<configPath> --baseURL http://127.0.0.1:1414/extended/.
 */
export async function prepareExtendedFixtures() {
  const contentDir = join(generatedRoot, 'content');
  const configPath = join(generatedRoot, 'hugo.toml');
  const manifestPath = join(generatedRoot, 'manifest.json');
  await mkdir(generatedRoot, { recursive: true });
  await rm(contentDir, { recursive: true, force: true });
  await cp(sourceContent, contentDir, { recursive: true, force: true });
  const catalogPath = join(contentDir, 'events/contoso-dev-days-2026/catalog.json');
  const source = JSON.parse(await readFile(catalogPath, 'utf8'));
  const template = source.find((item) => item.sessionInstanceId === 'S200-a');
  if (!template || source.length !== 5) throw new Error('Extended fixture requires the pinned five-record Contoso raw source.');

  const records = [...source];
  for (const fact of [...Object.values(EXTENDED_FACTS), ...LIMIT_FACTS]) {
    records.push({
      ...structuredClone(template),
      sessionId: fact.sessionId, sessionInstanceId: fact.id, sessionCode: fact.code,
      title: fact.title, description: htmlText(fact.description), speakerNames: fact.speakers,
      topic: fact.topics.map((displayValue) => ({ displayValue })),
      startDateTime: fact.start, endDateTime: fact.end, durationInMinutes: fact.duration,
      location: { displayValue: fact.location },
    });
  }
  await writeFile(catalogPath, `${JSON.stringify(records, null, 2)}\n`);
  const config = [
    'title = "Events Guide (extended fixture preview)"',
    `contentDir = ${JSON.stringify(contentDir)}`,
    '', '[params]', 'fixturePreview = true', '',
  ].join('\n');
  await writeFile(configPath, config);
  const originalFiles = await fileHashes(sourceContent);
  const generatedFiles = await fileHashes(contentDir);
  const manifest = {
    version: 1, prefix: '/extended/', eventPath: EXTENDED_PATH,
    sourceFiles: originalFiles, sourceSha256: sha256(JSON.stringify(originalFiles)),
    generatedFiles, generatedSha256: sha256(JSON.stringify(generatedFiles)),
    generatorSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    configSha256: sha256(config),
    expected: {
      uniqueSessions: 31, occurrences: 32, limitCodes: LIMIT_CODES,
      paginationPages: [LIMIT_CODES.slice(0, 9), LIMIT_CODES.slice(9, 18), LIMIT_CODES.slice(18)],
      addedFacts: [...Object.values(EXTENDED_FACTS), ...LIMIT_FACTS],
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { configPath, contentDir, manifestPath, manifest };
}
