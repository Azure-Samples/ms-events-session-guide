import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { prepareExtendedFixtures } from "./extended-fixtures.mjs";
import { LONG_PREFIX } from "./site-paths.mjs";

const tier = process.env.E2E_TIER || "full";
if (!["smoke", "full"].includes(tier)) throw new Error(`Unknown E2E tier: ${tier}`);
const artifactPrefix = tier === "smoke" ? "e2e-smoke" : "e2e";
const root = resolve(`test-results/${artifactPrefix}-site`);
const env = {
  ...process.env,
  HUGO_TELEMETRY_ENABLED: "false",
  HUGO_RESOURCEDIR: resolve(`test-results/${artifactPrefix}-resources`),
};
await mkdir("test-results", { recursive: true });
const extended = tier === "full" ? await prepareExtendedFixtures() : null;
const sitePrefixes = tier === "smoke" ? [""] : ["", "repo", "extended", "real", "long-site"];
for (const prefix of sitePrefixes) {
  const config = prefix === "extended" ? `hugo.toml,${extended.configPath}` :
    prefix === "real" ? "hugo.toml" : "hugo.toml,tests/fixtures/hugo.toml";
  const basePath = prefix === "long-site" ? LONG_PREFIX : `/${prefix ? `${prefix}/` : ""}`;
  execFileSync("hugo", [
    "--config", config,
    "--baseURL", `http://127.0.0.1:1414${basePath}`,
    "--destination", resolve(root, prefix),
    "--cacheDir", resolve(`test-results/${artifactPrefix}-cache`),
    "--cleanDestinationDir", "--quiet",
  ], { env, stdio: "inherit" });
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fileHashes(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fileHashes(path));
    else if (entry.isFile()) files.push({ path: relative(process.cwd(), path), sha256: hash(await readFile(path)) });
  }
  return files;
}
const siteFiles = await fileHashes(root);
const testSources = await fileHashes(resolve("tests/e2e"));
for (const path of ["playwright.config.mjs", "playwright.smoke.config.mjs", "package.json", "package-lock.json", "hugo.toml", "tests/fixtures/hugo.toml"]) {
  testSources.push({ path, sha256: hash(await readFile(path)) });
}
await writeFile(`test-results/${artifactPrefix}-site-manifest.json`, JSON.stringify(siteFiles, null, 2));
await writeFile(`test-results/${artifactPrefix}-source-manifest.json`, JSON.stringify(testSources, null, 2));
await writeFile(`test-results/${artifactPrefix}-build.json`, JSON.stringify({
  tier,
  sitePrefixes,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedDiffSha256: hash(execFileSync("git", ["diff", "HEAD"])),
  fixtureSha256: hash(Buffer.concat(await Promise.all(
    ["contoso-dev-days-2026", "fabrikam-summit-2027"].flatMap((event) =>
      ["index.md", "catalog.json", "guides.json"].map((file) =>
        readFile(`tests/fixtures/content/events/${event}/${file}`))),
  ))),
  builtAt: new Date().toISOString(),
  telemetryEnabled: false,
  extendedFixtureSha256: extended?.manifest.generatedSha256,
  builtSiteSha256: hash(JSON.stringify(siteFiles)),
  testSourcesSha256: hash(JSON.stringify(testSources)),
}, null, 2));
const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".txt": "text/plain",
};
createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    // Serve the genuine long-baseURL build without creating OS-overlong disk paths.
    if (tier === "full" && pathname.startsWith(LONG_PREFIX)) pathname = `/long-site/${pathname.slice(LONG_PREFIX.length)}`;
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const bytes = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    }).end(bytes);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") response.writeHead(404).end();
    else {
      console.error(error);
      response.writeHead(500).end();
    }
  }
}).listen(1414, "127.0.0.1");
