#!/usr/bin/env node

/**
 * Plugin build script: copies canonical source files into the plugin/ directory.
 *
 * The plugin/agents/*.agent.md files are the authoritative agent definitions
 * for the plugin distribution. This script validates that the plugin directory
 * structure is complete and consistent with the plugin.json manifest.
 *
 * Run: node scripts/build-plugin.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const MANIFEST_PATH = path.join(PLUGIN_DIR, 'plugin.json');

function validateManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Missing plugin manifest: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const missing = [];

  // Validate all declared agents exist
  for (const agentPath of manifest.agents || []) {
    const fullPath = path.join(PLUGIN_DIR, agentPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(agentPath);
    }
  }

  // Validate all declared skills exist
  for (const skillPath of manifest.skills || []) {
    const fullPath = path.join(PLUGIN_DIR, skillPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(skillPath);
    }
  }

  // Validate all declared hooks exist
  const hookPaths = Array.isArray(manifest.hooks)
    ? manifest.hooks
    : manifest.hooks ? [manifest.hooks] : [];
  for (const hookPath of hookPaths) {
    const fullPath = path.join(PLUGIN_DIR, hookPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(hookPath);
    }
  }

  return { manifest, missing };
}

function validateAgentFiles() {
  const agentsDir = path.join(PLUGIN_DIR, 'agents');
  if (!fs.existsSync(agentsDir)) {
    console.error('Missing agents directory');
    process.exit(1);
  }

  const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.agent.md'));
  const issues = [];

  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');

    // Check for YAML frontmatter
    if (!content.startsWith('---')) {
      issues.push(`${file}: missing YAML frontmatter`);
      continue;
    }

    const frontmatterEnd = content.indexOf('---', 3);
    if (frontmatterEnd === -1) {
      issues.push(`${file}: malformed YAML frontmatter (no closing ---)`);
      continue;
    }

    const frontmatter = content.substring(3, frontmatterEnd).trim();
    if (!frontmatter.includes('name:')) {
      issues.push(`${file}: frontmatter missing 'name' field`);
    }
    if (!frontmatter.includes('description:')) {
      issues.push(`${file}: frontmatter missing 'description' field`);
    }
  }

  return { agentFiles, issues };
}

function validateSkillFiles() {
  const skillsDir = path.join(PLUGIN_DIR, 'skills');
  if (!fs.existsSync(skillsDir)) {
    console.error('Missing skills directory');
    process.exit(1);
  }

  const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const issues = [];

  for (const dir of skillDirs) {
    const skillFile = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      issues.push(`${dir}: missing SKILL.md`);
    }
  }

  return { skillDirs, issues };
}

function syncAgentsFromCanonical() {
  const canonicalDir = path.join(ROOT, 'agents');
  const pluginAgentsDir = path.join(PLUGIN_DIR, 'agents');

  if (!fs.existsSync(canonicalDir)) {
    console.error(`Canonical agents directory not found: ${canonicalDir}`);
    process.exit(1);
  }

  fs.mkdirSync(pluginAgentsDir, { recursive: true });

  const agentFiles = fs.readdirSync(canonicalDir).filter(f => f.endsWith('.agent.md'));
  for (const file of agentFiles) {
    fs.copyFileSync(path.join(canonicalDir, file), path.join(pluginAgentsDir, file));
  }

  console.log(`  agents/: synced ${agentFiles.length} file(s) from canonical agents/`);
}

function main() {
  console.log('Validating plugin structure...\n');

  syncAgentsFromCanonical();

  // Validate manifest
  const { manifest, missing } = validateManifest();
  if (missing.length > 0) {
    console.error('Manifest references missing files:');
    missing.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  const hookCount = Array.isArray(manifest.hooks) ? manifest.hooks.length : manifest.hooks ? 1 : 0;
  console.log(`  plugin.json: OK (${manifest.agents.length} agents, ${manifest.skills.length} skills, ${hookCount} hooks)`);

  // Validate agents
  const agentResult = validateAgentFiles();
  if (agentResult.issues.length > 0) {
    console.error('Agent file issues:');
    agentResult.issues.forEach(i => console.error(`  - ${i}`));
    process.exit(1);
  }
  console.log(`  agents/: OK (${agentResult.agentFiles.length} agent files)`);

  // Validate skills
  const skillResult = validateSkillFiles();
  if (skillResult.issues.length > 0) {
    console.error('Skill file issues:');
    skillResult.issues.forEach(i => console.error(`  - ${i}`));
    process.exit(1);
  }
  console.log(`  skills/: OK (${skillResult.skillDirs.length} skill directories)`);

  // Validate hooks
  const hooksDir = path.join(PLUGIN_DIR, 'hooks');
  const hookFiles = fs.existsSync(hooksDir)
    ? fs.readdirSync(hooksDir).filter(f => f.endsWith('.json'))
    : [];
  console.log(`  hooks/: OK (${hookFiles.length} hook files)`);

  // Sync to .github/plugin/ for copilot plugin install discoverability
  const ghPluginDir = path.join(ROOT, '.github', 'plugin');
  syncToGitHubPlugin(PLUGIN_DIR, ghPluginDir);

  console.log(`\nPlugin build validated successfully.`);
  console.log(`Install locally: copilot /plugin install ${PLUGIN_DIR}`);
  console.log(`GitHub plugin path synced: ${ghPluginDir}`);
}

/**
 * Recursively copy plugin/ to .github/plugin/ so that
 * `copilot plugin install moonrunnerkc/swarm-orchestrator` works.
 */
function syncToGitHubPlugin(src, dest) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.cpSync(src, dest, { recursive: true });
}

main();
