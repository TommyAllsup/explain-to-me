import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { kokoroPythonPath } from "./kokoro.js";
import { selectNarrationBackend } from "./synthesize.js";

const available = { ready: true, reason: "ready" };
const missing = { ready: false, reason: "Python environment is missing" };

test("Kokoro locates the virtual environment interpreter on each platform", () => {
  const root = join("checkout with spaces", "narración");
  assert.equal(kokoroPythonPath(root, "win32"), join(root, ".venv-kokoro", "Scripts", "python.exe"));
  assert.equal(kokoroPythonPath(root, "darwin"), join(root, ".venv-kokoro", "bin", "python"));
  assert.equal(kokoroPythonPath(root, "linux"), join(root, ".venv-kokoro", "bin", "python"));
});

test("auto uses installed Kokoro on Windows and macOS", () => {
  for (const platform of ["win32", "darwin"] as const) {
    assert.deepEqual(selectNarrationBackend("auto", { platform, kokoro: available }), { backend: "kokoro", warnings: [] });
  }
});

test("macOS auto preserves the visible Apple fallback", () => {
  const result = selectNarrationBackend("auto", { platform: "darwin", kokoro: missing });
  assert.equal(result.backend, "apple");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /using Apple say.*Python environment is missing/u);
});

test("Windows auto refuses unavailable Kokoro with setup instructions", () => {
  assert.throws(() => selectNarrationBackend("auto", { platform: "win32", kokoro: missing }), /Kokoro backend is unavailable: Python environment is missing.*node scripts\/setup\.mjs/u);
});

test("explicit Kokoro never falls back when unavailable", () => {
  for (const platform of ["win32", "darwin"] as const) {
    assert.throws(() => selectNarrationBackend("kokoro", { platform, kokoro: missing }), /Kokoro backend is unavailable/u);
  }
});

test("macOS missing Kokoro keeps the Python setup guidance", () => {
  assert.throws(() => selectNarrationBackend("kokoro", { platform: "darwin", kokoro: missing }), /python3 scripts\/setup-kokoro\.py/u);
});

test("Apple is selectable on macOS without Kokoro and rejected on Windows", () => {
  assert.deepEqual(selectNarrationBackend("apple", { platform: "darwin", kokoro: missing }), { backend: "apple", warnings: [] });
  assert.throws(() => selectNarrationBackend("apple", { platform: "win32", kokoro: available }), /Apple narration requires macOS/u);
});
