import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readDistribution, tipLinkPattern } from "./build-options.mjs";

const requiredFiles = [
  "config.xml",
  "index.html",
  "icon.png",
  "styles/main.css",
  "scripts/install-preset.js",
  "scripts/main.js",
  "service/ambient-on-power-on.js"
];

const failures = [];
const runtimeRoot = resolve(process.cwd(), "dist");

for (const file of requiredFiles) {
  try {
    await access(resolve(runtimeRoot, file));
  } catch {
    failures.push(`Missing required runtime file: dist/${file}`);
  }
}

const configXml = await readFile(resolve(runtimeRoot, "config.xml"), "utf8");
const indexHtml = await readFile(resolve(runtimeRoot, "index.html"), "utf8");

if (!configXml.includes('required_version="5.0"')) {
  failures.push('config.xml should target Tizen required_version="5.0".');
}

if (!configXml.includes('<content src="index.html"')) {
  failures.push("config.xml should launch index.html.");
}

if (!configXml.includes('<access origin="*" subdomains="true"')) {
  failures.push("config.xml should allow outbound Immich API requests.");
}

if (!configXml.includes("http://tizen.org/privilege/internet")) {
  failures.push("config.xml should declare the Tizen internet privilege.");
}

for (const asset of ["styles/main.css", "scripts/main.js"]) {
  if (!indexHtml.includes(asset)) {
    failures.push(`index.html should reference ${asset}.`);
  }
}

// Samsung's documented tag for the Product APIs (AppCommon screensaver
// control), loaded before the app so webapis exists when it starts.
const webapisIndex = indexHtml.indexOf('<script src="$WEBAPIS/webapis/webapis.js"></script>');

if (webapisIndex < 0 || webapisIndex > indexHtml.indexOf('<script src="scripts/main.js">')) {
  failures.push("index.html should load $WEBAPIS/webapis/webapis.js before scripts/main.js.");
}

// The installer's connection details (ADR 0022) are read when the app starts,
// so their script loads first. Apps2Samsung's catalogue entry
// (packages/rfsmason__immich-tv-for-samsung.json in
// Apps2Samsung/tizen-community-packages) fills them in by finding these exact
// lines, and its installs fail if they are missing.
const installPresetIndex = indexHtml.indexOf('<script src="scripts/install-preset.js"></script>');

if (
  installPresetIndex < 0 ||
  installPresetIndex > indexHtml.indexOf('<script src="scripts/main.js">')
) {
  failures.push("index.html should load scripts/install-preset.js before scripts/main.js.");
}

const installPreset = await readFile(resolve(runtimeRoot, "scripts/install-preset.js"), "utf8");

for (const placeholder of ['serverUrl: ""', 'apiKey: ""']) {
  if (installPreset.split(placeholder).length !== 2) {
    failures.push(`scripts/install-preset.js should contain ${placeholder} exactly once.`);
  }
}

if (indexHtml.includes("scripts/dev-preview.js")) {
  failures.push("index.html must not load the desktop-only preview script.");
}

try {
  await access(resolve(runtimeRoot, "src"));
  failures.push("dist must not include TypeScript source files.");
} catch {
  // Expected: source files are not part of the packaged runtime.
}

try {
  await access(resolve(runtimeRoot, "node_modules"));
  failures.push("dist must not include node_modules.");
} catch {
  // Expected: dependencies are bundled or excluded.
}

try {
  const scriptFiles = await readdir(resolve(runtimeRoot, "scripts"));

  if (scriptFiles.some((file) => file.endsWith(".map"))) {
    failures.push("dist must not include sourcemaps.");
  }
} catch {
  failures.push("Unable to inspect dist/scripts.");
}

// An explicit file allowlist rejects capture output, Playwright, credentials,
// source files and any future tooling accidentally copied into dist. The
// desktop preview script is the sole permitted development file; packaging
// separately stages its ten-file production allowlist.
const allowedFiles = new Set([
  ...requiredFiles,
  "assets/app-background.jpg",
  "assets/immich-tv-logo.png",
  "assets/keep-awake.mp4",
  "scripts/dev-preview.js"
]);
async function inspectFiles(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      await inspectFiles(resolve(directory, entry.name), relative + "/");
    } else if (!entry.isFile() || !allowedFiles.has(relative)) {
      failures.push(`Unexpected runtime file: ${relative}`);
    }
  }
}
await inspectFiles(runtimeRoot);
const bundle = await readFile(resolve(runtimeRoot, "scripts/main.js"), "utf8");
if (/playwright|CAPTURE_IMMICH_|scripts\/capture|captures\//i.test(bundle)) {
  failures.push("Capture tooling must not be bundled into the Tizen application.");
}

// A store build carries no tip link (ADR 0021): nothing in dist, or in the
// package staging that stage:tizen and tizen:package create, may mention it.
// Run as `IMMICH_TV_DISTRIBUTION=store npm run check` (or this script with --store).
async function findTipLinks(directory, prefix) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relative = `${prefix}/${entry.name}`;
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      await findTipLinks(path, relative);
    } else if (tipLinkPattern.test(await readFile(path, "latin1"))) {
      failures.push(`A store build must not mention the tip page: ${relative}`);
    }
  }
}

if (readDistribution() === "store") {
  await findTipLinks(runtimeRoot, "dist");
  await findTipLinks(resolve(process.cwd(), ".tizen", "package-src"), ".tizen/package-src");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }

  process.exit(1);
}

console.log(`Static Tizen app checks passed (${readDistribution()} build).`);
