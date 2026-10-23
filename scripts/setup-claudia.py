"""Register optional, offline Claudia generation and alignment prerequisites.

The build never downloads models or installs Python packages. This setup command
can explicitly download the pinned model snapshots with --download-models, then
verify and register your Python environments with --register.

Tested generation: Python 3.11, NVIDIA CUDA, torch/torchaudio 2.6.0+cu124,
chatterbox-tts==0.1.7, resemble-perth==1.0.1, soundfile==0.14.0,
pyloudnorm==0.2.0, numpy==1.26.4, transformers==5.2.0.
Alignment environment: Python 3.11, torch==2.9.1 (CPU), transformers==4.40.1,
numpy==1.24.3, scipy==1.10.1.
Phonemizer environment: phonemizer==3.4.0, espeakng-loader==0.2.4 (the existing
Kokoro environment is suitable). Register separate environments because
Chatterbox's dependency pins may conflict with the alignment stack.

Install these prerequisites using their upstream package installation guidance;
the generation environment must successfully import Chatterbox and its native
Perth watermarker, and torch.cuda.is_available() must return True. Registration
exercises all imports, checks CUDA and eSpeak, and verifies every model hash.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "services/local-models/claudia_bridge.py"
spec = importlib.util.spec_from_file_location("claudia_bridge", BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def publish_file(staged: Path, destination: Path, *, replace: bool = False) -> None:
    """Publish atomically without overwriting a concurrent installer by default.

    Staging is in the destination directory, so creating a hard link atomically
    claims the final name on the same filesystem. An existing destination makes
    the operation fail, including one created after earlier readiness checks.
    """
    if replace:
        staged.replace(destination)
    else:
        os.link(staged, destination)
        staged.unlink()


def download_models(config: dict) -> None:
    manifest = json.loads(bridge.MODEL_MANIFEST.read_text(encoding="utf-8"))
    for section, field in [("chatterbox", "modelDirectory"), ("alignment", "alignmentDirectory")]:
        pinned, directory = manifest[section], Path(config[field])
        directory.mkdir(parents=True, exist_ok=True)
        for name, record in pinned["files"].items():
            target = directory / name
            if target.exists():
                if target.stat().st_size == record["bytes"] and bridge.digest(target) == record["sha256"]:
                    print("Verified " + str(target), flush=True)
                    continue
                raise ValueError("Existing model file differs from the pinned snapshot: " + str(target))
            url = f"https://huggingface.co/{pinned['model']}/resolve/{pinned['revision']}/{name}"
            print("Downloading pinned " + section + "/" + name, flush=True)
            # A unique staging file prevents a partial download looking valid.
            with tempfile.NamedTemporaryFile(prefix=".claudia-", dir=directory, delete=False) as output:
                temporary = Path(output.name)
                try:
                    with urllib.request.urlopen(url, timeout=120) as response:
                        copied = 0
                        while block := response.read(4 * 1024 * 1024):
                            copied += len(block)
                            if copied > record["bytes"]:
                                raise ValueError("Download exceeds the pinned file size")
                            output.write(block)
                except BaseException:
                    output.close()
                    temporary.unlink(missing_ok=True)
                    raise
            try:
                if temporary.stat().st_size != record["bytes"] or bridge.digest(temporary) != record["sha256"]:
                    raise ValueError("Downloaded model hash does not match: " + name)
                publish_file(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--register", action="store_true", help="Verify and register existing local runtimes and models")
    parser.add_argument("--download-models", action="store_true", help="Explicitly download pinned models during setup (about 4.5 GB)")
    parser.add_argument("--generation-python", type=Path, required=True, help="Python 3.11 environment with CUDA Chatterbox 0.1.7")
    parser.add_argument("--alignment-python", type=Path, required=True, help="CPU Python environment with torch, transformers, scipy")
    parser.add_argument("--phonemizer-python", type=Path, required=True, help="Python environment with phonemizer and espeakng-loader")
    parser.add_argument("--model-directory", type=Path, required=True, help="Pinned Original English Chatterbox snapshot directory")
    parser.add_argument("--alignment-directory", type=Path, required=True, help="Pinned Meta wav2vec2 phoneme snapshot directory")
    parser.add_argument("--config", type=Path, default=Path(os.environ.get("EXPLAIN_TO_ME_CLAUDIA_CONFIG", ROOT / ".explain-to-me/models/claudia/runtime.json")))
    parser.add_argument("--replace", action="store_true", help="Replace an existing runtime registration after verification")
    args = parser.parse_args()
    if not args.register and not args.download_models:
        parser.error("Choose --register and/or --download-models")
    config = {"version": 1, "device": "cuda", "generationPython": str(args.generation_python.resolve()),
              "alignmentPython": str(args.alignment_python.resolve()), "phonemizerPython": str(args.phonemizer_python.resolve()),
              "modelDirectory": str(args.model_directory.resolve()), "alignmentDirectory": str(args.alignment_directory.resolve())}
    if args.download_models:
        download_models(config)
    if not args.register:
        return
    destination = args.config.resolve()
    if destination.exists() and not args.replace:
        raise FileExistsError("Registration already exists; use --replace to update: " + str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="claudia-setup-") as temporary:
        staged = Path(temporary) / "runtime.json"
        staged.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        bridge.read_config(staged)
        bridge.profile()
        for section in ["chatterbox", "alignment"]:
            bridge.verify_models(config, section)
        for mode, field in [("generation", "generationPython"), ("alignment", "alignmentPython"), ("phonemizer", "phonemizerPython")]:
            print("Checking " + mode + " runtime", flush=True)
            result = subprocess.run([config[field], str(BRIDGE), "--config", str(staged), "--check", mode],
                                    capture_output=True, text=True, encoding="utf-8", timeout=90,
                                    env={**os.environ, "PYTHONIOENCODING": "utf-8", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"},
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if result.returncode:
                raise RuntimeError(mode + " runtime is not ready: " + result.stderr[-6000:])
            print(json.dumps(json.loads(result.stdout)), flush=True)
        # Publish a complete registration only after every check succeeded.
        with tempfile.NamedTemporaryFile(prefix=".runtime-", dir=destination.parent, delete=False) as file:
            publish = Path(file.name)
            file.write(staged.read_bytes())
        try:
            publish_file(publish, destination, replace=args.replace)
        finally:
            publish.unlink(missing_ok=True)
    print("Registered Claudia for offline builds: " + str(destination))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        raise SystemExit("Claudia setup: " + str(error)) from error
