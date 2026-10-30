import assert from 'node:assert/strict';
import test from 'node:test';
import { runGh } from './gh.mjs';

function fixture(overrides = {}) {
  const calls = [];
  let output = '';
  let error = '';
  const options = {
    env: { PATH: '/test/path', GH_TOKEN: 'wrong', GITHUB_TOKEN: 'wrong', GH_ENTERPRISE_TOKEN: 'wrong', GITHUB_ENTERPRISE_TOKEN: 'wrong', GH_DEBUG: 'api', DEBUG: '*', GH_HOST: 'wrong.example', GH_REPO: 'wrong/repo' },
    execute: (file, args, options) => {
      calls.push({ file, args, options });
      if (args[0] === 'auth') return { status: 0, stdout: 'test-secret\n' };
      if (args[0] === 'api' && args.includes('--jq')) return { status: 0, stdout: 'TommyAllsup\n' };
      return { status: 0 };
    },
    readInput: () => 'protocol=https\nhost=github.com\nusername=TommyAllsup\n\n',
    writeOutput: (value) => { output += value; },
    writeError: (value) => { error += value; },
    ...overrides,
  };
  return { options, calls, output: () => output, error: () => error };
}

test('selects and verifies TommyAllsup independently of global and inherited identities', () => {
  const f = fixture();
  assert.equal(runGh(['repo', 'view', '--json', 'nameWithOwner'], f.options), 0);
  assert.deepEqual(f.calls[0].args, ['auth', 'token', '--hostname', 'github.com', '--user', 'TommyAllsup']);
  assert.deepEqual(f.calls[1].args, ['api', '--hostname', 'github.com', 'user', '--jq', '.login']);
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_DEBUG', 'DEBUG']) {
    assert.equal(f.calls[0].options.env[key], undefined);
  }
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[2].options.env.GH_TOKEN, 'test-secret');
  assert.equal(f.calls[2].options.env.GH_HOST, 'github.com');
  assert.equal(f.calls[2].options.env.GH_REPO, 'TommyAllsup/explain-to-me');
  assert.equal(f.calls[2].options.stdio, 'inherit');
  assert.equal(f.output() + f.error(), '');
});

test('refuses a mismatched account before running the requested command', () => {
  const f = fixture();
  const execute = f.options.execute;
  f.options.execute = (...args) => {
    const result = execute(...args);
    return args[1][0] === 'api' ? { status: 0, stdout: 'tallsup-jm\n' } : result;
  };
  assert.equal(runGh(['pr', 'list'], f.options), 1);
  assert.equal(f.calls.length, 2);
  assert.doesNotMatch(f.output() + f.error(), /test-secret/);
});

test('credential mode emits only verified credentials to the protocol stream', () => {
  const f = fixture();
  assert.equal(runGh(['--git-credential', 'get'], f.options), 0);
  assert.equal(f.output(), 'protocol=https\nhost=github.com\nusername=TommyAllsup\npassword=test-secret\n\n');
  assert.equal(f.error(), '');
  assert.equal(f.calls.length, 2);
});

test('credential mode refuses other hosts, protocols and accounts before loading secrets', () => {
  for (const request of [
    'protocol=http\nhost=github.com\n\n',
    'protocol=https\nhost=example.com\n\n',
    'protocol=https\nhost=github.com\nusername=tallsup-jm\n\n',
  ]) {
    const f = fixture({ readInput: () => request });
    assert.equal(runGh(['--git-credential', 'get'], f.options), 1);
    assert.equal(f.output(), 'quit=true\n\n');
    assert.equal(f.calls.length, 0);
  }
});

test('credential failure prevents Git fallback and suppresses child diagnostics', () => {
  const f = fixture({ execute: () => ({ status: 1, stdout: 'sensitive-stdout', stderr: 'sensitive-stderr' }) });
  assert.equal(runGh(['--git-credential', 'get'], f.options), 1);
  assert.equal(f.output(), 'quit=true\n\n');
  assert.doesNotMatch(f.output() + f.error(), /sensitive/);
});

test('store and erase cannot change gh authentication', () => {
  for (const operation of ['store', 'erase']) {
    const f = fixture();
    assert.equal(runGh(['--git-credential', operation], f.options), 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.output() + f.error(), '');
  }
});

test('does not expose tokens or mutate global auth through the CLI wrapper', () => {
  for (const operation of ['token', 'switch', 'login', 'logout', 'refresh', 'setup-git']) {
    const f = fixture();
    assert.equal(runGh(['auth', operation], f.options), 1);
    assert.equal(f.calls.length, 0);
  }
  for (const flag of ['--show-token', '--show-token=true', '-t', '-at']) {
    const f = fixture();
    assert.equal(runGh(['auth', 'status', flag], f.options), 1);
    assert.equal(f.calls.length, 0);
  }
});

test('propagates command failure without replacing it with successful identity verification', () => {
  const f = fixture();
  const execute = f.options.execute;
  f.options.execute = (...args) => {
    const result = execute(...args);
    return args[1][0] === 'repo' ? { status: 7 } : result;
  };
  assert.equal(runGh(['repo', 'view'], f.options), 7);
});
