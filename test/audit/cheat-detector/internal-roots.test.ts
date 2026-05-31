import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import {
  collectInternalRootsFromFiles,
  resolvesToInternalRoot,
} from '../../../src/audit/cheat-detector/internal-roots';

describe('cheat-detector / internal-roots from diff', () => {
  it('collects every directory segment of every touched path', () => {
    const files = parseDiff(`diff --git a/backend/routers/servers.py b/backend/routers/servers.py
--- a/backend/routers/servers.py
+++ b/backend/routers/servers.py
@@ -1,1 +1,2 @@
 x = 1
+y = 2
`);
    const roots = collectInternalRootsFromFiles(files);
    assert.ok(roots.has('backend'));
    assert.ok(roots.has('routers'));
  });

  it('resolves an internal mock target against a directory the diff touches', () => {
    // The class of false positive from the wild-PR scan: a test mocks
    // `routers.servers.os.makedirs`, an internal module, but the
    // filesystem at audit time is not the PR's repo, so the on-disk
    // collector cannot see it. The diff still names `routers/`.
    const files = parseDiff(`diff --git a/backend/routers/servers.py b/backend/routers/servers.py
--- a/backend/routers/servers.py
+++ b/backend/routers/servers.py
@@ -1,1 +1,2 @@
 x = 1
+y = 2
diff --git a/backend/tests/test_auth_router.py b/backend/tests/test_auth_router.py
--- a/backend/tests/test_auth_router.py
+++ b/backend/tests/test_auth_router.py
@@ -1,1 +1,2 @@
 import pytest
+with patch("routers.servers.os.makedirs"):
`);
    const roots = collectInternalRootsFromFiles(files);
    assert.equal(resolvesToInternalRoot('routers.servers.os.makedirs', roots), true);
  });

  it('does not invent roots from skip-dirs or dotfiles', () => {
    const files = parseDiff(`diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js
--- a/node_modules/pkg/index.js
+++ b/node_modules/pkg/index.js
@@ -1,1 +1,2 @@
 a
+b
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,1 +1,2 @@
 a
+b
`);
    const roots = collectInternalRootsFromFiles(files);
    assert.equal(roots.has('node_modules'), false);
    assert.equal(roots.has('.github'), false);
    assert.equal(roots.has('workflows'), true);
  });
});
