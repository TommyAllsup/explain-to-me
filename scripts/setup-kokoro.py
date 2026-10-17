#!/usr/bin/env python3
"""Setup-only installer. Builds never call this script or download models."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / '.explain-to-me' / 'models' / 'kokoro'
VENV_DIR = ROOT / '.venv-kokoro'
ASSETS = {
    'kokoro-v1.0.onnx': 'beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a',
    'voices-v1.0.bin': 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}
RELEASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def python_path(platform=os.name):
    return VENV_DIR / ('Scripts/python.exe' if platform == 'nt' else 'bin/python')


def main():
    python = python_path()
    env = {**os.environ}
    env.setdefault('UV_CACHE_DIR', str(ROOT / '.explain-to-me' / 'cache' / 'uv'))
    env.setdefault('UV_PYTHON_INSTALL_DIR', str(ROOT / '.explain-to-me' / 'runtime' / 'python'))
    uv = env.get('EXPLAIN_TO_ME_UV', 'uv')
    if not python.exists():
        subprocess.run([uv, 'venv', '--python', '3.11', str(VENV_DIR)], check=True, env=env)
    requirements = ROOT / 'services' / 'local-models' / 'requirements-kokoro.txt'
    subprocess.run([uv, 'pip', 'install', '--python', str(python), '-r', str(requirements)], check=True, env=env)
    MODEL_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    records = []
    for name, expected in ASSETS.items():
        target = MODEL_DIR / name
        if target.is_symlink():
            raise RuntimeError('Refusing symlink model destination: ' + str(target))
        url = RELEASE + '/' + name
        if not target.exists() or sha256(target) != expected:
            print('Downloading pinned asset:', name, flush=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=MODEL_DIR, prefix='asset-', delete=False) as output:
                    temporary = Path(output.name)
                    with urllib.request.urlopen(url, timeout=90) as response:
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            output.write(block)
                actual = sha256(temporary)
                if actual != expected:
                    raise RuntimeError('SHA256 mismatch for ' + name + ': ' + actual)
                os.replace(temporary, target)
            finally:
                if temporary is not None and temporary.exists():
                    temporary.unlink()
        records.append({'filename': name, 'sha256': expected, 'bytes': target.stat().st_size, 'source': url})
    bridge = ROOT / 'services' / 'local-models' / 'kokoro_synthesize.py'
    runtime = json.loads(subprocess.check_output([str(python), str(bridge), '--check'], text=True, timeout=30))
    print('Checking Kokoro with a short synthesis sample...', flush=True)
    smoke = json.loads(subprocess.check_output([str(python), str(bridge), '--smoke'], text=True, timeout=120))
    if smoke.get('sampleRate') != 24_000 or not 0 < smoke.get('samples', 0) <= 24_000 * 15:
        raise RuntimeError('Kokoro synthesis smoke test returned invalid PCM metadata')
    provenance = {
        'model': 'Kokoro-82M v1.0',
        'release': 'model-files-v1.1',
        'assets': records,
        'runtimeVersions': runtime['packages'],
        'runtime': runtime,
        'smokeTest': smoke,
        'licenses': {'kokoro-onnx': 'MIT', 'model': 'Apache-2.0'},
        'references': [
            'https://github.com/thewh1teagle/kokoro-onnx',
            'https://huggingface.co/hexgrad/Kokoro-82M',
            'https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md',
        ],
        'licenseSuitabilityApproved': False,
        'setupDownloadsOnly': True,
    }
    (MODEL_DIR / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(provenance, indent=2), flush=True)


if __name__ == '__main__':
    main()
