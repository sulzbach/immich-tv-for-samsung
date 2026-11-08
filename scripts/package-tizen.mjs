import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { loadTizenEnv, requireTizenEnv } from "./tizen-env.mjs";

const runtimeFiles = [
  "config.xml",
  "assets/app-background.jpg",
  "assets/immich-tv-logo.png",
  "assets/keep-awake.mp4",
  "index.html",
  "icon.png",
  "styles/main.css",
  "scripts/install-preset.js",
  "scripts/main.js"
];

const root = process.cwd();
const runtimeRoot = resolve(root, "dist");
const stageDir = resolve(root, ".tizen", "package-src");
const buildResultDir = resolve(stageDir, ".buildResult");
const packagePath = resolve(buildResultDir, "ImmichTV.wgt");
const stageOnly = process.argv.includes("--stage-only");
// An unsigned package for beta testers, who sign it for their own TV when
// they install it (Apps2Samsung or Tizen Studio; docs/beta-testing.md). It
// holds the same runtime files and no signature, so it carries no
// certificate, email address or device ID:
//   npm run tizen:package:unsigned
const unsigned = process.argv.includes("--unsigned");
const releaseDir = resolve(root, ".tizen", "release");
const tizenCli =
  process.env.TIZEN_CLI || resolve(homedir(), "tizen-studio", "tools", "ide", "bin", "tizen");

async function copyRuntimeFiles(fromDir, toDir) {
  for (const file of runtimeFiles) {
    const source = resolve(fromDir, file);
    const destination = resolve(toDir, file);

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function stageRuntimeFiles() {
  await rm(stageDir, { force: true, recursive: true });
  await copyRuntimeFiles(runtimeRoot, stageDir);

  console.log(`Staged ${runtimeFiles.length} runtime files in ${stageDir}`);
}

function run(command, args, { cwd = root } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${basename(command)} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function normalizePackageFilename() {
  const files = await readdir(buildResultDir);
  const generatedPackage = files.find((file) => file.endsWith(".wgt"));

  if (!generatedPackage) {
    throw new Error(`No .wgt package found in ${buildResultDir}`);
  }

  const generatedPackagePath = resolve(buildResultDir, generatedPackage);

  if (generatedPackagePath !== packagePath) {
    await rm(packagePath, { force: true, recursive: true });
    await rename(generatedPackagePath, packagePath);
  }

  await access(packagePath);
}

async function readAppVersion() {
  const configXml = await readFile(resolve(stageDir, "config.xml"), "utf8");
  const version = /<widget[^>]*\sversion="(\d+\.\d+\.\d+)"/.exec(configXml);

  if (!version) {
    throw new Error("config.xml has no x.y.z widget version.");
  }

  return version[1];
}

async function packageUnsigned() {
  const unsignedPath = resolve(releaseDir, `ImmichTV-${await readAppVersion()}-unsigned.wgt`);

  await mkdir(releaseDir, { recursive: true });
  await rm(unsignedPath, { force: true });
  // -X leaves out extra file attributes; the list keeps the order fixed.
  await run("zip", ["-X", "-q", unsignedPath, ...runtimeFiles], { cwd: stageDir });

  console.log(`Unsigned package ready: ${unsignedPath}`);
}

async function main() {
  await stageRuntimeFiles();

  if (stageOnly) {
    return;
  }

  if (unsigned) {
    await packageUnsigned();
    return;
  }

  loadTizenEnv(root);
  const { TIZEN_CERT_PROFILE: profile } = requireTizenEnv(["TIZEN_CERT_PROFILE"]);

  // `tizen build-web` is not used: dist/ is already bundled and minified, so
  // all it would do is copy the staged files into .buildResult. It also
  // crashes on a Tizen Studio install that has only the Web CLI (no IDE),
  // with NoClassDefFoundError: org/eclipse/core/runtime/Plugin. Copying the
  // same runtime files gives `tizen package` the same input on every install.
  await copyRuntimeFiles(stageDir, buildResultDir);
  await run(tizenCli, [
    "package",
    "-t",
    "wgt",
    "-s",
    profile,
    "-o",
    buildResultDir,
    "--",
    buildResultDir
  ]);
  await normalizePackageFilename();

  console.log(`Package ready: ${packagePath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
