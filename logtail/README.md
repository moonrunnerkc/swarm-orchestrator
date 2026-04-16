# logtail

CLI tool that tails a log file in real time with severity filtering, JSON pretty-printing, and per-level stats on exit.

## Install

```bash
cd logtail
# No dependencies to install — uses only Node.js built-ins.
```

Requires Node.js >= 20.

## Usage

```bash
node src/cli.js <file> [options]
```

### Options

| Flag              | Description                                       |
|-------------------|---------------------------------------------------|
| `--level <level>` | Minimum severity to show: debug, info, warn, error, fatal |
| `--json`          | Pretty-print each log line as JSON                |
| `--help`          | Show usage and examples                           |

### Examples

Tail a log file, showing all lines:

```bash
node src/cli.js /var/log/app.log
```

Show only warnings and above:

```bash
node src/cli.js /var/log/app.log --level warn
```

Pretty-print JSON logs, errors only:

```bash
node src/cli.js /var/log/app.log --level error --json
```

Press `Ctrl+C` to stop — a severity breakdown is printed to stderr on exit.

## Exit codes

| Code | Meaning                              |
|------|--------------------------------------|
| 0    | Clean shutdown (including Ctrl+C)    |
| 1    | Bad arguments (missing file, bad level, unknown flag) |
| 2    | File error (not found, permission denied, read failure) |

## Tests

```bash
npm test
```
