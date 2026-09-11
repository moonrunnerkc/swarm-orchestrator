import { execFileSync } from "node:child_process";
import { z } from "zod";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { containerClientEnvironment } from "../../src/exec/container-backend.ts";
import {
  authoredCaseSchema,
  authorPrompt,
  caseTopics,
  checkerPrompt,
  vectorsSchema,
} from "./cases.mjs";
import { campaignRoot, exportSession, image, record, save, session } from "./evidence.mjs";
import { ask, endpoint, models } from "./model.mjs";

const evidence = await session("preparation");
const inventorySchema = z.object({
  models: z.array(z.object({ name: z.string(), digest: z.string(), size: z.number() })),
});
try {
  const inventory = inventorySchema.parse(
    await (await fetch("http://127.0.0.1:11434/api/tags")).json(),
  );
  const identities = Object.fromEntries(
    Object.entries(models).map(([role, name]) => {
      const installed = inventory.models.find((entry) => entry.name === name);
      if (!installed || installed.size < 1000000000)
        throw new Error(`local model ${name} is unavailable; do not substitute a cloud model`);
      return [role, installed];
    }),
  );
  const setup = {
    version: 1,
    build: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      env: harnessChildEnvironment().variables,
      timeout: 10000,
    }).trim(),
    endpoint,
    identities,
    image,
    imageId: execFileSync("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
      encoding: "utf8",
      env: containerClientEnvironment(),
      timeout: 10000,
    }).trim(),
    population:
      "ten model-authored synthetic utility fixtures; convenience population, not independent repositories",
    topics: caseTopics,
    rules: {
      authorRequestsPerCase: 1,
      checkerRequestsPerCase: 1,
      admission:
        "reference passes public and withheld checks; counterexample passes public and fails an executed withheld assertion",
      replacements: false,
      baselineCandidates: ["direct-once", "direct-feedback"],
      selection: [
        "most practice cases accepted by withheld checks",
        "least total measured latency",
        "direct-once",
      ],
      finalCases: "all admitted evaluation cases in declared order",
      comparison: "descriptive paired outcomes; no population non-inferiority claim",
      tokens: 20000,
      modelOutputTokens: 1800,
      wallMs: 180000,
      candidate: "ordinary runAgentTask with Qwen, Docker and one retry",
      security: "Docker only; other runtimes unavailable",
      firstUsers: "not observed",
    },
  };
  await record(evidence, "preparation-rules-frozen", setup);
  await save("setup.json", setup);
  for (const topic of caseTopics) {
    console.log(`author ${topic.id}`);
    try {
      const authored = await ask(
        evidence,
        models.author,
        authorPrompt(topic.topic),
        authoredCaseSchema,
        4500,
      );
      await save(`authored/${topic.id}.json`, { ...topic, ...authored });
    } catch (cause) {
      await save(`authored/${topic.id}.json`, { ...topic, unavailable: String(cause) });
    }
  }
  const { load } = await import("./evidence.mjs");
  for (const topic of caseTopics) {
    const authored = await load(`authored/${topic.id}.json`);
    if (authored.unavailable) continue;
    console.log(`checker ${topic.id}`);
    try {
      const checked = await ask(
        evidence,
        models.checker,
        checkerPrompt(authored.specification),
        vectorsSchema,
        3500,
      );
      await save(`checked/${topic.id}.json`, checked);
    } catch (cause) {
      await save(`checked/${topic.id}.json`, { unavailable: String(cause) });
    }
  }
  console.log(`preparation retained in ${campaignRoot}`);
} finally {
  await exportSession(evidence);
}
