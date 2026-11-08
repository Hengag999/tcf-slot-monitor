// Node 20's test runner multiplexes serialized test events over child stdout.
// Non-ASCII application logs can corrupt that framing (nodejs/node#64706).
// This preload is used only by npm test; production logging remains unchanged.
import { Console } from 'node:console';

// Leave the parent reporter untouched; Node sets this for isolated test files.
if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  const diagnostics = new Console({ stdout: process.stderr, stderr: process.stderr });
  for (const method of ['log', 'info', 'debug', 'dir', 'table']) {
    console[method] = diagnostics[method].bind(diagnostics);
  }
}
