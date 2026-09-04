import { describe, expect, it } from "vitest";
import { armNamed } from "./arms.mjs";
import { budgets } from "./criteria.mjs";
import {
  armRunArgv,
  buildImageArgv,
  cliRecordFromLabel,
  cliTarballLabel,
  forwarderArgv,
  imageLabelArgv,
  imageDigests,
  internalNetwork,
  offlineArgv,
  prepareArgv,
  typeEnvironment,
  wallBudgetMinutes,
} from "./container.mjs";

const digest = "a".repeat(64);

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function flags(argv, name) {
  return argv.flatMap((entry, index) => (entry === name ? [argv[index + 1]] : []));
}

describe("images", () => {
  it("are named by digest, every one of them", () => {
    for (const reference of Object.values(imageDigests)) {
      expect(reference).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });

  it("builds from the pinned Dockerfile with the tarball named relative to the context", () => {
    const argv = buildImageArgv({ type: "go", imagesDirectory: "/c/images", tarball: "/c/images/swarm-13.1.9.tgz", tarballSha256: digest });

    expect(argv.slice(0, 2)).toEqual(["docker", "build"]);
    expect(flag(argv, "--file")).toBe("/c/images/Dockerfile.go");
    expect(flags(argv, "--build-arg")).toEqual(["SWARM_TARBALL=swarm-13.1.9.tgz", `SWARM_TARBALL_SHA256=${digest}`]);
    expect(argv.at(-1)).toBe("/c/images");
  });

  it("refuses to build an image it cannot label with the tarball's digest", () => {
    expect(() => buildImageArgv({ type: "go", imagesDirectory: "/c/images", tarball: "/c/images/swarm.tgz" })).toThrow(
      "needs the tarball's sha256",
    );
    expect(() => buildImageArgv({ type: "go", imagesDirectory: "/c/images", tarball: "/c/images/swarm.tgz", tarballSha256: "abc" })).toThrow(
      "needs the tarball's sha256",
    );
  });

  it("asks the image which tarball it holds, and records what it says or that it said nothing", () => {
    expect(imageLabelArgv("python")).toEqual([
      "docker",
      "image",
      "inspect",
      "--format",
      `{{index .Config.Labels "${cliTarballLabel}"}}`,
      "campaign-python",
    ]);
    expect(cliRecordFromLabel(`${digest}\n`)).toEqual({ tarballSha256: digest });
    expect(cliRecordFromLabel("")).toEqual({
      tarballSha256: null,
      reason: "the image carries no CLI tarball label, so which CLI it holds is not known from the image",
    });
    expect(cliRecordFromLabel("<no value>\n").tarballSha256).toBeNull();
  });
});

describe("the wall budget a run's CLI is given", () => {
  it("is the container budget less the suite timeout and two minutes, so the closing gates and the export fit", () => {
    expect(wallBudgetMinutes(45)).toBe(45 - budgets.suiteTimeoutMinutes - 2);
    expect(() => wallBudgetMinutes(budgets.suiteTimeoutMinutes + 2)).toThrow("leaves no wall budget");
  });
});

describe("the forwarder", () => {
  it("relays a local arm's port over HTTP from the internal network to the host, and is the only bridge to it", () => {
    const [start, attach] = forwarderArgv(armNamed("local-ollama"), "/h");

    expect(flag(start, "--network")).toBe(internalNetwork);
    expect(flag(start, "--volume")).toBe("/h/forwarder.mjs:/forwarder.mjs:ro");
    expect(start.slice(-4)).toEqual(["node", "/forwarder.mjs", "11434", "host.docker.internal"]);
    expect(start).not.toContain(imageDigests.forwarder);
    expect(attach).toEqual(["docker", "network", "connect", "bridge", "campaign-backend-11434"]);
  });

  it("relays a frontier arm to the provider's own host, so TLS passes through untouched", () => {
    const [start] = forwarderArgv(armNamed("frontier"));

    expect(start.at(-1)).toBe("TCP:api.anthropic.com:443");
  });
});

describe("the toolchain environment", () => {
  it("keeps every cache under the mounted workspace, so an ephemeral container loses nothing", () => {
    for (const type of ["node", "python", "go", "rust"]) {
      const paths = typeEnvironment(type).filter((entry) => entry.includes("/"));
      expect(paths.length).toBeGreaterThan(0);
      for (const entry of paths) {
        expect(entry.split("=")[1]).toContain("/work/.campaign");
      }
    }
    expect(typeEnvironment("python")[0]).toMatch(/^PATH=\/work\/\.campaign\/venv\/bin:/);
    expect(() => typeEnvironment("haskell")).toThrow("no toolchain environment");
  });
});

describe("a preparation run", () => {
  it("is the one run with the network on, under the install budget", () => {
    const argv = prepareArgv({ type: "python", workspace: "/w/repo", argv: ["python", "-m", "pip", "install", "-e", "."] });

    expect(flag(argv, "--network")).toBe("bridge");
    expect(flags(argv, "--volume")).toEqual(["/w/repo:/work"]);
    expect(argv.slice(argv.indexOf("timeout"))).toEqual(["timeout", "--signal=KILL", "900", "python", "-m", "pip", "install", "-e", "."]);
  });
});

describe("an offline run", () => {
  it("is on the internal network, bounded in CPU, memory and time", () => {
    const argv = offlineArgv({ type: "node", workspace: "/w/repo", argv: ["npm", "run", "--silent", "test"] });

    expect(flag(argv, "--network")).toBe(internalNetwork);
    expect(flag(argv, "--cpus")).toBe("4");
    expect(flag(argv, "--memory")).toBe("4g");
    expect(flag(argv, "--workdir")).toBe("/work");
    expect(argv.slice(argv.indexOf("timeout"))).toEqual(["timeout", "--signal=KILL", "600", "npm", "run", "--silent", "test"]);
  });
});

describe("an arm run", () => {
  const common = { type: "node", workspace: "/w/repo", outputDirectory: "/o/repo", task: "fix the failing test", maxSteps: 40, attempts: 3, timeoutSeconds: 1800 };

  it("points the packaged CLI at the forwarder by name and writes the bundle to the mount", () => {
    const argv = armRunArgv({ ...common, arm: armNamed("local-mlx") });

    expect(flag(argv, "--network")).toBe(internalNetwork);
    expect(flag(argv, "--memory")).toBe("8g");
    expect(flags(argv, "--volume")).toEqual(["/w/repo:/work", "/o/repo:/out"]);
    expect(flags(argv, "--env")).toEqual([
      "HOME=/home/campaign",
      "COREPACK_HOME=/work/.campaign/corepack",
      "npm_config_store_dir=/work/.campaign/pnpm-store",
    ]);
    const swarm = argv.slice(argv.indexOf("swarm"));
    expect(flag(swarm, "--model")).toBe("local:qwen3.8:27b");
    expect(flag(swarm, "--local-endpoint")).toBe("http://campaign-backend-8000:8000/v1");
    expect(flag(swarm, "--bundle")).toBe("/out/bundle");
    expect(flag(swarm, "--max-steps")).toBe("40");
    expect(flag(swarm, "--max-wall-minutes")).toBe(String(wallBudgetMinutes(30)));
    expect(flag(swarm, "--attempts")).toBe("3");
    expect(swarm).toContain("--no-tui");
    expect(swarm).toContain("--no-open-evidence");
    expect(swarm.at(-1)).toBe("fix the failing test");
  });

  it("hands a frontier arm its key from the harness environment and resolves the host to the forwarder", () => {
    const argv = armRunArgv({ ...common, arm: armNamed("frontier"), forwarderAddress: "172.30.0.2", key: "k" });

    expect(flags(argv, "--env").slice(0, 2)).toEqual(["ANTHROPIC_API_KEY=k", "HOME=/home/campaign"]);
    expect(flag(argv, "--add-host")).toBe("api.anthropic.com:172.30.0.2");
    expect(argv).not.toContain("--local-endpoint");
  });
});
