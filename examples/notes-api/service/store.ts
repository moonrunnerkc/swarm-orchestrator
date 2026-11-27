/** An account that can call the service. The keys are synthetic fixtures, not secrets. */
export interface Account {
  readonly key: string;
  readonly handle: string;
}

/** One note, written by the account whose handle is its authorId. */
export interface Note {
  readonly slug: string;
  readonly authorId: string;
  readonly text: string;
}

/** The seed accounts. */
export const accounts: readonly Account[] = [
  { key: "key-lin", handle: "lin" },
  { key: "key-omar", handle: "omar" },
];

/** The seed notes: one for each account. */
export const notes: Note[] = [
  { slug: "n-1", authorId: "lin", text: "first" },
  { slug: "n-2", authorId: "omar", text: "second" },
];
