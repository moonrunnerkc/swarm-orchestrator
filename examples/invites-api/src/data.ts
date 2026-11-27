/** A person who can sign in. The tokens are synthetic fixtures for this example, not secrets. */
export interface User {
  readonly id: string;
  readonly name: string;
  readonly token: string;
}

/** A team, the user who runs it, and the names of everyone on it. */
export interface Team {
  readonly id: string;
  readonly ownerId: string;
  readonly members: string[];
}

/** An invite to a team: when it was issued, and who accepted it, if anyone has. */
export interface Invite {
  readonly teamId: string;
  readonly issuedAt: number;
  acceptedBy: string | null;
}

/** The seed users. */
export const users: readonly User[] = [
  { id: "u1", name: "Ada", token: "token-ada" },
  { id: "u2", name: "Grace", token: "token-grace" },
];

/** The seed teams: one, run by Ada. */
export const teams: readonly Team[] = [{ id: "team-1", ownerId: "u1", members: ["Ada"] }];

/** Every invite issued since the service started, by its token. */
export const invites = new Map<string, Invite>();
