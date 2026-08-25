import { readFileSync, writeFileSync } from "node:fs";

const DESKTOP_PACKAGE_NAME = "clientadvance-desktop";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const tauriConfigPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const cargoTomlPath = new URL("../src-tauri/Cargo.toml", import.meta.url);
const cargoLockPath = new URL("../src-tauri/Cargo.lock", import.meta.url);

function findStringFields(content, fieldName) {
  const pattern = new RegExp(
    `^([ \\t]*${fieldName}[ \\t]*=[ \\t]*)"([^"\\r\\n]*)"([ \\t]*(?:#.*)?)$`,
    "gm",
  );

  return [...content.matchAll(pattern)];
}

function replaceStringField(content, match, value) {
  return (
    content.slice(0, match.index) +
    `${match[1]}"${value}"${match[3]}` +
    content.slice(match.index + match[0].length)
  );
}

function synchronizeCargoToml(content, version) {
  const packageHeaders = [
    ...content.matchAll(/^[ \t]*\[package\][ \t]*(?:#.*)?$/gm),
  ];

  if (packageHeaders.length !== 1) {
    throw new Error("Cargo.toml must contain exactly one [package] section.");
  }

  const packageHeader = packageHeaders[0];
  const sectionStart = packageHeader.index + packageHeader[0].length;
  const followingContent = content.slice(sectionStart);
  const nextSection = /^[ \t]*\[\[?[^\r\n]+\]\]?[ \t]*(?:#.*)?$/m.exec(
    followingContent,
  );
  const sectionEnd = nextSection
    ? sectionStart + nextSection.index
    : content.length;
  const packageSection = content.slice(sectionStart, sectionEnd);
  const nameFields = findStringFields(packageSection, "name");
  const versionFields = findStringFields(packageSection, "version");

  if (
    nameFields.length !== 1 ||
    nameFields[0][2] !== DESKTOP_PACKAGE_NAME
  ) {
    throw new Error(
      `Cargo.toml [package] must uniquely identify ${DESKTOP_PACKAGE_NAME}.`,
    );
  }

  if (versionFields.length !== 1) {
    throw new Error(
      "Cargo.toml [package] must contain exactly one version field.",
    );
  }

  const updatedSection = replaceStringField(
    packageSection,
    versionFields[0],
    version,
  );

  return (
    content.slice(0, sectionStart) +
    updatedSection +
    content.slice(sectionEnd)
  );
}

function synchronizeCargoLock(content, version) {
  const packageHeaders = [
    ...content.matchAll(/^[ \t]*\[\[package\]\][ \t]*(?:#.*)?$/gm),
  ];

  if (packageHeaders.length === 0) {
    throw new Error("Cargo.lock does not contain any [[package]] blocks.");
  }

  const targetBlocks = [];

  for (let index = 0; index < packageHeaders.length; index += 1) {
    const blockStart = packageHeaders[index].index;
    const blockEnd = packageHeaders[index + 1]?.index ?? content.length;
    const block = content.slice(blockStart, blockEnd);
    const nameFields = findStringFields(block, "name");

    if (nameFields.some((field) => field[2] === DESKTOP_PACKAGE_NAME)) {
      targetBlocks.push({ block, blockStart, blockEnd, nameFields });
    }
  }

  if (targetBlocks.length !== 1) {
    throw new Error(
      `Cargo.lock must contain exactly one ${DESKTOP_PACKAGE_NAME} package block.`,
    );
  }

  const targetBlock = targetBlocks[0];

  if (
    targetBlock.nameFields.length !== 1 ||
    targetBlock.nameFields[0][2] !== DESKTOP_PACKAGE_NAME
  ) {
    throw new Error(
      `Cargo.lock package block must uniquely identify ${DESKTOP_PACKAGE_NAME}.`,
    );
  }

  const versionFields = findStringFields(targetBlock.block, "version");

  if (versionFields.length !== 1) {
    throw new Error(
      `Cargo.lock ${DESKTOP_PACKAGE_NAME} block must contain exactly one version field.`,
    );
  }

  const updatedBlock = replaceStringField(
    targetBlock.block,
    versionFields[0],
    version,
  );

  return (
    content.slice(0, targetBlock.blockStart) +
    updatedBlock +
    content.slice(targetBlock.blockEnd)
  );
}

const tauriConfigContent = readFileSync(tauriConfigPath, "utf8");
const cargoTomlContent = readFileSync(cargoTomlPath, "utf8");
const cargoLockContent = readFileSync(cargoLockPath, "utf8");

let tauriConfig;

try {
  tauriConfig = JSON.parse(tauriConfigContent);
} catch {
  throw new Error("src-tauri/tauri.conf.json contains invalid JSON.");
}

const desktopVersion = tauriConfig?.version;

if (typeof desktopVersion !== "string" || !SEMVER_PATTERN.test(desktopVersion)) {
  throw new Error(
    "src-tauri/tauri.conf.json must contain a valid semantic version.",
  );
}

const updatedCargoToml = synchronizeCargoToml(
  cargoTomlContent,
  desktopVersion,
);
const updatedCargoLock = synchronizeCargoLock(
  cargoLockContent,
  desktopVersion,
);

if (updatedCargoToml !== cargoTomlContent) {
  writeFileSync(cargoTomlPath, updatedCargoToml, "utf8");
}

if (updatedCargoLock !== cargoLockContent) {
  writeFileSync(cargoLockPath, updatedCargoLock, "utf8");
}

console.log(`Desktop version synchronized: ${desktopVersion}`);
