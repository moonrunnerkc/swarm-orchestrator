import { describe, expect, it } from "vitest";
import {
  MalformedSwarmTomlError,
  parseSwarmToml,
  readSwarmToml,
  swarmTomlFileName,
} from "./swarm-toml.ts";

const fullFile = [
  "[providers]",
  'local_endpoint = "http://127.0.0.1:8000/v1"',
  "",
  "[gates]",
  'tests = "npm run test:fast"',
  "",
  "[budgets]",
  "max_steps = 25",
  "attempts = 2",
  "max_changed_files = 6",
  "max_added_lines = 200",
  "",
  "[models]",
  'pin = "local:qwen3.6:35b-a3b"',
  "",
].join("\n");

describe("a gate override written as a table", () => {
  it("carries the command with its severity and rule", () => {
    const toml = parseSwarmToml(
      '[gates]\ntests = { command = "npm run --silent test", severity = "advisory", parser = "exit-code" }\nlint = { command = "npm run lint" }\n',
      "swarm.toml",
    );

    expect(toml.gates).toEqual({
      tests: { command: "npm run --silent test", severity: "advisory", parser: "exit-code" },
      lint: { command: "npm run lint" },
    });
  });

  it("names the accepted shape when the table carries a key this build does not read", () => {
    const attempt = () =>
      parseSwarmToml('[gates]\ntests = { command = "x", timeout = 3 }\n', "swarm.toml");

    expect(attempt).toThrow(/\[gates\] tests/);
    expect(attempt).toThrow(/severity/);
  });
});

describe("parseSwarmToml on a well-formed file", () => {
  it("reads every section the build guide names", () => {
    const toml = parseSwarmToml(fullFile, "swarm.toml");

    expect(toml.providers).toEqual({
      localEndpoint: "http://127.0.0.1:8000/v1",
      localThinking: null,
    });
    expect(toml.gates).toEqual({ tests: "npm run test:fast" });
    expect(toml.budgets).toEqual({
      maxSteps: 25,
      attempts: 2,
      maxWallMinutes: null,
      maxChangedFiles: 6,
      maxAddedLines: 200,
    });
    expect(toml.models).toEqual({ pin: "local:qwen3.6:35b-a3b" });
  });

  it("treats every section and every key as optional", () => {
    const toml = parseSwarmToml("", "swarm.toml");

    expect(toml.providers.localEndpoint).toBeNull();
    expect(toml.gates).toEqual({});
    expect(toml.budgets.maxSteps).toBeNull();
    expect(toml.models.pin).toBeNull();
  });
});

describe("parseSwarmToml on a file this build cannot honour", () => {
  it("names an unknown table and lists the accepted ones", () => {
    const attempt = () => parseSwarmToml("[budget]\nmax_steps = 5\n", "swarm.toml");

    expect(attempt).toThrow(MalformedSwarmTomlError);
    expect(attempt).toThrow(/"budget" is not a table this build reads/);
    expect(attempt).toThrow(/providers, gates, budgets, models/);
  });

  it("names an unknown key, its table, and the keys the table accepts", () => {
    const attempt = () => parseSwarmToml("[budgets]\nmax_step = 5\n", "swarm.toml");

    expect(attempt).toThrow(MalformedSwarmTomlError);
    expect(attempt).toThrow(/\[budgets\] max_step is not a key this build reads/);
    expect(attempt).toThrow(
      /max_steps, attempts, max_wall_minutes, max_changed_files, max_added_lines/,
    );
  });

  it("says what was found and what is accepted when a value has the wrong shape", () => {
    const attempt = () => parseSwarmToml('[budgets]\nmax_steps = "forty"\n', "swarm.toml");

    expect(attempt).toThrow(MalformedSwarmTomlError);
    expect(attempt).toThrow(/\[budgets\] max_steps/);
    expect(attempt).toThrow(/a positive whole number/);
    expect(attempt).toThrow(/"forty"/);
  });

  it("refuses a zero budget rather than treating it as unlimited", () => {
    const attempt = () => parseSwarmToml("[budgets]\nmax_steps = 0\n", "swarm.toml");

    expect(attempt).toThrow(/\[budgets\] max_steps/);
    expect(attempt).toThrow(/a positive whole number/);
  });

  it("refuses a local endpoint that is not an http(s) url", () => {
    const attempt = () =>
      parseSwarmToml('[providers]\nlocal_endpoint = "127.0.0.1:8000"\n', "swarm.toml");

    expect(attempt).toThrow(/\[providers\] local_endpoint/);
    expect(attempt).toThrow(/http/);
  });

  it("refuses a gate override that is not a command string", () => {
    const attempt = () => parseSwarmToml("[gates]\ntests = 3\n", "swarm.toml");

    expect(attempt).toThrow(/\[gates\] tests/);
    expect(attempt).toThrow(/found 3/);
  });

  it("reports where broken TOML syntax stopped the parser", () => {
    const attempt = () => parseSwarmToml("[providers\n", "swarm.toml");

    expect(attempt).toThrow(MalformedSwarmTomlError);
    expect(attempt).toThrow(/swarm.toml/);
  });
});

describe("readSwarmToml", () => {
  it("returns null when the workspace has no swarm.toml, which is the zero-config default", async () => {
    const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });

    const found = await readSwarmToml({
      directory: "/work/repo",
      readFile: () => Promise.reject(missing),
    });

    expect(found).toBeNull();
  });

  it("reads and validates the file at the workspace root when it exists", async () => {
    const paths: string[] = [];

    const found = await readSwarmToml({
      directory: "/work/repo",
      readFile: (path) => {
        paths.push(path);
        return Promise.resolve('[models]\npin = "openai:gpt-5"\n');
      },
    });

    expect(paths).toEqual([`/work/repo/${swarmTomlFileName}`]);
    expect(found?.toml.models.pin).toBe("openai:gpt-5");
    expect(found?.path).toBe(`/work/repo/${swarmTomlFileName}`);
  });

  it("raises the validation error rather than quietly running on defaults", async () => {
    const attempt = readSwarmToml({
      directory: "/work/repo",
      readFile: () => Promise.resolve("[budgets]\nmax_step = 5\n"),
    });

    await expect(attempt).rejects.toThrow(MalformedSwarmTomlError);
  });
});

describe("the tables that decide what the screen does", () => {
  it("reads the interface table, and leaves each key null when it says nothing", () => {
    const parsed = parseSwarmToml(
      ["[interface]", "tui = false", 'color = "never"', 'open_evidence = "always"'].join("\n"),
      "swarm.toml",
    );

    expect(parsed.interface).toEqual({
      tui: false,
      color: "never",
      openEvidence: "always",
      confirmTimeoutMinutes: null,
    });
    expect(parseSwarmToml("", "swarm.toml").interface).toEqual({
      tui: null,
      color: null,
      openEvidence: null,
      confirmTimeoutMinutes: null,
    });
  });

  it("carries the theme and key tables through verbatim, for their own resolvers to judge", () => {
    const parsed = parseSwarmToml(
      ["[theme]", 'passed = "cyanBright"', "", "[keys]", 'pause = "space"'].join("\n"),
      "swarm.toml",
    );

    expect(parsed.theme).toEqual({ passed: "cyanBright" });
    expect(parsed.keys).toEqual({ pause: "space" });
  });

  it("names the key and the accepted set for an unknown interface key", () => {
    expect(() => parseSwarmToml("[interface]\nfullscreen = true\n", "swarm.toml")).toThrow(
      /\[interface\] fullscreen is not a key this build reads\. Accepted keys: tui, color, open_evidence, confirm_timeout_minutes\./,
    );
  });

  it("names what each interface value must look like", () => {
    expect(() => parseSwarmToml('[interface]\ncolor = "sometimes"\n', "swarm.toml")).toThrow(
      /\[interface\] color: expected "auto", "always" or "never", found "sometimes"/,
    );
    expect(() => parseSwarmToml('[interface]\ntui = "yes"\n', "swarm.toml")).toThrow(
      /\[interface\] tui: expected true or false, found "yes"/,
    );
  });

  it("lists the new tables among the ones it reads", () => {
    expect(() => parseSwarmToml("[screen]\nx = 1\n", "swarm.toml")).toThrow(
      /Accepted tables: providers, gates, budgets, models, interface, theme, keys\./,
    );
  });
});

describe("the settings added for local reasoning and unanswered questions", () => {
  it("reads both, and leaves them null when the file says nothing", () => {
    const set = parseSwarmToml(
      "[providers]\nlocal_thinking = false\n[interface]\nconfirm_timeout_minutes = 5\n",
      "swarm.toml",
    );
    expect(set.providers.localThinking).toBe(false);
    expect(set.interface.confirmTimeoutMinutes).toBe(5);

    const silent = parseSwarmToml("", "swarm.toml");
    expect(silent.providers.localThinking).toBeNull();
    expect(silent.interface.confirmTimeoutMinutes).toBeNull();
  });

  it("takes 0 minutes, which is the way back to waiting for ever", () => {
    const set = parseSwarmToml("[interface]\nconfirm_timeout_minutes = 0\n", "swarm.toml");
    expect(set.interface.confirmTimeoutMinutes).toBe(0);
  });

  it("says what each wants when it is given something else", () => {
    expect(() => parseSwarmToml('[providers]\nlocal_thinking = "yes"\n', "swarm.toml")).toThrow(
      /true or false/,
    );
    expect(() =>
      parseSwarmToml("[interface]\nconfirm_timeout_minutes = -1\n", "swarm.toml"),
    ).toThrow(/whole number of minutes/);
  });
});
