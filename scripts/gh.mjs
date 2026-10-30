#!/usr/bin/env node
// Repository-scoped GitHub identity. Never switches gh's global active account.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const account = 'TommyAllsup';
const hostname = 'github.com';

export function runGh(args, {
  env = process.env,
  execute = spawnSync,
  readInput = () => readFileSync(0, 'utf8'),
  writeOutput = (value) => process.stdout.write(value),
  writeError = (value) => process.stderr.write(value),
} = {}) {
  const credential = args[0] === '--git-credential';
  const fail = (message) => {
    // Do not echo child stdout/stderr: either can contain a credential.
    if (credential) writeOutput('quit=true\n\n');
    writeError(`explain-to-me GitHub identity: ${message}\n`);
    return 1;
  };

  if (credential) {
    if (args.length !== 2) return fail('invalid credential operation.');
    if (args[1] === 'store' || args[1] === 'erase') return 0;
    if (args[1] !== 'get') return fail('unsupported credential operation.');
    let input;
    try { input = readInput(); } catch { return fail('cannot read credential request.'); }
    if (input.length > 65536) return fail('credential request is too large.');
    const fields = new Map();
    for (const line of input.split(/\r?\n/)) {
      if (!line) break;
      const separator = line.indexOf('=');
      if (separator > 0) fields.set(line.slice(0, separator), line.slice(separator + 1));
    }
    if (fields.get('protocol') !== 'https' || fields.get('host') !== hostname ||
        (fields.has('username') && fields.get('username').toLowerCase() !== account.toLowerCase())) {
      return fail('only HTTPS github.com credentials for TommyAllsup are allowed.');
    }
  } else {
    if (args.length === 0) return fail('usage: git gh <command> [arguments].');
    // Authentication maintenance belongs outside this repo wrapper. In particular,
    // never expose the captured token or mutate the global active account here.
    if (args[0] === 'auth' && (args[1] !== 'status' || args.slice(2).some((arg) =>
      /^--show-token(?:=|$)/.test(arg) || /^-[^-]*t/.test(arg)))) {
      return fail('authentication changes and token output are not supported; use gh outside this repository.');
    }
  }

  const cleanEnv = { ...env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_DEBUG', 'DEBUG']) {
    delete cleanEnv[key];
  }
  cleanEnv.GH_HOST = hostname;
  cleanEnv.GH_REPO = `${account}/explain-to-me`;
  cleanEnv.GH_PROMPT_DISABLED = '1';
  const capture = (command, childEnv) => {
    try {
      return execute('gh', command, { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
    } catch { return { status: 1 }; }
  };
  const stored = capture(['auth', 'token', '--hostname', hostname, '--user', account], cleanEnv);
  const token = stored.stdout?.trim();
  if (stored.status !== 0 || !token || /[\r\n]/.test(token)) {
    return fail('cannot read the stored TommyAllsup credential; authenticate that account outside this repository.');
  }
  const authenticatedEnv = { ...cleanEnv, GH_TOKEN: token };
  const identity = capture(['api', '--hostname', hostname, 'user', '--jq', '.login'], authenticatedEnv);
  if (identity.status !== 0 || identity.stdout?.trim().toLowerCase() !== account.toLowerCase()) {
    return fail('could not verify TommyAllsup; no requested operation was run.');
  }
  if (credential) {
    writeOutput(`protocol=https\nhost=${hostname}\nusername=${account}\npassword=${token}\n\n`);
    return 0;
  }
  try {
    const result = execute('gh', args, { env: authenticatedEnv, stdio: 'inherit' });
    if (result.error) return fail('could not start gh.');
    return result.status ?? 1;
  } catch { return fail('could not start gh.'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runGh(process.argv.slice(2));
}
