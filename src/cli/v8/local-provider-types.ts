export type LocalGrammarMode = 'auto' | 'gbnf' | 'json-schema' | 'outlines' | 'none';

export const LOCAL_GRAMMAR_MODES: readonly LocalGrammarMode[] = [
  'auto',
  'gbnf',
  'json-schema',
  'outlines',
  'none',
] as const;
