import { z } from "zod";
export const taskPresetSchema = z
  .discriminatedUnion("kind", [
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
            version: z.string().regex(/^\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?$/),
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
  ])
  .superRefine((preset, context) => {
    if (preset.kind !== "upgrade") return;
    if (
      preset.manager !== "uv" &&
      preset.dependencies.some(
        (entry) => !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(entry.version),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Node upgrade targets require an exact semantic version",
      });
    const manifest = preset.manager === "uv" ? "pyproject.toml" : "package.json";
    const lockfile = { npm: "package-lock.json", pnpm: "pnpm-lock.yaml", uv: "uv.lock" }[
      preset.manager
    ];
    const directory = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
    if (
      !preset.manifest.endsWith(manifest) ||
      !preset.lockfile.endsWith(lockfile) ||
      directory(preset.manifest) !== directory(preset.lockfile)
    )
      context.addIssue({
        code: "custom",
        message:
          "upgrade manager requires its matching manifest and lockfile in the same package directory",
      });
    const names = preset.dependencies.map(
      (entry) => `${entry.section}:${entry.name.toLowerCase().replaceAll("_", "-")}`,
    );
    if (new Set(names).size !== names.length)
      context.addIssue({ code: "custom", message: "dependency authorizations must be unique" });
  });
export type TaskPreset = z.infer<typeof taskPresetSchema>;
