import { preparePresenter, type PreparePresenterOptions } from "../../../packages/presenter/src/prepare.js";

export async function runPresenter(args: string[]): Promise<void> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write("Usage: explain-to-me presenter --manifest <file.json> --pack <pack.json> --output <new-dir> [--scenes <id,id>]\n");
    return;
  }
  const values = new Map<string, string>();
  const accepted = new Set(["--manifest", "--pack", "--output", "--scenes"]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;
    if (!accepted.has(flag)) throw new Error(`Unknown presenter option: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate presenter option: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Presenter option ${flag} requires a value`);
    values.set(flag, value);
  }
  for (const required of ["--manifest", "--pack", "--output"]) {
    if (!values.has(required)) throw new Error(`Presenter requires ${required}`);
  }
  const options: PreparePresenterOptions = {
    manifestPath: values.get("--manifest")!,
    packPath: values.get("--pack")!,
    outputDirectory: values.get("--output")!,
    ...(values.has("--scenes") ? { sceneIds: values.get("--scenes")!.split(",").map((id) => id.trim()) } : {}),
  };
  process.stdout.write(`${JSON.stringify(await preparePresenter(options), null, 2)}\n`);
}
