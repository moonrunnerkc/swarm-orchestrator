import { z } from "zod";
export const taskPresetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bugfix"), reproducer: z.string().min(1) }),
  z.strictObject({ kind: z.literal("refactor") }),
  z.strictObject({
    kind: z.literal("upgrade"),
    manager: z.enum(["npm", "pnpm", "uv"]),
    manifest: z.string().regex(/^(?:[A-Za-z0-9_-]+\/)*(?:package.json|pyproject.toml)$/),
    lockfile: z
      .string()
      .regex(/^(?:[A-Za-z0-9_-]+\/)*(?:package-lock.json|pnpm-lock.yaml|uv.lock)$/),
    dependencies: z
      .array(
        z.strictObject({
          name: z.string().regex(/^(?:@[a-z0-9_-]+\/)?[a-zA-Z0-9_.-]+$/),
          section: z.enum(["dependencies", "devDependencies"]),
          version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
        }),
      )
      .min(1)
      .max(32),
    sourcePaths: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/)
          .refine((path) => !path.split("/").includes("..")),
      )
      .max(256),
  }),
]);
export type TaskPreset = z.infer<typeof taskPresetSchema>;
