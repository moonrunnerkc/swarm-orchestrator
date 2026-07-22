# Renders assets/audit-demo.gif. Requires vhs (charmbracelet), ttyd, ffmpeg,
# and `swarm` on PATH (npm link). Run from the repo root: vhs assets/demo.tape
Output assets/audit-demo.gif

Set Width 1400
Set Height 192
Set Theme { "background": "#0d1117", "foreground": "#e6edf3", "cursor": "#e6edf3", "selection": "#264f78", "black": "#484f58", "red": "#ff7b72", "green": "#3fb950", "yellow": "#d29922", "blue": "#58a6ff", "magenta": "#bc8cff", "cyan": "#39c5cf", "white": "#b1bac4", "brightBlack": "#6e7681", "brightRed": "#ffa198", "brightGreen": "#56d364", "brightYellow": "#e3b341", "brightBlue": "#79c0ff", "brightMagenta": "#d2a8ff", "brightCyan": "#56d4dd", "brightWhite": "#f0f6fc" }
Set FontFamily "DejaVu Sans Mono"
Set FontSize 17
Set Padding 20
Set TypingSpeed 30ms

# Hidden setup: word-wrap output at spaces so long finding lines never break
# mid-word at the terminal's hard column boundary. Output text is unchanged.
Hide
Type `swarm() { command swarm "$@" 2>&1 | fold -s -w 118; }`
Enter
Type "clear"
Enter
Show

Type "swarm audit --diff-file benchmarks/real-prs/diffs/cloudflare-workers-sdk/14132.diff"
Enter
Sleep 2s
Sleep 3s
