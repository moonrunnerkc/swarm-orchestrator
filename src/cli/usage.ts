export function showUsage(): void {
  console.log(`
Swarm Orchestrator - Falsification and Audit-Ready Orchestration for AI Coding Agents

Usage:
  swarm compile <goal>                   Compile a goal into a typed contract (v8 default)
  swarm run <contract>                   Run a compiled contract through the v8 pipeline
  swarm run --goal "<text>"              Compile + run in one step (add --v6 for legacy)
  swarm resume <run-id>                  Resume a killed run from the ledger
  swarm stats <run-id>                   Aggregate diagnostic counts from a run ledger
  swarm doctor                           Probe local prerequisites (API key, falsifiers, PMs)

  swarm bootstrap <path(s)> "Goal"       Deep analysis and plan generation (multi-repo)
  swarm plan <goal>                      Generate intelligent plan
  swarm plan --copilot <goal>            Generate Copilot CLI prompt for planning
  swarm plan import <runid> <transcript> Parse plan from Copilot /share transcript
  swarm execute <planfile>               Execute a saved plan step-by-step
  swarm swarm <planfile>                 Execute plan with verified branch/worktree workflow (analyzer-gated concurrency)
  swarm quick "task"                     Quick-fix mode for simple single-agent tasks
  swarm demo <scenario>                  Run pre-configured demo scenario
  swarm demo-fast                        Fast 2-step demo (alias for: swarm demo demo-fast)
  swarm demo list                        List available demo scenarios
  swarm gates [path]                     Run quality gates on a repo (default: cwd)
  swarm status <execid>                  Show execution status
  swarm templates                        List available plan templates
  swarm share import <runid> <step> <agent> <path>
                                         Import /share transcript for a step
  swarm share context <runid> <step>     Show prior context for a step
  swarm audit <session-id>               Generate Markdown audit report for a session
  swarm metrics <session-id>             Show metrics summary for a session
  swarm agents export [--output-dir dir] Export agents as .agent.md from execution history
  swarm use <recipe> [--param k=v ...]   Execute a pre-built recipe (see: swarm recipes)
  swarm recipes                          List available recipes
  swarm recipe-info <name>               Show recipe details and parameters
  swarm report <run-id>                  Generate structured run report from artifacts
  swarm attest verify <commit>           Verify swarm attestation git note
  swarm --help                           Show this help message

Flags:
  --delegate       Instruct agents to use /delegate for PR creation
  --mcp            Require MCP evidence from GitHub context in verification
  --model          Specify model for sessions (e.g., claude-sonnet-4.5)
  --resume <id>    Resume a previously paused/failed swarm session
  --agent          Specify agent for quick-fix mode
  --skip-verify    Skip verification in quick-fix mode (faster)
  --confirm-deploy Enable opt-in deployment for deployment steps (vercel, netlify)
  --no-quality-gates Disable quality gates (swarm mode)
  --pm               Run PM agent plan review before swarm execution
  --strict-isolation Force per-task branch isolation, transcript-only context
  --lean             Enable Delta Context Engine (reuse prior KB patterns)
  --useInnerFleet    Prefix prompts with /fleet for inner sub-agent dispatch
  --wrap-fleet       Enable /fleet prefix on all step prompts (alias for --useInnerFleet)
  --cost-estimate-only Run plan generation and cost estimation, print result, exit
  --max-premium-requests <n> Abort if estimated premium requests exceed budget
  --max-retries <n>    Max retry attempts for queued and repair retries (default 3)
  --quality-gates-config <path> Path to quality gates YAML (default: config/quality-gates.yaml)
  --quality-gates-out <dir>    Where to write gate reports (default: <runDir>/quality-gates)
  --pr <auto|review>   Create PRs instead of direct merge (auto: merge on pass, review: wait for approval)
  --owasp-report       Generate OWASP ASI compliance report after verification
  --tool <name>        Agent tool: copilot, claude-code, codex, claude-code-teams
  --target <dir>       Run execution in specified directory instead of cwd (alias: --dir)
  --hooks              Enable per-step hook injection for scope enforcement (default: on)
  --no-hooks           Disable hook injection for debugging
  --verbose            Enable debug-level logging
  --output json        Print machine-readable JSON for supported commands
  --yes, -y            Skip cost confirmation prompt (auto-approve)

Examples:
  swarm demo-fast
  swarm plan "Build a REST API for user management"
  swarm plan --output json "Build a REST API for user management"
  swarm swarm plan.json --model claude-opus-4.5 --verbose
  swarm metrics <session-id> --output json
`);
}
