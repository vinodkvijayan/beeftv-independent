import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const contractStart = "<!-- BEEFTV_PLUGIN_MANIFEST_START -->";
const contractEnd = "<!-- BEEFTV_PLUGIN_MANIFEST_END -->";
const recursiveDocumentationPlaceholder =
  "<The complete documentation of the current plug-in is composed of README.md and docs/interface.md; in order to avoid JSON recursion, the text will not be expanded repeatedly here. >";

function normalizeNewlines(document) {
  return document.replace(/\r\n?/g, "\n");
}

function withoutGeneratedContract(document) {
  const start = document.indexOf(contractStart);
  if (start < 0) return document.trimEnd();
  const end = document.indexOf(contractEnd, start);
  if (end < 0) {
    throw new Error("docs/interface.md contains an unterminated generated manifest contract");
  }
  return `${document.slice(0, start)}${document.slice(end + contractEnd.length)}`.trimEnd();
}

function renderContract(manifest) {
  const contract = JSON.parse(JSON.stringify(manifest));
  contract.documentation = recursiveDocumentationPlaceholder;
  return `${contractStart}## Manifest complete interface definition

The following JSON is consistent field by field with the actual \`manifest.json\` in the plug-in package, covering plug-in identity, permissions, configuration, authentication, parameters, verification, creation, Agent, query, cancellation, result download, response and Agent response mapping. The value of the \`documentation\` field is the current complete document; in order to avoid infinite recursion of the document within itself, only equivalent placeholder text is used to represent the main text in JSON.

\`\`\`json${JSON.stringify(contract, null, 2)}
\`\`\`
${contractEnd}`;
}

const entries = await readdir(root, { withFileTypes: true });
const requestedPackageIDs = new Set(process.argv.slice(2).map((value) => value.trim()).filter(Boolean));
const packageDirectories = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => requestedPackageIDs.size === 0 || requestedPackageIDs.has(name))
  .sort();

let updated = 0;
for (const packageID of packageDirectories) {
  const packageRoot = join(root, packageID);
  let manifestSource;
  try {
    manifestSource = normalizeNewlines(await readFile(join(packageRoot, "manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }

  const manifest = JSON.parse(manifestSource);
  const readmePath = join(packageRoot, "README.md");
  const readme = normalizeNewlines(await readFile(readmePath, "utf8")).trim();
  const interfacePath = join(packageRoot, "docs", "interface.md");
  const interfaceSource = normalizeNewlines(await readFile(interfacePath, "utf8"));
  const interfaceDocument = `${withoutGeneratedContract(interfaceSource)}\n\n${renderContract(manifest)}\n`;
  manifest.documentation = `${readme}\n\n---\n\n${interfaceDocument.trim()}\n`;

  await writeFile(readmePath, `${readme}\n`);
  await writeFile(interfacePath, interfaceDocument);
  await writeFile(join(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  updated += 1;
}

if (updated === 0) {
  throw new Error("no protocol plugin manifests were found");
}

console.log(`embedded complete documentation into ${updated} protocol packages`);
