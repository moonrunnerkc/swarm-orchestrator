import { extractClaims } from './share/transcript-verification';

export interface ShareTranscript {
  stepNumber: number;
  agentName: string;
  transcriptPath: string;
  rawContent: string;
  parsedAt: string;
}

export interface ShareIndex {
  changedFiles: string[];
  commandsExecuted: string[];
  testsRun: {
    command: string;
    verified: boolean;
    reason?: string;
  }[];
  prLinks: string[];
  gitCommits: {
    sha?: string;
    message: string;
    verified: boolean;
  }[];
  packageOperations: {
    operation: string;  // install, uninstall, update
    packages: string[];
  }[];
  buildOperations: {
    tool: string;  // tsc, webpack, vite, rollup, etc.
    verified: boolean;
  }[];
  lintOperations: {
    tool: string;  // eslint, prettier, biome, etc.
    verified: boolean;
  }[];
  mcpSections: {
    content: string;
    verified: boolean;
  }[];
  claims: {
    claim: string;
    verified: boolean;
    evidence?: string;
  }[];
}

export class ShareParser {
  /**
   * parse /share transcript and extract key facts with comprehensive verification
   */
  parse(content: string): ShareIndex {
    const index: ShareIndex = {
      changedFiles: [],
      commandsExecuted: [],
      testsRun: [],
      prLinks: [],
      gitCommits: [],
      packageOperations: [],
      buildOperations: [],
      lintOperations: [],
      mcpSections: [],
      claims: []
    };

    const lines = content.split('\n');

    // extract changed files
    index.changedFiles = this.extractChangedFiles(lines);

    // extract commands executed
    index.commandsExecuted = this.extractCommands(lines);

    // extract test runs
    index.testsRun = this.extractTestRuns(lines, index.commandsExecuted);

    // extract PR links
    index.prLinks = this.extractPRLinks(lines);

    // extract git commits
    index.gitCommits = this.extractGitCommits(lines, index.commandsExecuted);

    // extract package operations
    index.packageOperations = this.extractPackageOperations(lines, index.commandsExecuted);

    // extract build operations
    index.buildOperations = this.extractBuildOperations(lines, index.commandsExecuted);

    // extract lint operations
    index.lintOperations = this.extractLintOperations(lines, index.commandsExecuted);

    // extract MCP sections
    index.mcpSections = this.extractMcpSections(lines);

    // extract and verify claims
    index.claims = extractClaims(lines, index);

    return index;
  }

  private extractChangedFiles(lines: string[]): string[] {
    const files = new Set<string>();

    // look for git status output
    let inGitStatus = false;
    for (const line of lines) {
      if (line.includes('git status') || line.includes('git diff')) {
        inGitStatus = true;
        continue;
      }

      if (inGitStatus) {
        // match modified files
        const modifiedMatch = line.match(/^\s*modified:\s+(.+)$/);
        if (modifiedMatch && modifiedMatch[1]) {
          files.add(modifiedMatch[1].trim());
        }

        // match new files
        const newFileMatch = line.match(/^\s*new file:\s+(.+)$/);
        if (newFileMatch && newFileMatch[1]) {
          files.add(newFileMatch[1].trim());
        }

        // match deleted files
        const deletedMatch = line.match(/^\s*deleted:\s+(.+)$/);
        if (deletedMatch && deletedMatch[1]) {
          files.add(deletedMatch[1].trim());
        }

        // end of git status block
        if (line.trim() === '' || line.includes('$') || line.includes('>')) {
          inGitStatus = false;
        }
      }

      // also look for explicit file mentions in code blocks
      const filePathMatch = line.match(/^[\s]*(?:edited|created|modified|deleted):\s+([^\s]+\.[a-z]+)/i);
      if (filePathMatch && filePathMatch[1]) {
        files.add(filePathMatch[1]);
      }
    }

    return Array.from(files);
  }

  private extractCommands(lines: string[]): string[] {
    const commands: string[] = [];

    // Accumulator for multi-line Copilot CLI commands (continued with │ prefix)
    let pendingCopilotCmd = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        // Blank line ends any pending multi-line command
        if (pendingCopilotCmd) {
          commands.push(pendingCopilotCmd);
          pendingCopilotCmd = '';
        }
        continue;
      }

      // Copilot CLI transcript format: commands prefixed with box-drawing │ (U+2502)
      // e.g. "  │ source venv/bin/activate && python -m pytest tests/ -v"
      const copilotMatch = line.match(/^\s*\u2502\s+(.+)/);
      if (copilotMatch) {
        const fragment = copilotMatch[1].trim();
        // └ lines are output summaries (e.g. "└ 86 lines..."), not commands
        if (!fragment.startsWith('\u2514') && !fragment.match(/^\d+ lines/)) {
          if (pendingCopilotCmd) {
            // Continuation of a multi-line command (e.g. && on previous line)
            pendingCopilotCmd += ' ' + fragment;
          } else {
            pendingCopilotCmd = fragment;
          }
        } else if (pendingCopilotCmd) {
          // Output summary terminates the pending command
          commands.push(pendingCopilotCmd);
          pendingCopilotCmd = '';
        }
        continue;
      }

      // Non-│ line ends any pending multi-line Copilot command
      if (pendingCopilotCmd) {
        commands.push(pendingCopilotCmd);
        pendingCopilotCmd = '';
      }

      // look for command prompts
      if (line.match(/^[\$>]\s+/) || line.match(/^npm\s+/) || line.match(/^git\s+/)) {
        const cmd = line.replace(/^[\$>]\s+/, '').trim();
        if (cmd) {
          commands.push(cmd);
        }
      }

      // look for commands in code blocks
      if (line.includes('```') && i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (nextLine && (nextLine.startsWith('$') || nextLine.startsWith('npm') || nextLine.startsWith('git'))) {
          const cmd = nextLine.replace(/^[\$>]\s+/, '').trim();
          if (cmd) {
            commands.push(cmd);
          }
        }
      }
    }

    // Flush any trailing command
    if (pendingCopilotCmd) {
      commands.push(pendingCopilotCmd);
    }

    return commands;
  }

  private extractTestRuns(lines: string[], commands: string[]): ShareIndex['testsRun'] {
    const testRuns: ShareIndex['testsRun'] = [];

    // find test commands
    const testCommands = commands.filter(cmd =>
      cmd.includes('test') ||
      cmd.includes('jest') ||
      cmd.includes('mocha') ||
      cmd.includes('pytest') ||
      cmd.includes('go test') ||
      cmd.includes('cargo test')
    );

    for (const cmd of testCommands) {
      // verify test actually ran by looking for output
      const hasOutput = this.hasTestOutput(lines, cmd);

      if (hasOutput) {
        testRuns.push({
          command: cmd,
          verified: true
        });
      } else {
        testRuns.push({
          command: cmd,
          verified: false,
          reason: 'no test output found in transcript'
        });
      }
    }

    return testRuns;
  }

  private hasTestOutput(lines: string[], testCommand: string): boolean {
    // look for common test output patterns after the command
    const cmdIndex = lines.findIndex(line => line.includes(testCommand));
    if (cmdIndex === -1) return false;

    // check next 80 lines for test output (Node.js test runner can be verbose)
    const outputLines = lines.slice(cmdIndex + 1, cmdIndex + 81);

    for (const line of outputLines) {
      // mocha/jest patterns
      if (line.match(/\d+\s+passing/)) return true;
      if (line.match(/\d+\s+tests?\s+passed/)) return true;

      // pytest patterns
      if (line.match(/\d+\s+passed/)) return true;

      // go test patterns
      if (line.match(/PASS/)) return true;
      if (line.match(/ok\s+/)) return true;

      // Node.js built-in test runner patterns (node --test)
      if (line.match(/tests\s+\d+/)) return true;       // "ℹ tests 10"
      if (line.match(/pass\s+\d+/)) return true;        // "ℹ pass 10"
      if (line.match(/fail\s+0/)) return true;           // "ℹ fail 0"
      if (line.match(/duration_ms/)) return true;        // "ℹ duration_ms 123"

      // generic success patterns
      if (line.match(/all tests passed/i)) return true;
      if (line.match(/all\s+\d+\s+tests?\s+pass/i)) return true;
    }

    return false;
  }

  private extractPRLinks(lines: string[]): string[] {
    const links = new Set<string>();

    for (const line of lines) {
      // github PR URLs
      const prMatch = line.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g);
      if (prMatch) {
        prMatch.forEach(url => links.add(url));
      }

      // shortened PR references
      const shortMatch = line.match(/#(\d+)/g);
      if (shortMatch) {
        // note: we can't construct full URL without repo context
        // so we just note the PR number
        shortMatch.forEach(ref => links.add(ref));
      }
    }

    return Array.from(links);
  }

  private extractGitCommits(lines: string[], commands: string[]): ShareIndex['gitCommits'] {
    const commits: ShareIndex['gitCommits'] = [];
    const commitMap = new Map<string, { message?: string; sha?: string; verified?: boolean }>();

    // look for git commit commands in extracted commands list
    const commitCommands = commands.filter(cmd => cmd.match(/git\s+commit/));

    for (const cmd of commitCommands) {
      // try single-line quoted message first
      const messageMatch = cmd.match(/git\s+commit\s+-m\s+["']([^"']+)["']/);
      if (messageMatch && messageMatch[1]) {
        const message = messageMatch[1];
        commitMap.set(message, { message, verified: true });
      } else {
        // message may span multiple lines or have an unclosed quote;
        // grab everything after -m " as the first line of the message
        const partialMatch = cmd.match(/git\s+commit\s+-m\s+["'](.+)/);
        if (partialMatch && partialMatch[1]) {
          const message = partialMatch[1].replace(/["']$/, '').trim();
          if (message) {
            commitMap.set(message, { message, verified: true });
          }
        }
      }
    }

    // also scan raw lines for git commit commands that extractCommands may
    // have missed (e.g. chained commands: cd ... && git commit -m "...")
    for (const line of lines) {
      const inlineMatch = line.match(/git\s+commit\s+-m\s+["']([^"'\n]+)/);
      if (inlineMatch && inlineMatch[1]) {
        const message = inlineMatch[1].trim();
        if (message && !commitMap.has(message)) {
          commitMap.set(message, { message, verified: true });
        }
      }
    }

    // look for commit SHAs in git output
    // format: [branch-name sha] message  (branch can contain / and -)
    for (const line of lines) {
      const shaMatch = line.match(/\[[\w/.:-]+\s+([a-f0-9]{7,40})\]\s+(.+)/);
      if (shaMatch && shaMatch[1] && shaMatch[2]) {
        const sha = shaMatch[1];
        const messageAfterSha = shaMatch[2].trim();

        // try to match with an already-known commit
        let foundCommit = false;
        for (const [message, commit] of commitMap.entries()) {
          if (messageAfterSha.includes(message) || message.includes(messageAfterSha)) {
            commit.sha = sha;
            foundCommit = true;
            break;
          }
        }

        if (!foundCommit && messageAfterSha) {
          commitMap.set(messageAfterSha, { message: messageAfterSha, sha, verified: true });
        }
      }
    }

    // convert map to array
    for (const commit of commitMap.values()) {
      const result: ShareIndex['gitCommits'][0] = {
        message: commit.message || 'commit detected',
        verified: true
      };
      if (commit.sha) {
        result.sha = commit.sha;
      }
      commits.push(result);
    }

    return commits;
  }

  private extractPackageOperations(lines: string[], commands: string[]): ShareIndex['packageOperations'] {
    const operations: ShareIndex['packageOperations'] = [];
    const processedCommands = new Set<string>();

    // npm/yarn/pnpm patterns
    const packageManagers = ['npm', 'yarn', 'pnpm', 'bun'];

    for (const cmd of commands) {
      // skip if already processed
      if (processedCommands.has(cmd)) {
        continue;
      }

      for (const pm of packageManagers) {
        // install operations (install, add, i)
        const installMatch = cmd.match(new RegExp(`^${pm}\\s+(?:add|install|i)\\s+(.+)`));
        if (installMatch && installMatch[1]) {
          const argString = installMatch[1];
          // filter out flags and extract package names
          const packages = argString
            .split(/\s+/)
            .filter(p => p.trim() !== '' && !p.startsWith('-'));
          
          if (packages.length > 0) {
            operations.push({
              operation: 'install',
              packages
            });
            processedCommands.add(cmd);
            break; // found a match, move to next command
          }
        }

        // uninstall operations
        const uninstallMatch = cmd.match(new RegExp(`^${pm}\\s+(?:remove|uninstall|rm)\\s+(.+)`));
        if (uninstallMatch && uninstallMatch[1]) {
          const argString = uninstallMatch[1];
          const packages = argString
            .split(/\s+/)
            .filter(p => p.trim() !== '' && !p.startsWith('-'));
          
          if (packages.length > 0) {
            operations.push({
              operation: 'uninstall',
              packages
            });
            processedCommands.add(cmd);
            break;
          }
        }

        // update operations
        if (cmd.match(new RegExp(`^${pm}\\s+(?:update|upgrade)`))) {
          operations.push({
            operation: 'update',
            packages: ['all packages']
          });
          processedCommands.add(cmd);
          break;
        }
      }
    }

    return operations;
  }

  private extractBuildOperations(lines: string[], commands: string[]): ShareIndex['buildOperations'] {
    const operations: ShareIndex['buildOperations'] = [];
    const buildTools = [
      { tool: 'tsc', pattern: /\btsc\b/ },
      { tool: 'webpack', pattern: /\bwebpack\b/ },
      { tool: 'vite', pattern: /\bvite\s+build\b/ },
      { tool: 'rollup', pattern: /\brollup\b/ },
      { tool: 'esbuild', pattern: /\besbuild\b/ },
      { tool: 'swc', pattern: /\bswc\b/ },
      { tool: 'babel', pattern: /\bbabel\b/ },
      { tool: 'next', pattern: /\bnext\s+build\b/ },
      { tool: 'nuxt', pattern: /\bnuxt\s+build\b/ },
      { tool: 'npm build', pattern: /\bnpm\s+run\s+build\b/ },
      { tool: 'yarn build', pattern: /\byarn\s+build\b/ }
    ];

    for (const { tool, pattern } of buildTools) {
      const buildCmd = commands.find(cmd => pattern.test(cmd));
      if (buildCmd) {
        // verify build succeeded by looking for output
        const verified = this.hasBuildOutput(lines, buildCmd);
        operations.push({ tool, verified });
      }
    }

    return operations;
  }

  private hasBuildOutput(lines: string[], buildCommand: string): boolean {
    const cmdIndex = lines.findIndex(line => line.includes(buildCommand));
    if (cmdIndex === -1) return false;

    // check next 100 lines for build success indicators
    const outputLines = lines.slice(cmdIndex + 1, cmdIndex + 101);

    for (const line of outputLines) {
      // success patterns
      if (line.match(/build\s+succe(ss|eded)/i)) return true;
      if (line.match(/compiled successfully/i)) return true;
      if (line.match(/built in \d+/i)) return true;
      if (line.match(/✓.*built/i)) return true;
      if (line.match(/done in \d+/i)) return true;
      if (line.match(/successfully built/i)) return true;
    }

    return false;
  }

  private extractLintOperations(lines: string[], commands: string[]): ShareIndex['lintOperations'] {
    const operations: ShareIndex['lintOperations'] = [];
    const lintTools = [
      { tool: 'eslint', pattern: /\beslint\b/ },
      { tool: 'prettier', pattern: /\bprettier\b/ },
      { tool: 'biome', pattern: /\bbiome\s+(?:check|lint)\b/ },
      { tool: 'tslint', pattern: /\btslint\b/ },
      { tool: 'npm lint', pattern: /\bnpm\s+run\s+lint\b/ },
      { tool: 'yarn lint', pattern: /\byarn\s+lint\b/ }
    ];

    for (const { tool, pattern } of lintTools) {
      const lintCmd = commands.find(cmd => pattern.test(cmd));
      if (lintCmd) {
        // verify lint succeeded
        const verified = this.hasLintOutput(lines, lintCmd);
        operations.push({ tool, verified });
      }
    }

    return operations;
  }

  private hasLintOutput(lines: string[], lintCommand: string): boolean {
    const cmdIndex = lines.findIndex(line => line.includes(lintCommand));
    if (cmdIndex === -1) return false;

    // check next 50 lines for lint output
    const outputLines = lines.slice(cmdIndex + 1, cmdIndex + 51);

    for (const line of outputLines) {
      // success patterns
      if (line.match(/✓.*no.*(error|warning|problem)/i)) return true;
      if (line.match(/0\s+errors/i)) return true;
      if (line.match(/all.*passed/i)) return true;
      if (line.match(/✨.*done/i)) return true;
    }

    return false;
  }

  private extractMcpSections(lines: string[]): ShareIndex['mcpSections'] {
    const sections: ShareIndex['mcpSections'] = [];

    // look for MCP Evidence headers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (line.match(/##\s+MCP\s+Evidence/i)) {
        // extract section content (everything until next ## or end)
        let content = '';
        let j = i + 1;
        
        while (j < lines.length && !lines[j]?.match(/^##\s+/)) {
          content += (lines[j] || '') + '\n';
          j++;
        }

        const trimmedContent = content.trim();
        
        // verify MCP section has actual evidence
        const hasIssueRef = /issue\s+#?\d+/i.test(trimmedContent);
        const hasPrRef = /pr\s+#?\d+|pull request/i.test(trimmedContent);
        const hasWorkflowRef = /workflow|\.github\/workflows|CI/i.test(trimmedContent);
        const hasDecision = /decision|influenced|based on|considering/i.test(trimmedContent);

        const verified = (hasIssueRef || hasPrRef || hasWorkflowRef) && hasDecision && trimmedContent.length >= 50;

        sections.push({
          content: trimmedContent,
          verified
        });
      }
    }

    return sections;
  }

}

export default ShareParser;
