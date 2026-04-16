#!/usr/bin/env node

// Entry point: parses arguments, validates inputs, wires together the tailer
// pipeline (watch → filter → format → print), and prints stats on exit.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseSeverity, meetsThreshold, isValidLevel, LEVELS } from "./filter.js";
import { formatLine } from "./formatter.js";
import { createStats } from "./stats.js";
import { tailFile } from "./watcher.js";

const HELP = `
logtail — tail a log file with severity filtering and optional JSON output

Usage:
  logtail <file> [options]

Options:
  --level <level>   Minimum severity to display (${LEVELS.join(", ")})
  --json            Pretty-print each line as JSON
  --help            Show this help

Examples:
  logtail /var/log/app.log
  logtail /var/log/app.log --level warn
  logtail /var/log/app.log --level error --json
`.trim();

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { file: null, level: null, json: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--level") {
      opts.level = args[++i] ?? null;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\nRun 'logtail --help' for usage.\n`);
      process.exit(1);
    } else {
      opts.file = arg;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (!opts.file) {
    process.stderr.write("Error: no log file specified.\n\n" + HELP + "\n");
    process.exit(1);
  }

  if (opts.level && !isValidLevel(opts.level)) {
    process.stderr.write(
      `Error: invalid level '${opts.level}'. Valid levels: ${LEVELS.join(", ")}.\n`
    );
    process.exit(1);
  }

  const filePath = resolve(opts.file);
  if (!existsSync(filePath)) {
    process.stderr.write(
      `Error: file not found: ${filePath}\nCheck that the path exists and you have read permission.\n`
    );
    process.exit(2);
  }

  const stats = createStats();
  const threshold = opts.level ?? "debug";

  const tailer = await tailFile(
    filePath,
    (line) => {
      const severity = parseSeverity(line);
      if (severity) stats.record(severity);

      if (!severity || meetsThreshold(severity, threshold)) {
        console.log(formatLine(line, { json: opts.json }));
      }
    },
    (err) => {
      process.stderr.write(`Error reading file: ${err.message}\n`);
      process.exit(2);
    }
  );

  function shutdown() {
    tailer.stop();
    process.stderr.write(stats.formatSummary() + "\n");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
