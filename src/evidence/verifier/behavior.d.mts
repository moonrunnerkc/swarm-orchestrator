/** Independent assertion status from a sealed check and captured observation. */
export function behaviorStatus(
  check: unknown,
  observed: unknown,
): "accepted" | "rejected" | "unjudged";
