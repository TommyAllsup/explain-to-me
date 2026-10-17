import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localPython = join(root, ".venv-kokoro", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.PYTHON ?? (existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
for (const [directory, pattern] of [["scripts", "test_agent_explainer.py"], ["services/local-models", "test_kokoro_bridge.py"]]) {
  const result = spawnSync(python, ["-m", "unittest", "discover", "-s", directory, "-p", pattern], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
