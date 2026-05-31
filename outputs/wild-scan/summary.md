# Wild PR Scan — Summary

Generated: 2026-05-28T04:02:27.432Z

## Totals

- PRs audited: **48**
- Passed (no blocking findings): **42**
- PRs with at least one finding: **25**
- PRs with warn-or-error findings: **19**
- PRs with blocking-grade findings: **24**
- Total findings: **205**

## Per repository

| Repo                   | PRs | Pass | Warn/Err | Blocking |
| ---------------------- | --- | ---- | -------- | -------- |
| RooCodeInc/Roo-Code    | 8   | 6    | 142      | 63       |
| All-Hands-AI/OpenHands | 8   | 7    | 16       | 17       |
| continuedev/continue   | 8   | 8    | 10       | 10       |
| paul-gauthier/aider    | 8   | 6    | 5        | 7        |
| sst/opencode           | 8   | 8    | 15       | 5        |
| cline/cline            | 8   | 7    | 0        | 1        |

## Per detected agent

| Agent        | PRs | Warn/Err | Blocking |
| ------------ | --- | -------- | -------- |
| codex-cli    | 8   | 143      | 64       |
| unidentified | 32  | 29       | 22       |
| openhands    | 7   | 16       | 17       |
| claude-code  | 1   | 0        | 0        |

## Per detector category (totals)

| Category         | Total findings |
| ---------------- | -------------- |
| coverage-erosion | 97             |
| no-op-fix        | 87             |
| test-relaxation  | 12             |
| error-swallow    | 5              |
| assertion-strip  | 4              |

## Top-ranked individual findings (first 25)

| Score | Severity | Category  | Repo#PR                   | File                                                        | Message                                                                          |
| ----- | -------- | --------- | ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/docusaurus.config.ts                              | Source file apps/docs/docusaurus.config.ts was modified but no test file in the  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/eslint.config.mjs                                 | Source file apps/docs/eslint.config.mjs was modified but no test file in the rep |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/sidebars.ts                                       | Source file apps/docs/sidebars.ts was modified but no test file in the repositor |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/clientModules/scrollToAnchor.ts               | Source file apps/docs/src/clientModules/scrollToAnchor.ts was modified but no te |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/Codicon.tsx                        | Source file apps/docs/src/components/Codicon.tsx was modified but no test file i |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/CopyPageURL/index.tsx              | Source file apps/docs/src/components/CopyPageURL/index.tsx was modified but no t |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/GitHubInstallButtons/index.tsx     | Source file apps/docs/src/components/GitHubInstallButtons/index.tsx was modified |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/KangarooIcon.tsx                   | Source file apps/docs/src/components/KangarooIcon.tsx was modified but no test f |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/LucideIcon.tsx                     | Source file apps/docs/src/components/LucideIcon.tsx was modified but no test fil |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/NavbarSocialIcons/index.tsx        | Source file apps/docs/src/components/NavbarSocialIcons/index.tsx was modified bu |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/ProviderTable/index.tsx            | Source file apps/docs/src/components/ProviderTable/index.tsx was modified but no |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/SocialIcons/index.tsx              | Source file apps/docs/src/components/SocialIcons/index.tsx was modified but no t |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/components/VideoGrid.tsx                      | Source file apps/docs/src/components/VideoGrid.tsx was modified but no test file |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/constants.ts                                  | Source file apps/docs/src/constants.ts was modified but no test file in the repo |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/DocBreadcrumbs/Items/Home/index.tsx     | Source file apps/docs/src/theme/DocBreadcrumbs/Items/Home/index.tsx was modified |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/DocBreadcrumbs/StructuredData/index.tsx | Source file apps/docs/src/theme/DocBreadcrumbs/StructuredData/index.tsx was modi |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/DocBreadcrumbs/index.tsx                | Source file apps/docs/src/theme/DocBreadcrumbs/index.tsx was modified but no tes |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/DocItem/Content/index.tsx               | Source file apps/docs/src/theme/DocItem/Content/index.tsx was modified but no te |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/DocItem/index.js                        | Source file apps/docs/src/theme/DocItem/index.js was modified but no test file i |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/Footer/Copyright/index.tsx              | Source file apps/docs/src/theme/Footer/Copyright/index.tsx was modified but no t |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/Footer/Layout/index.tsx                 | Source file apps/docs/src/theme/Footer/Layout/index.tsx was modified but no test |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/Footer/LinkItem/index.tsx               | Source file apps/docs/src/theme/Footer/LinkItem/index.tsx was modified but no te |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/Footer/Links/MultiColumn/index.tsx      | Source file apps/docs/src/theme/Footer/Links/MultiColumn/index.tsx was modified  |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/Footer/Links/Simple/index.tsx           | Source file apps/docs/src/theme/Footer/Links/Simple/index.tsx was modified but n |
| 5     | warn     | no-op-fix | RooCodeInc/Roo-Code#12344 | apps/docs/src/theme/Footer/Links/index.tsx                  | Source file apps/docs/src/theme/Footer/Links/index.tsx was modified but no test  |
