// This bootstrap and its config come from the harness, never from the candidate checkout.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const check = JSON.parse(process.argv[1]);
const subject = process.cwd();
const modules = "/opt/swarm-browser/node_modules";
const instrument = await mkdtemp(join(tmpdir(), "swarm-playwright-"));
try {
  if ((await realpath(modules)) !== modules)
    throw Error("trusted Playwright modules must not be redirected");
  const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  try {
    if ((await realpath(browserPath)) !== browserPath)
      throw Error("trusted Playwright modules and browsers must not be redirected");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const output = await mkdtemp(join(subject, "swarm-browser-artifacts-"));
  await mkdir(instrument, { recursive: true, mode: 0o700 });
  await symlink(modules, join(instrument, "node_modules"));
  await writeFile(join(instrument, "instrument.spec.mjs"), check.instrument.source, {
    mode: 0o400,
  });
  const config = {
    testDir: instrument,
    testMatch: "instrument.spec.mjs",
    outputDir: output,
    reporter: "json",
    workers: 1,
    retries: 0,
    forbidOnly: true,
    timeout: Math.max(1, check.timeoutMs - 1000),
    projects: [{ name: "chromium", use: { browserName: "chromium" } }],
    use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  };
  const configFile = join(instrument, "playwright.config.cjs");
  await writeFile(configFile, `module.exports=${JSON.stringify(config)};`, { mode: 0o400 });
  const guard = join(instrument, "module-boundary.mjs");
  await writeFile(
    guard,
    `
    import {registerHooks} from 'node:module';
    import {realpathSync} from 'node:fs';
    import {fileURLToPath} from 'node:url';
    const roots=${JSON.stringify([instrument, modules])};
    function admitted(url) {
      if(url.startsWith('node:')) return;
      if(!url.startsWith('file:')) throw Error('browser instrument refuses candidate modules: unsupported module URL');
      const file=realpathSync(fileURLToPath(url));
      if(!roots.some(root=>file.startsWith(root+'/'))) throw Error('browser instrument refuses candidate modules: '+file);
    }
    registerHooks({
      resolve(specifier,context,next){const result=next(specifier,context);admitted(result.url);return result;},
      load(url,context,next){admitted(url);return next(url,context);}
    });
  `,
    { mode: 0o400 },
  );
  const child = spawn(
    process.execPath,
    ["--import", guard, join(modules, "@playwright/test/cli.js"), "test", "--config", configFile],
    {
      cwd: instrument,
      env: { ...process.env, SWARM_SUBJECT_DIRECTORY: subject },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 128));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 127;
} finally {
  await rm(instrument, { recursive: true, force: true });
}
