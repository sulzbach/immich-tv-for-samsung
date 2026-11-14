import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as esbuild from "esbuild";
import { appBundleOptions, readDistribution } from "./build-options.mjs";

const root = process.cwd();
const distDir = resolve(root, "dist");
// Production builds are minified. An unminified debug build keeps readable
// names and line structure for diagnosis in the TV's Web Inspector:
//   npm run build:debug
//   IMMICH_TV_DEBUG_BUILD=1 npm run tizen:deploy
const debugBuild = process.argv.includes("--debug") || process.env.IMMICH_TV_DEBUG_BUILD === "1";
// Sideload unless a store build is asked for (build-options.mjs, ADR 0021):
//   npm run build:store
//   IMMICH_TV_DISTRIBUTION=store npm run tizen:package
const distribution = readDistribution();
const copiedRuntimeFiles = [
  "config.xml",
  "assets/app-background.jpg",
  "assets/immich-tv-logo.png",
  "assets/keep-awake.mp4",
  "index.html",
  "icon.png",
  "styles/main.css",
  "scripts/dev-preview.js",
  "scripts/install-preset.js",
  "service/ambient-on-power-on.js"
];

async function copyRuntimeFile(file) {
  const source = resolve(root, file);
  const destination = resolve(distDir, file);

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function main() {
  await rm(distDir, { force: true, recursive: true });
  await mkdir(resolve(distDir, "scripts"), { recursive: true });
  await mkdir(resolve(distDir, "service"), { recursive: true });

  await esbuild.build(appBundleOptions(root, { debug: debugBuild, distribution }));

  await Promise.all(copiedRuntimeFiles.map(copyRuntimeFile));

  console.log(
    `Built Samsung TV runtime (${distribution}, ${debugBuild ? "debug, unminified" : "minified"}) in ${distDir}`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
