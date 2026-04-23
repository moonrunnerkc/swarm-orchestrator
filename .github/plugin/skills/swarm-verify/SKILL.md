# Swarm Verify

Evidence-based verification of agent outputs against transcript claims.

## Trigger

This skill activates when you need to:
- Verify that an agent's claimed outputs match actual evidence
- Cross-reference transcript claims against git commits, test results, and build outputs
- Determine whether a step passed or failed based on concrete evidence

## Instructions

1. Read the agent's transcript (the `/share` output from the Copilot CLI session)
2. Parse the transcript into structured evidence:
   - **Commits**: Extract git commit SHAs and diff summaries
   - **Tests**: Identify test execution output (pass/fail counts, framework output)
   - **Build**: Locate build or compile output (success/error messages)
   - **Claims**: Extract natural-language claims the agent made about its work
3. Cross-reference each claim against evidence:
   - "Tests pass" requires actual test runner output showing passes
   - "Code compiles" requires build output with no errors
   - "Changes committed" requires at least one commit SHA in the transcript
4. Mark unverified claims (claims with no supporting evidence)
5. Produce a verification result: pass (all required checks have evidence) or fail

## Verification Checks

| Check Type | Required Evidence |
|-----------|-------------------|
| commit | At least one git commit SHA in transcript |
| test | Test runner output with pass/fail counts |
| build | Compiler or bundler output with exit status |
| claim | Natural language claims matched to evidence |
| output | Expected output artifacts exist on disk |

## Graceful Degradation

When enabled, verification failure does not block execution. The step is marked as degraded with a reason, allowing the pipeline to continue while flagging the issue for review.

## Resources

- Share parser for transcript analysis
- Quality gates for post-merge validation: `skills/swarm-gates/SKILL.md`
