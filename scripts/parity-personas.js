#!/usr/bin/env node
// Phase 2b parity check: dump each PersonaSpec from the default registry to
// evidence/phase-2-parity/personas/<id>.txt in a fixed serialization order.
// Pre-cut: run this and commit the captures. Post-cut: re-run and diff against
// the committed captures — every byte must match. Drift in systemSuffix,
// sampling, tier, role, or handles all show up here.

const fs = require('fs');
const path = require('path');

const { createDefaultRegistry } = require('../dist/src/persona/persona-registry');

const OUT_DIR = path.join(__dirname, '..', 'evidence', 'phase-2-parity', 'personas');
fs.mkdirSync(OUT_DIR, { recursive: true });

const registry = createDefaultRegistry();
for (const p of registry.list()) {
  const lines = [
    `id: ${p.id}`,
    `role: ${p.role}`,
    `tier: ${p.tier}`,
    `handles: ${[...p.handles].join(',')}`,
    `sampling.temperature: ${p.sampling.temperature}`,
    `sampling.topP: ${p.sampling.topP === undefined ? 'unset' : p.sampling.topP}`,
    `sampling.maxTokens: ${p.sampling.maxTokens}`,
    '--- systemSuffix ---',
    p.systemSuffix,
  ];
  const body = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, `${p.id}.txt`), body);
}

process.stdout.write(`wrote ${registry.list().length} persona capture(s) to ${OUT_DIR}\n`);
