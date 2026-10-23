const SVG = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'
const XHTML = 'http://www.w3.org/1999/xhtml'
const OTHER = 'https://example.com/other'
const root = (attrs, body) => `<svg xmlns="${SVG}" xmlns:xlink="${XLINK}"${attrs}>${body}</svg>`
export const corpus = [
  // anchors whose prefix is bound to the SVG namespace
  root(` xmlns:svg="${SVG}"`, '<svg:a xlink:href="javascript:alert(1)"><text>prefixed</text></svg:a><rect width="1"/>'),
  root('', `<s:a xmlns:s="${SVG}" href="javascript:void 0"><rect width="2"/><circle r="1"/></s:a>`),
  root(` xmlns:x="${OTHER}"`, `<g xmlns:x="${SVG}"><x:a href="javascript:1"><path d="M0 0"/></x:a></g>`),
  root(` xmlns:svg="${SVG}"`, '<svg:a href="java&#9;script:alert(1)"><text>both</text></svg:a>'),
  // tab, line feed and carriage return inside the scheme
  root('', '<a href="java&#9;script:alert(1)"><text>tab</text></a>'),
  root('', '<a xlink:href="java&#10;script:alert(1)"><text>lf</text></a>'),
  root('', '<a href="java&#13;script:alert(1)"><text>cr</text></a>'),
  root('', '<a href="j&#9;a&#10;v&#13;a&#9;s&#10;cript:alert(1)"><text>mixed</text></a>'),
  root('', '<a href="JaVa&#9;ScRiPt:alert(1)"><text>case</text></a>'),
  root('', '<a href="vb&#9;script:msgbox(1)"><text>vb</text></a>'),
  root('', '<a href="data:text/ht&#10;ml,&lt;script&gt;alert(1)&lt;/script&gt;"><text>data</text></a>'),
  root(` xmlns:xhtml="${XHTML}"`, '<foreignObject width="10" height="10"><xhtml:iframe src="java&#9;script:alert(1)" title="f"/><xhtml:a href="java&#10;script:x" class="k">k</xhtml:a></foreignObject>'),
  // preserved: other namespaces, scoping, safe URLs
  root(` xmlns:custom="${OTHER}"`, '<custom:a href="javascript:alert(1)"><text>custom</text></custom:a>'),
  root(` xmlns:x="${SVG}"`, `<g xmlns:x="${OTHER}"><x:a href="javascript:1"><path d="M1 1"/></x:a></g><x:a href="javascript:2"><path d="M2 2"/></x:a>`),
  root(` xmlns:svg="${SVG}"`, '<svg:a href="https://example.com/"><text>safe prefixed</text></svg:a>'),
  root('', '<a href="https://example.com/java&#9;script:x"><text>t</text></a><a href="#frag"><text>f</text></a><a xlink:href="data:image/png;base64,AAAA"><text>p</text></a>'),
  root('', '<a href="javascript-docs.html"><text>d</text></a><a href="java script:alert(1)"><text>s</text></a>'),
  root('', '<a href="&#10;&#9; javascript:alert(1)"><text>leading</text></a>'),
  // existing script removal
  root(` xmlns:svg="${SVG}" xmlns:xhtml="${XHTML}"`, '<script>alert(1)</script><svg:script>alert(2)</svg:script><rect onclick="alert(3)" width="3"/><foreignObject><xhtml:script>x</xhtml:script><xhtml:div onmouseover="y" srcdoc="z">v</xhtml:div></foreignObject>'),
  root('', '<g><rect width="1"/><a href="javascript:x">  <rect width="2"/>text<circle r="3"/></a><rect width="4"/></g>'),
  root(` xmlns:svg="${SVG}"`, '<a href="javascript:a"><path d="M0 0"/></a><svg:a xlink:href="vbscript:b"><path d="M1 1"/></svg:a><a href="java&#10;script:c"><path d="M2 2"/></a>'),
]
