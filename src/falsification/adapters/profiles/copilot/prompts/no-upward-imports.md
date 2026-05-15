The constraint is `no-upward-imports`: no relative import in any
file under the scope may begin with `..` (escape its directory).
To falsify, propose at least one new file under the scope whose
import statement begins with `..` (e.g. `import x from "../../foo"`).