import { strict as assert } from 'assert';
import { PersistentInteractiveSession } from '../../src/adapters/persistent-session';

describe('PersistentInteractiveSession', () => {
  it('keeps one process alive across multiple stdin/stdout turns', async () => {
    const script = [
      "buffer=''",
      'while IFS= read -r line; do',
      "  buffer=\"$buffer$line\"",
      '  case "$line" in',
      '    SWARM_TURN_DONE:*)',
      '      echo "pid=$$"',
      '      case "$buffer" in *second*) echo "prompt=second" ;; *) echo "prompt=first" ;; esac',
      '      echo "$line"',
      "      buffer=''",
      '      ;;',
      '  esac',
      'done',
    ].join('\n');

    const session = new PersistentInteractiveSession({
      command: 'bash',
      args: ['-lc', script],
      cwd: process.cwd(),
    });

    const first = await session.send('first prompt', 2_000);
    const second = await session.send('second prompt', 2_000);
    await session.shutdown();

    assert.strictEqual(first.exitCode, 0);
    assert.strictEqual(second.exitCode, 0);
    const firstPid = first.stdout.match(/pid=(\d+)/)?.[1];
    const secondPid = second.stdout.match(/pid=(\d+)/)?.[1];
    assert.ok(firstPid, 'first turn should include pid');
    assert.strictEqual(secondPid, firstPid);
    assert.ok(first.stdout.includes('prompt=first'));
    assert.ok(second.stdout.includes('prompt=second'));
  });

  it('marks the session unavailable when no end-of-turn marker appears', async () => {
    const session = new PersistentInteractiveSession({
      command: 'bash',
      args: ['-lc', 'while IFS= read -r _line; do :; done'],
      cwd: process.cwd(),
    });

    const result = await session.send('never finishes', 25);
    await session.shutdown();

    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes('Timed out waiting for end-of-turn marker'));
    assert.strictEqual(session.unavailable, true);
  });
});
