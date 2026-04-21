#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Constraint-binding task loader and validator runner.
 *
 * Exports:
 *   - loadTask(yamlPath)           -> validated task object
 *   - runValidators(task, workdir) -> ValidatorReport
 *   - ALLOWED_PATTERNS, REQUIRED_TOP_LEVEL, REQUIRED_PRE_STATE
 *
 * CLI:
 *   node validator-engine.js lint <tasks-dir>
 *   node validator-engine.js run  <task.yaml> <workspace>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// js-yaml is already a dependency of the orchestrator (see package.json)
const yaml = require('js-yaml');

const ALLOWED_PATTERNS = Object.freeze([
  'schema-then-query',
  'rename-then-update-callers',
  'contract-change-then-client',
  'lift-then-reuse',
]);

const REQUIRED_TOP_LEVEL = Object.freeze([
  'id',
  'name',
  'pattern',
  'pre_state',
  'prompt',
  'expected_steps_min',
  'post_state_validators',
]);

const REQUIRED_PRE_STATE = Object.freeze([
  'fixture_tarball',
  'source_repo',
  'source_sha',
  'fixture_sha256',
]);

const SHA1_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

/**
 * Parse and validate a task YAML file. Returns the task object on success,
 * throws Error with a specific, actionable message on any violation.
 *
 * @param {string} yamlPath absolute path to the YAML file
 * @returns {object}
 */
function loadTask(yamlPath) {
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`task file not found: ${yamlPath}`);
  }
  const raw = fs.readFileSync(yamlPath, 'utf8');
  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`invalid YAML in ${yamlPath}: ${err.message}`, { cause: err });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${yamlPath}: top-level must be a YAML mapping, got ${typeof parsed}`);
  }
  validateTask(parsed, yamlPath);
  return parsed;
}

/**
 * Enforce schema rules on an already-parsed task object. No filesystem access.
 *
 * @param {object} task
 * @param {string} [label] path for error messages
 */
function validateTask(task, label = '<task>') {
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in task)) {
      throw new Error(`${label}: missing required field "${key}"`);
    }
  }

  if (typeof task.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(task.id)) {
    throw new Error(`${label}: id must be kebab-case (lowercase letters, digits, hyphens)`);
  }
  if (typeof task.name !== 'string' || task.name.length === 0) {
    throw new Error(`${label}: name must be a non-empty string`);
  }
  if (!ALLOWED_PATTERNS.includes(task.pattern)) {
    throw new Error(
      `${label}: pattern "${task.pattern}" not in allowed set (${ALLOWED_PATTERNS.join(', ')})`,
    );
  }

  if (typeof task.pre_state !== 'object' || task.pre_state === null) {
    throw new Error(`${label}: pre_state must be a mapping`);
  }
  for (const key of REQUIRED_PRE_STATE) {
    if (!(key in task.pre_state)) {
      throw new Error(`${label}: pre_state missing required field "${key}"`);
    }
  }
  if (typeof task.pre_state.source_sha !== 'string' || !SHA1_RE.test(task.pre_state.source_sha)) {
    throw new Error(
      `${label}: pre_state.source_sha must be a 40-char hex SHA-1, got ` +
        `"${task.pre_state.source_sha}"`,
    );
  }
  if (
    typeof task.pre_state.fixture_sha256 !== 'string' ||
    !(SHA256_RE.test(task.pre_state.fixture_sha256) || task.pre_state.fixture_sha256 === 'pending')
  ) {
    throw new Error(
      `${label}: pre_state.fixture_sha256 must be a 64-char hex SHA-256 or the ` +
        `literal string "pending" before first fetch; got "${task.pre_state.fixture_sha256}"`,
    );
  }

  if (typeof task.prompt !== 'string' || task.prompt.length === 0) {
    throw new Error(`${label}: prompt must be a non-empty string`);
  }
  if (!Number.isInteger(task.expected_steps_min) || task.expected_steps_min < 1) {
    throw new Error(`${label}: expected_steps_min must be a positive integer`);
  }
  if (!Array.isArray(task.post_state_validators) || task.post_state_validators.length === 0) {
    throw new Error(`${label}: post_state_validators must be a non-empty array`);
  }
  for (let i = 0; i < task.post_state_validators.length; i++) {
    const v = task.post_state_validators[i];
    if (typeof v !== 'object' || v === null) {
      throw new Error(`${label}: post_state_validators[${i}] must be a mapping`);
    }
    if (typeof v.name !== 'string' || v.name.length === 0) {
      throw new Error(`${label}: post_state_validators[${i}].name must be a non-empty string`);
    }
    if (typeof v.cmd !== 'string' || v.cmd.length === 0) {
      throw new Error(`${label}: post_state_validators[${i}].cmd must be a non-empty string`);
    }
  }
}

/**
 * Execute every validator in order against `workdir`. Stops at the first
 * failure; returns { passed, validators: [{ name, passed, exitCode, stderr }] }.
 * Does not throw on validator failure — that's the normal observation path.
 *
 * @param {object} task loaded task object
 * @param {string} workdir extracted fixture workspace
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] per-validator timeout, default 120000
 */
function runValidators(task, workdir, opts = {}) {
  if (!fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
    throw new Error(`validator workspace does not exist or is not a dir: ${workdir}`);
  }
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 120_000;
  const report = {
    taskId: task.id,
    pattern: task.pattern,
    passed: true,
    validators: [],
  };
  for (const v of task.post_state_validators) {
    const res = spawnSync('bash', ['-lc', v.cmd], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const passed = res.status === 0 && !res.error;
    report.validators.push({
      name: v.name,
      cmd: v.cmd,
      passed,
      exitCode: res.status,
      stderr: (res.stderr || '').trim().slice(0, 2000),
      stdout: (res.stdout || '').trim().slice(0, 1000),
      timedOut: res.signal === 'SIGTERM',
    });
    if (!passed) {
      report.passed = false;
      break;
    }
  }
  return report;
}

/**
 * Walk a directory of task YAMLs, return { ok, errors } after validating each.
 */
function lintTasksDir(tasksDir) {
  const entries = fs.existsSync(tasksDir)
    ? fs.readdirSync(tasksDir).filter((f) => f.endsWith('.yaml'))
    : [];
  const errors = [];
  const ids = new Set();
  for (const f of entries) {
    const full = path.join(tasksDir, f);
    try {
      const task = loadTask(full);
      const stem = path.basename(f, '.yaml');
      if (task.id !== stem) {
        errors.push(`${f}: id "${task.id}" does not match filename stem "${stem}"`);
      }
      if (ids.has(task.id)) {
        errors.push(`${f}: duplicate id "${task.id}"`);
      }
      ids.add(task.id);
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { ok: errors.length === 0, count: entries.length, errors };
}

module.exports = {
  ALLOWED_PATTERNS,
  REQUIRED_TOP_LEVEL,
  REQUIRED_PRE_STATE,
  loadTask,
  validateTask,
  runValidators,
  lintTasksDir,
};

// ── CLI entrypoint ────────────────────────────────────────────────
if (require.main === module) {
  const [, , subcmd, ...rest] = process.argv;
  if (subcmd === 'lint') {
    const dir = rest[0] || path.join(__dirname, 'tasks');
    const result = lintTasksDir(dir);
    if (!result.ok) {
      for (const e of result.errors) console.error(`  ✗ ${e}`);
      console.error(`\n${result.errors.length} error(s) across ${result.count} task(s) in ${dir}`);
      process.exit(1);
    }
    console.log(`✓ ${result.count} task(s) in ${dir} passed schema validation`);
    process.exit(0);
  }
  if (subcmd === 'run') {
    const [taskPath, workspace] = rest;
    if (!taskPath || !workspace) {
      console.error('usage: validator-engine.js run <task.yaml> <workspace>');
      process.exit(2);
    }
    const task = loadTask(path.resolve(taskPath));
    const report = runValidators(task, path.resolve(workspace));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.passed ? 0 : 1);
  }
  console.error('usage: validator-engine.js lint <tasks-dir>');
  console.error('       validator-engine.js run <task.yaml> <workspace>');
  process.exit(2);
}
