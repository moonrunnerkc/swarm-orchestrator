import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderDynamicMessage } from '../../src/population/manager';
import type { ObligationV1 } from '../../src/contract/types';

/**
 * Verify that renderDynamicMessage injects current file contents into
 * persona prompts for obligation types where the persona needs to know
 * the file body to write a correct diff. Without this, personas guess
 * at context lines and applyUnifiedDiff fails with context mismatches.
 */

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('renderDynamicMessage file-context injection', () => {
  it('embeds the target file body for function-must-have-signature obligations', () => {
    const repo = tmpRepo('manager-file-ctx-sig-');
    try {
      const relPath = 'src/controllers/user.controller.js';
      fs.mkdirSync(path.join(repo, 'src/controllers'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, relPath),
        "const catchAsync = require('../utils/catchAsync');\nconst getUser = catchAsync(async (req, res) => res.send({}));\nmodule.exports = { getUser };\n",
      );
      const obligation: ObligationV1 = {
        type: 'function-must-have-signature',
        file: relPath,
        name: 'changeMyPassword',
        signature: '(req, res)',
      };
      const out = renderDynamicMessage(obligation, repo);
      assert.match(out, /Current contents of src\/controllers\/user\.controller\.js/);
      assert.match(out, /const catchAsync = require\('\.\.\/utils\/catchAsync'\);/);
      assert.match(out, /const getUser = catchAsync/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('embeds files referenced in property-must-hold predicates', () => {
    const repo = tmpRepo('manager-file-ctx-pred-');
    try {
      const relPath = 'src/routes/v1/user.route.js';
      fs.mkdirSync(path.join(repo, 'src/routes/v1'), { recursive: true });
      const body = "const express = require('express');\nconst router = express.Router();\nrouter.get('/:userId', getUser);\nmodule.exports = router;\n";
      fs.writeFileSync(path.join(repo, relPath), body);
      const obligation: ObligationV1 = {
        type: 'property-must-hold',
        predicate: "grep -q 'router.post' src/routes/v1/user.route.js",
        target: 'POST route registered',
      };
      const out = renderDynamicMessage(obligation, repo);
      assert.match(out, /Current contents of src\/routes\/v1\/user\.route\.js/);
      assert.match(out, /router\.get\('\/:userId'/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('silently skips files that do not exist', () => {
    const repo = tmpRepo('manager-file-ctx-absent-');
    try {
      const obligation: ObligationV1 = {
        type: 'property-must-hold',
        predicate: "grep -q 'foo' nonexistent/file.js",
        target: 'missing file ref',
      };
      const out = renderDynamicMessage(obligation, repo);
      // Predicate appears, but no "Current contents of" section since the file doesn't exist.
      assert.match(out, /grep -q 'foo' nonexistent\/file\.js/);
      assert.doesNotMatch(out, /Current contents of nonexistent\/file\.js/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('rejects path-escape attempts (../) via repo-root containment check', () => {
    const repo = tmpRepo('manager-file-ctx-escape-');
    try {
      // Set up a file OUTSIDE the repo
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-file-ctx-outside-'));
      const secret = path.join(outside, 'secrets.txt');
      fs.writeFileSync(secret, 'SUPER-SECRET-TOKEN');
      try {
        const escapingPredicate = `cat ../${path.basename(outside)}/secrets.txt`;
        const obligation: ObligationV1 = {
          type: 'property-must-hold',
          predicate: escapingPredicate,
          target: 'escape probe',
        };
        const out = renderDynamicMessage(obligation, repo);
        assert.doesNotMatch(out, /SUPER-SECRET-TOKEN/);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
