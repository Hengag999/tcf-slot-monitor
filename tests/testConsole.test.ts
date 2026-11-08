import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const preload = new URL('./helpers/test-console.mjs', import.meta.url).href;
const parentEnv = { ...process.env };
delete parentEnv.NODE_TEST_CONTEXT;

test('test console preload keeps Unicode diagnostics off the child stdout protocol', () => {
  assert.equal(process.env.NODE_TEST_CONTEXT, 'child-v8', 'the supported test runtime identifies child processes');
  const marker = '📅 état 测试 →';
  const child = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e',
    `for (const method of ['log', 'info', 'debug', 'dir', 'table']) console[method](${JSON.stringify(marker)});`],
    { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' } });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr.split(marker).length - 1, 5);
});

test('test console preload preserves passing tests and assertion failure exit status', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tcf-test-console-'));
  const file = join(directory, 'probe.test.mjs');
  try {
    for (const failing of [false, true]) {
      writeFileSync(file, `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('assertions remain active', () => { console.table([{ result: '测试 →' }]); assert.equal(1, ${failing ? 2 : 1}); });\n`);
      const child = spawnSync(process.execPath, ['--import', preload, '--test', '--test-reporter=tap', file],
        { encoding: 'utf8', timeout: 10_000, env: parentEnv });
      assert.equal(child.error, undefined);
      assert.equal(child.status, failing ? 1 : 0, child.stdout + child.stderr);
      assert.match(child.stdout, new RegExp(`# fail ${failing ? 1 : 0}`));
      assert.doesNotMatch(child.stdout + child.stderr, /Unable to deserialize cloned data/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('test console preload leaves a parent process stdout untouched', () => {
  const child = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', 'console.log("parent-output");'],
    { encoding: 'utf8', timeout: 10_000, env: parentEnv });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, 'parent-output\n');
  assert.equal(child.stderr, '');
});
