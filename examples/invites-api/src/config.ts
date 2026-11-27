/**
 * What the service reads from its environment. INVITE_TTL_MS is how long an invite can be
 * accepted after it is issued, in milliseconds; a day where it is not set.
 */
export const settings = {
  inviteTtlMs: Number(process.env.INVITE_TTL_MS ?? 86_400_000),
};
