// Inputs for the reference-definition evaluator: link reference definitions in every block
// context the parser admits them, beside the neighbours whose line feeds the renderer decides.
export const corpus = [
  '[foo]: /url\n\ntext',
  '[foo]: /url "title"\n\n[foo]',
  '[foo]:\n/url\n"multi\nline title"\n\n[foo]',
  '[foo]: /a\n[foo]: /b\n\n[foo]',
  '[Foo Bar]: /x\n[BAZ]: <with space> \'t\'\n\n[foo bar] [baz]',
  'para\n\n[foo]: /url\n\nafter',
  '# head\n[foo]: /url\n## next',
  '- [foo]: /url',
  '> [foo]: /url',
  '> [foo]: /url\n> bar',
  '- [foo]: /url\n\n  > bar',
  '- a\n- [foo]: /url\n- b',
  '- a\n\n- [foo]: /url\n\n- b',
  '1. [foo]: /url\n   text\n2. two',
  '> - [foo]: /url\n>   - [bar]: /u2\n>     deep',
  '- > [foo]: /url\n  > text',
  '[foo]: /url\n```\ncode\n```\n[bar]: /b\n<div>\nhtml\n</div>\n[baz]: /c\n---',
  '[foo]: /url\n| a | b |\n|---|---|\n| 1 | 2 |',
  'text\n[foo]: /url\n',
  '    [foo]: /url\n\n[foo]',
  '[foo]: /url\n[bar]: /u\n[baz]: /v\n\n[foo][bar][baz]',
  '- [a]: /a\n  [b]: /b\n\n  para [a] [b]',
  '* x\n\n  [ref]: /r\n* y [ref]',
  '>> [n]: /nested\n>> q',
  '[foo]: /url\n\n- tight\n- list',
  '- [foo]: /url\n- [bar]: /bar',
  '[^note]: not a footnote here\n\n[x]: http://example.com "T"\n\n[x] and [^note]',
  '[]: /empty-label-is-not-a-definition\n\n[]',
  '[foo]: <>\n\n[foo]',
  '  [indented]: /two-spaces\n\n[indented]',
]

export const configurations = [
  { name: 'default', make: (markdownit) => markdownit() },
  { name: 'commonmark', make: (markdownit) => markdownit('commonmark') },
  { name: 'zero', make: (markdownit) => markdownit('zero').enable(['reference', 'list', 'blockquote', 'heading', 'fence']) },
  { name: 'typographer', make: (markdownit) => markdownit({ linkify: true, typographer: true, breaks: true, xhtmlOut: true }) },
]

export const project = (tokens) => tokens.map((t) => t.type === 'reference_definition'
  ? { type: t.type, tag: t.tag, nesting: t.nesting, level: t.level, map: t.map, block: t.block, hidden: t.hidden, label: t.meta && t.meta.label }
  : { type: t.type, tag: t.tag, nesting: t.nesting, level: t.level, map: t.map, content: t.content, markup: t.markup, info: t.info, block: t.block, hidden: t.hidden, attrs: t.attrs, meta: t.meta, children: t.children && project(t.children) })
