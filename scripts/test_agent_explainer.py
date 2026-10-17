import importlib.util
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('agent_explainer', Path(__file__).with_name('agent-explainer.py'))
assert SPEC is not None and SPEC.loader is not None
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)


class AgentLauncherTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ.get('ETM_TEST_TMP', Path(__file__).resolve().parents[1] / '.cache' / 'tests'))
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temp.name)
        self.software = self.root / 'software'
        self.software.mkdir()
        self.root_patch = mock.patch.object(agent, 'ROOT', self.software)
        self.root_patch.start()
        self.workspace = self.root / 'private-workspace'
        self.workspace.mkdir()

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    def test_input_and_symlink_escape_are_refused_before_job_creation(self):
        outside = self.root / 'outside.md'
        outside.write_text('neutral fixture')
        with self.assertRaises(ValueError):
            agent.checked_source(outside, self.workspace, False)
        self.assertFalse((self.workspace / '.explain-to-me').exists())

    def test_file_symlink_escape_is_refused(self):
        outside = self.root / 'outside.md'
        outside.write_text('neutral fixture')
        link = self.workspace / 'escape.md'
        try:
            link.symlink_to(outside)
        except OSError as error:
            if os.name == 'nt' and error.winerror == 1314:
                self.skipTest('File symlinks require Developer Mode or symlink privilege; junction coverage remains enabled')
            raise
        with self.assertRaises(ValueError):
            agent.checked_source(link, self.workspace, False)

    def test_workspace_inside_software_is_refused(self):
        with self.assertRaises(ValueError):
            agent.create_job(self.software / 'private', self.software, 'test')
        self.assertFalse((self.software / 'private').exists())

    def test_unique_jobs_and_private_path_layout(self):
        one = agent.create_job(self.workspace, self.software, 'fixture')
        two = agent.create_job(self.workspace, self.software, 'fixture')
        self.assertNotEqual(one['job'], two['job'])
        for value in one.values():
            self.assertTrue(agent.within(value, self.workspace))
        self.assertFalse(one['output'].exists())

    def test_cache_symlink_escape_is_refused(self):
        link = self.workspace / '.explain-to-me'
        if os.name == 'nt':
            import _winapi
            _winapi.CreateJunction(str(self.software), str(link))
        else:
            link.symlink_to(self.software, target_is_directory=True)
        with self.assertRaises(ValueError):
            agent.create_job(self.workspace, self.software, 'test')
        self.assertFalse((self.software / 'jobs').exists())

    def test_missing_failed_or_partial_qc_is_not_success(self):
        output = self.workspace / 'output'
        output.mkdir()
        for name in agent.ARTIFACTS:
            (output / name).write_text('unit-test fixture, not actual media')
        report = {'buildId': 'unit-fixture', 'status': 'automated-checks-passed-egress-unverified', 'validation': {'automatedChecks': 'passed', 'gates': {key: True for key in agent.GATES}}, 'humanReview': {'status': 'pending'}, 'egress': {'status': 'unverified'}}
        (output / 'report.json').write_text(json.dumps(report))
        self.assertEqual(agent.validate_output(output)['humanReview'], 'pending')
        report['validation']['gates']['decoded'] = False
        (output / 'report.json').write_text(json.dumps(report))
        with self.assertRaises(ValueError):
            agent.validate_output(output)
        (output / 'audio.wav').unlink()
        with self.assertRaises(ValueError):
            agent.validate_output(output)

    def test_subprocess_failure_and_timeout_do_not_report_success(self):
        log = self.workspace / 'run.log'
        with self.assertRaises(subprocess.CalledProcessError):
            agent.run_owned([sys.executable, '-c', 'raise SystemExit(7)'], self.workspace, dict(os.environ), log, 5)
        with self.assertRaises(subprocess.TimeoutExpired):
            agent.run_owned([sys.executable, '-c', 'import time; time.sleep(10)'], self.workspace, dict(os.environ), log, 0.1)

    def test_timeout_stops_owned_descendant(self):
        heartbeat = self.workspace / 'heartbeat'
        child = "import pathlib,time,sys; p=pathlib.Path(sys.argv[1]);\nwhile True:\n p.write_text(str(time.monotonic())); time.sleep(0.02)"
        parent = "import subprocess,sys,time,pathlib; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]);\nwhile not pathlib.Path(sys.argv[2]).exists(): time.sleep(0.01)\ntime.sleep(60)"
        with self.assertRaises(subprocess.TimeoutExpired):
            agent.run_owned([sys.executable, '-c', parent, child, str(heartbeat)], self.workspace, dict(os.environ), self.workspace / 'tree.log', 1.5)
        self.assertTrue(heartbeat.exists(), 'Descendant must start before cleanup is exercised')
        after = heartbeat.read_text()
        time.sleep(0.25)
        self.assertEqual(heartbeat.read_text(), after, 'Owned descendant kept running after timeout')

    @unittest.skipUnless(os.name == 'nt', 'Windows Job Object cancellation')
    def test_cancellation_stops_owned_process(self):
        def cancel(process, timeout):
            time.sleep(0.1)
            raise KeyboardInterrupt()

        with mock.patch.object(agent.OwnedProcess, 'wait', cancel), self.assertRaises(KeyboardInterrupt):
            agent.run_owned([sys.executable, '-c', 'import time; time.sleep(60)'], self.workspace, dict(os.environ), self.workspace / 'cancel.log', 5)
        # Closing/removing the log fails if the child still owns its log handle.
        (self.workspace / 'cancel.log').unlink()

    @unittest.skipUnless(os.name == 'nt', 'Windows Job Object final cleanup')
    def test_success_closes_owned_descendants(self):
        heartbeat = self.workspace / 'success-heartbeat'
        child = "import pathlib,time,sys; p=pathlib.Path(sys.argv[1]);\nwhile True:\n p.write_text(str(time.monotonic())); time.sleep(0.02)"
        parent = "import subprocess,sys,time,pathlib; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]);\nwhile not pathlib.Path(sys.argv[2]).exists(): time.sleep(0.01)"
        agent.run_owned([sys.executable, '-c', parent, child, str(heartbeat)], self.workspace, dict(os.environ), self.workspace / 'success.log', 5)
        after = heartbeat.read_text()
        time.sleep(0.25)
        self.assertEqual(heartbeat.read_text(), after)

    @unittest.skipUnless(os.name == 'nt', 'Windows handle cleanup')
    def test_cleanup_errors_still_close_process_and_job_handles(self):
        import windows_process
        process = windows_process.OwnedProcess.__new__(windows_process.OwnedProcess)
        process.job, process.process = 11, 12
        with mock.patch.object(windows_process, 'terminate_job', side_effect=OSError('fixture cleanup failure')), \
                mock.patch.object(windows_process, 'close_handle') as close, self.assertRaises(OSError):
            process.close()
        self.assertEqual(close.call_args_list, [mock.call(11), mock.call(12)])
        self.assertIsNone(process.job)
        self.assertIsNone(process.process)

    @unittest.skipUnless(os.name == 'nt', 'Windows path aliases')
    def test_windows_aliases_and_streams_are_refused(self):
        for path in ('C:relative.md', 'C:\\notes.md:secret', 'C:\\NUL.txt', 'C:\\notes.\\file.md', '\\\\server\\share\\file.md', '\\\\?\\C:\\file.md'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                agent.supported_path(path)

    @unittest.skipUnless(os.name == 'nt', 'Windows junctions work without symlink privilege')
    def test_junction_input_is_refused(self):
        import _winapi
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'story.md').write_text('neutral fixture')
        link = self.workspace / 'linked'
        _winapi.CreateJunction(str(outside), str(link))
        with self.assertRaises(ValueError):
            agent.checked_source(link / 'story.md', self.workspace, False)

    def test_git_identity_includes_dirty_state_and_untracked_source(self):
        subprocess.run(['git', 'init', '-q', str(self.software)], check=True)
        (self.software / 'package.json').write_text('{"version":"0.2.0"}')
        subprocess.run(['git', 'add', 'package.json'], cwd=self.software, check=True)
        hooks = self.root / 'empty-hooks'
        hooks.mkdir()
        subprocess.run(['git', '-c', 'user.name=Test Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + str(hooks), 'commit', '-qm', 'fixture'], cwd=self.software, check=True)
        before = agent.software_identity(self.software)
        self.assertFalse(before['dirty'])
        (self.software / 'new.py').write_text('# unit-test source')
        after = agent.software_identity(self.software)
        self.assertTrue(after['dirty'])
        self.assertNotEqual(before['sourceFingerprint'], after['sourceFingerprint'])
        self.assertEqual(after['version'], '0.2.0')

    def test_prepared_manifest_build_does_not_pass_document_direction_options(self):
        source = self.workspace / 'story.json'
        source.write_text('{}')
        identity = {'version': '0.2.0', 'sourceFingerprint': 'unit-fixture'}
        with mock.patch.object(agent, 'software_identity', return_value=identity), \
                mock.patch.object(agent.shutil, 'which', return_value='/fixture/node'), \
                mock.patch.object(agent.subprocess, 'check_output', return_value='explain-to-me 0.2.0\n'), \
                mock.patch.object(agent, 'run_owned') as run, \
                mock.patch.object(agent, 'validate_output', return_value={}), \
                redirect_stdout(io.StringIO()):
            result = agent.main(['build', '--workspace', str(self.workspace), '--manifest', str(source), '--tts', 'apple'])
        self.assertEqual(result, 0)
        command = run.call_args.args[0]
        environment = run.call_args.args[2]
        self.assertEqual(environment['TEMP'], environment['TMP'])
        self.assertEqual(environment['TEMP'], environment['TMPDIR'])
        self.assertEqual(command[command.index('--manifest') + 1], str(source.resolve()))
        for option in ['--director', '--audience', '--style']:
            self.assertNotIn(option, command)

    def test_prepared_manifest_refuses_explicit_document_direction_before_job_creation(self):
        source = self.workspace / 'story.json'
        source.write_text('{}')
        for option, value in [('--director', 'auto'), ('--audience', 'new teammates'), ('--style', 'friendly')]:
            with self.subTest(option=option):
                with redirect_stderr(io.StringIO()) as errors, redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as failure:
                    agent.main(['build', '--workspace', str(self.workspace), '--manifest', str(source), option, value])
                self.assertEqual(failure.exception.code, 2)
                self.assertIn('apply to document inputs', errors.getvalue())
                self.assertFalse((self.workspace / '.explain-to-me').exists())

    def test_document_build_preserves_requested_direction_options(self):
        source = self.workspace / 'story.md'
        source.write_text('A neutral explanation.')
        identity = {'version': '0.2.0', 'sourceFingerprint': 'unit-fixture'}
        with mock.patch.object(agent, 'software_identity', return_value=identity), \
                mock.patch.object(agent.shutil, 'which', return_value='/fixture/node'), \
                mock.patch.object(agent.subprocess, 'check_output', return_value='explain-to-me 0.2.0\n'), \
                mock.patch.object(agent, 'run_owned') as run, \
                mock.patch.object(agent, 'validate_output', return_value={}), \
                redirect_stdout(io.StringIO()):
            result = agent.main(['build', '--workspace', str(self.workspace), '--input', str(source), '--director', 'template', '--audience', 'new teammates', '--style', 'friendly'])
        self.assertEqual(result, 0)
        command = run.call_args.args[0]
        for option, value in [('--director', 'template'), ('--audience', 'new teammates'), ('--style', 'friendly')]:
            self.assertEqual(command[command.index(option) + 1], value)


if __name__ == '__main__':
    unittest.main()
