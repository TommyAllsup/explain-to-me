import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectJsonSchema } from "../src/project.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, "../schema/project.schema.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(projectJsonSchema, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${outputPath}\n`);
