export const corpus = [
  '# Title\n\nSome *emphasis*, **strong**, `code` and [a link](http://example.com "t").\n',
  '- one\n- two\n  - nested\n\n1. first\n2. second\n',
  '> quote\n> > nested quote\n\n---\n',
  '```js\nconst a = 1 < 2\n```\n\n    indented code\n',
  '| a | b |\n|:--|--:|\n| 1 | 2 |\n',
  '~~struck~~ and "quotes" -- dashes... (c) (tm)\n',
  'Visit https://example.org/path?x=1 or www.example.com today.\n',
  '<div class="x">\n*html block*\n</div>\n\ninline <span>html</span> &amp; &copy; &#35;\n',
  '[ref] and ![img][ref]\n\n[ref]: /url "Title"\n',
  'line one  \nline two\\\nline three\n',
  'Setext\n======\n\nSub\n---\n',
  '* [ ] task-like\n* \\*escaped\\*\n',
]
