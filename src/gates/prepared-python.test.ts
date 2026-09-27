import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { stagePreparedPython } from "./prepared-python.ts";

it("stages an existing environment without sharing writes and refuses executable path injection", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-prepared-python-"));
  const repository = join(root, "repo"),
    checkout = join(root, "checkout");
  try {
    await mkdir(join(repository, ".venv/bin"), { recursive: true });
    await mkdir(join(repository, ".venv/lib"));
    await mkdir(join(checkout, ".git/info"), { recursive: true });
    await writeFile(join(checkout, "pyproject.toml"), '[project]\nname="fixture"');
    await writeFile(join(repository, ".venv/pyvenv.cfg"), "home = /usr/bin");
    await symlink("/usr/bin/python3", join(repository, ".venv/bin/python"));
    const source = join(repository, ".venv/lib/fixture.py");
    await writeFile(source, "value = 1");
    await stagePreparedPython({ repository, checkout });
    await writeFile(join(checkout, ".venv/lib/fixture.py"), "value = 2");
    expect(await readFile(source, "utf8")).toBe("value = 1");
    expect(await readFile(join(checkout, ".git/info/exclude"), "utf8")).toContain("/.venv/");
    await rm(join(checkout, ".venv"), { recursive: true });
    await writeFile(join(repository, ".venv/lib/editable.pth"), "/original/source");
    await expect(stagePreparedPython({ repository, checkout })).rejects.toThrow("path injection");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
