The constraint is `no-cycles`: the local import graph rooted at the
scope must contain no directed cycle. To falsify, propose new files
inside the scope whose imports form a cycle (e.g., A imports B,
B imports A; or a longer chain that closes back on itself).
Imports that resolve outside the scope are ignored, so the cycle
must be entirely between files inside the scope.