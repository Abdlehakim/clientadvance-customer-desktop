import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist");
const manifestPath = path.join(distDir, ".vite", "manifest.json");
const outputPath = path.join(distDir, "index.html");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const preferredEntry =
  manifest["src/main.tsx"] && manifest["src/main.tsx"]?.isEntry
    ? ["src/main.tsx", manifest["src/main.tsx"]]
    : null;

const entry = preferredEntry ?? Object.entries(manifest).find(
  ([, item]) => item?.isEntry && typeof item.file === "string",
);

if (!entry) {
  throw new Error("Unable to find the client entry in dist/.vite/manifest.json.");
}

const [entryKey, entryInfo] = entry;

if (typeof entryInfo.file !== "string") {
  throw new Error(`Manifest entry ${entryKey} does not point to a client bundle file.`);
}

const preloadLinks = (entryInfo.imports ?? [])
  .map((key) => manifest[key]?.file)
  .filter((file) => typeof file === "string")
  .map((file) => `    <link rel="modulepreload" href="./${file}">`)
  .join("\n");

const stylesheetFiles = [
  ...(entryInfo.css ?? []),
  ...((entryInfo.assets ?? []).filter(
    (file) => typeof file === "string" && file.endsWith(".css"),
  )),
];

const stylesheetLinks = stylesheetFiles
  .map((file) => `    <link rel="stylesheet" href="./${file}">`)
  .join("\n");

const html = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8">',
  '    <meta name="viewport" content="width=device-width, initial-scale=1">',
  "    <title>ClientAdvans</title>",
  '    <meta name="description" content="Application de gestion des clients et paiements avec synchronisation hors ligne.">',
  '    <meta name="author" content="Lovable">',
  '    <meta property="og:title" content="Lovable App">',
  '    <meta property="og:description" content="Lovable Generated Project">',
  '    <meta property="og:type" content="website">',
  '    <meta name="twitter:card" content="summary">',
  '    <meta name="twitter:site" content="@Lovable">',
  preloadLinks,
  stylesheetLinks,
  "  </head>",
  "  <body>",
  '    <div id="root"></div>',
  `    <script type="module" src="./${entryInfo.file}"></script>`,
  "  </body>",
  "</html>",
]
  .filter(Boolean)
  .join("\n");

await writeFile(outputPath, html, "utf8");
