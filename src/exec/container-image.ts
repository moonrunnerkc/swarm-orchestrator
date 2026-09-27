import { z } from "zod";

/** Image identities cannot carry runtime options or shell syntax. */
export const containerImageSchema = z
  .string()
  .max(512)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/,
    "use a container image reference, not options or shell syntax",
  );
