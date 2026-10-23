#!/usr/bin/env python3
"""Agent entry point: local software, private workspace jobs, explicit QC states."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile

if os.name == 'nt':
    from windows_process import OwnedProcess, assert_no_reparse, private_directory

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ('video.mp4', 'audio.wav', 'captions.vtt', 'captions.srt', 'manifest.json', 'report.json')
GATES = {'duration', 'avSync', 'captions', 'captionEnd', 'audioClipping', 'audioSilence', 'frameCount', 'sceneBoundarySamples', 'decoded', 'wavFormat', 'pcmMatchesTimeline'}


def supported_path(value):
    if os.name != 'nt':
        return
    raw = str(value)
    if raw.startswith(('\\\\', '//')):
        raise ValueError('UNC and device paths are unsupported; use a local drive path')
    drive, tail = os.path.splitdrive(raw)
    if drive and not tail.startswith(('\\', '/')):
        raise ValueError('Drive-relative paths are unsupported')
    for part in re.split(r'[\\/]', tail):
        if part in {'', '.', '..'}:
            continue
        if re.search(r'[<>:"|?*]', part) or part.endswith(('.', ' ')) or re.match(r'^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)', part, re.I):
            raise ValueError('Unsupported Windows file path or alternate data stream')


def private_dir(path):
    if os.name == 'nt':
        private_directory(path)
    else:
        Path(path).mkdir(parents=True, exist_ok=True, mode=0o700)


def within(path, root):
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


def digest(path):
    if os.name == 'nt':
        supported_path(path)
        assert_no_reparse(path)
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        before = os.fstat(handle.fileno())
        if os.name == 'nt':
            assert_no_reparse(path)
            current = os.stat(path, follow_symlinks=False)
            if (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino):
                raise ValueError('File changed while opening for fingerprinting')
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
        after = os.fstat(handle.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError('File changed while fingerprinting')
    return value.hexdigest()


def checked_source(value, workspace, manifest):
    supported_path(value)
    if os.name == 'nt':
        assert_no_reparse(Path(value).expanduser())
    path = Path(value).expanduser().resolve(strict=True)
    if not within(path, workspace) or not path.is_file():
        raise ValueError('Input must be a file inside the private workspace, including its resolved symlink target')
    if path.suffix.lower() not in ({'.json'} if manifest else {'.md', '.txt'}):
        raise ValueError('Use a prepared .json manifest or local .md/.txt input')
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Input exceeds the agent launcher 4 MiB limit')
    return path


def create_job(workspace, software, label):
    supported_path(workspace)
    requested_workspace = Path(workspace).expanduser()
    workspace = Path(workspace).expanduser().resolve()
    if within(workspace, software):
        raise ValueError('Private workspace must be outside the software checkout')
    if not workspace.is_dir():
        raise ValueError('Private workspace must already exist')
    if os.name == 'nt':
        assert_no_reparse(requested_workspace)
    base = workspace / '.explain-to-me'
    if not within(base, workspace) or within(base, software):
        raise ValueError('Workspace data directory escapes its private root')
    paths = {name: base / name for name in ('jobs', 'cache', 'tmp')}
    for path in paths.values():
        if not within(path, workspace) or within(path, software):
            raise ValueError('Workspace data path escapes its private root')
    private_dir(base)
    for path in paths.values():
        private_dir(path)
    slug = re.sub(r'[^a-zA-Z0-9_-]+', '-', label).strip('-')[:48] or 'explainer'
    job = Path(tempfile.mkdtemp(prefix=slug + '-', dir=paths['jobs']))
    private_dir(job)
    return {'job': job, 'cache': paths['cache'], 'tmp': paths['tmp'], 'output': job / 'output'}


def software_identity(root):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, stderr=subprocess.PIPE)
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    commit = git('rev-parse', 'HEAD').decode().strip()
    dirty = bool(git('status', '--porcelain', '--untracked-files=all'))
    names = sorted(set(filter(None, git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0'))))
    fingerprint = hashlib.sha256()
    for name in names:
        path = root / name
        if any(x.startswith(('.env', '.venv')) or x in {'.git', '.hermes', '.explain-to-me', 'node_modules', '.cache', 'out'} for x in Path(name).parts):
            raise ValueError('Unexpected private path in software source inventory')
        if path.is_symlink() or not path.is_file():
            raise ValueError('Source fingerprint requires regular source files')
        fingerprint.update(name.encode() + b'\0' + bytes.fromhex(digest(path)))
    return {'version': version, 'commit': commit, 'dirty': dirty, 'sourceFingerprint': fingerprint.hexdigest(), 'channel': 'local-working-tree'}


def run_owned(command, cwd, env, log, timeout):
    with Path(log).open('ab') as stream:
        if os.name == 'nt':
            with OwnedProcess(command, cwd, env, stream) as process:
                code = process.wait(timeout)
            if code:
                raise subprocess.CalledProcessError(code, command)
            return
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise
        if code:
            raise subprocess.CalledProcessError(code, command)


def validate_output(output):
    if os.name == 'nt':
        assert_no_reparse(output)
    for name in ARTIFACTS:
        path = output / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise ValueError('Missing, empty or linked output artifact: ' + name)
        if os.name == 'nt':
            assert_no_reparse(path)
    report_path = output / 'report.json'
    if report_path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('Report exceeds 4 MiB')
    report = json.loads(report_path.read_text(encoding='utf-8'))
    validation = report.get('validation', {})
    gates = validation.get('gates', {})
    if not report.get('buildId') or not str(report.get('status', '')).startswith('automated-checks-passed') or validation.get('automatedChecks') != 'passed' or not GATES.issubset(gates) or any(gates[key] is not True for key in GATES):
        raise ValueError('Report does not establish all required automated QC gates')
    return {'buildId': report['buildId'], 'qc': 'passed', 'reportStatus': report['status'], 'humanReview': report.get('humanReview', {}).get('status', 'unknown'), 'egress': report.get('egress', {}).get('status', 'unknown'), 'artifactSha256': {name: digest(output / name) for name in ARTIFACTS}}


def write_record(path, record):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['doctor', 'build'])
    parser.add_argument('--workspace', required=True, type=Path)
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument('--input', type=Path)
    sources.add_argument('--manifest', type=Path)
    parser.add_argument('--pronunciations', type=Path)
    parser.add_argument('--label', default='explainer')
    parser.add_argument('--director', choices=['auto', 'local', 'template'])
    parser.add_argument('--tts', choices=['auto', 'apple', 'kokoro', 'chatterbox'], default='auto')
    parser.add_argument('--presenter', choices=['claudia'])
    parser.add_argument('--voice')
    parser.add_argument('--duration', default='60s')
    parser.add_argument('--audience')
    parser.add_argument('--style')
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args(argv)
    if not 1 <= args.timeout <= 3600:
        parser.error('--timeout must be between 1 and 3600 seconds')
    if args.command == 'build' and not (args.input or args.manifest):
        parser.error('build requires --input or --manifest')
    if args.command == 'build' and args.manifest and any(value is not None for value in (args.director, args.audience, args.style)):
        parser.error('Director/audience/style options apply to document inputs, not prepared manifests')
    if args.command == 'build' and args.presenter == 'claudia' and args.tts not in ('auto', 'chatterbox'):
        parser.error('Animated Claudia requires --tts chatterbox or auto')
    if args.command == 'build' and (args.presenter == 'claudia' or args.tts == 'chatterbox') and args.voice not in (None, 'auto', 'chatterbox-bella'):
        parser.error('Chatterbox supports --voice chatterbox-bella or auto only')
    os.umask(0o077)
    record = {'state': 'failed'}
    record_path = None
    try:
        workspace = args.workspace.expanduser().resolve(strict=True)
        supported_path(args.workspace)
        if os.name == 'nt':
            assert_no_reparse(args.workspace.expanduser())
        source = checked_source(args.manifest or args.input, workspace, bool(args.manifest)) if args.command == 'build' else None
        pronunciation = checked_source(args.pronunciations, workspace, True) if args.pronunciations else None
        node = shutil.which('node')
        if not node:
            raise ValueError('Install Node.js 24+ before using the launcher')
        identity = software_identity(ROOT)
        paths = create_job(workspace, ROOT, args.label if args.command == 'build' else 'doctor')
        if os.name != 'nt' and source and not args.manifest and args.director != 'template' and len(os.fsencode(str(paths['tmp'] / 'd-XXXXXX' / 's.sock'))) > 100:
            raise ValueError('Workspace temporary path exceeds Unix-socket budget; use a shorter workspace path')
        record_path = paths['job'] / 'job.json'
        record = {'state': 'running', 'software': identity, 'workspace': str(workspace), 'job': str(paths['job']), 'output': str(paths['output']), 'log': str(paths['job'] / 'build.log'), 'input': {'path': str(source), 'sha256': digest(source)} if source else None}
        if pronunciation:
            record['pronunciations'] = {'path': str(pronunciation), 'sha256': digest(pronunciation)}
        write_record(record_path, record)
        env = {**os.environ, 'TMPDIR': str(paths['tmp']), 'TEMP': str(paths['tmp']), 'TMP': str(paths['tmp'])}
        cli = [node, '--import', 'tsx', str(ROOT / 'apps/cli/src/index.ts')]
        version = subprocess.check_output(cli + ['--version'], cwd=ROOT, env=env, text=True, timeout=30).strip()
        if version != 'explain-to-me ' + identity['version']:
            raise ValueError('CLI/package version mismatch; use a matching reviewed checkout')
        if args.command == 'doctor':
            command = cli + ['doctor']
        else:
            command = cli + ['build'] + (['--manifest', str(source)] if args.manifest else [str(source)])
            command += ['--tts', args.tts, '--duration', args.duration, '--output', str(paths['output']), '--cache-dir', str(paths['cache'])]
            if not args.manifest:
                command += ['--director', args.director or 'auto']
            for flag, value in [('--voice', args.voice), ('--presenter', args.presenter), ('--audience', args.audience), ('--style', args.style), ('--pronunciations', str(pronunciation) if pronunciation else None)]:
                if value:
                    command += [flag, value]
        record['command'] = command
        write_record(record_path, record)
        run_owned(command, ROOT, env, paths['job'] / 'build.log', args.timeout)
        if source and digest(source) != record['input']['sha256']:
            raise ValueError('Input changed during build; review and rebuild')
        if pronunciation and digest(pronunciation) != record['pronunciations']['sha256']:
            raise ValueError('Pronunciation map changed during build; review and rebuild')
        if software_identity(ROOT)['sourceFingerprint'] != identity['sourceFingerprint']:
            raise ValueError('Software source changed during job; review and rebuild')
        if args.command == 'build':
            record.update(validate_output(paths['output']))
        record['state'] = 'automated-ready' if args.command == 'build' else 'doctor-passed'
        write_record(record_path, record)
        print(json.dumps(record))
        return 0
    except (Exception, KeyboardInterrupt) as error:
        record['state'] = 'cancelled' if isinstance(error, KeyboardInterrupt) else 'failed'
        record['error'] = str(error) or type(error).__name__
        if record_path:
            write_record(record_path, record)
        print(json.dumps(record))
        return 130 if isinstance(error, KeyboardInterrupt) else 1


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    sys.exit(main())
