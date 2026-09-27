/**
 * Vitest, in process, reporting JSON to a file the script then prints as the whole of stdout.
 * The JSON reporter on stdout is not enough: a suite that logs, or a project whose test
 * script prints its own verdicts, mixes text into the stream and the report reads as
 * malformed. Stdout is muted while the suite runs, the report file is read on exit (which is
 * how vitest leaves), and its bytes are all that is written.
 */
const vitest = [
  "import {createRequire} from 'node:module';",
  "import {pathToFileURL} from 'node:url';",
  "import {dirname,join} from 'node:path';",
  "import {mkdtempSync,readFileSync,writeSync,rmSync} from 'node:fs';",
  "import {tmpdir} from 'node:os';",
  "const require=createRequire(process.cwd()+'/package.json');",
  "const entry=join(dirname(require.resolve('vitest/package.json')),'vitest.mjs');",
  "const dir=mkdtempSync(join(tmpdir(),'swarm-vitest-'));",
  "const report=join(dir,'report.json');",
  "const write=process.stdout.write.bind(process.stdout);",
  "process.stdout.write=()=>true;",
  // The whole report, however large: a synchronous write to a pipe at exit is partial past
  // the pipe's buffer (64 KiB), so the loop resumes at the bytes written and waits out EAGAIN
  // while the reader drains. A report cut at 64 KiB read as malformed on every large suite.
  "process.on('exit',()=>{process.stdout.write=write;let bytes;try{bytes=readFileSync(report)}catch(cause){bytes=Buffer.from(JSON.stringify({unavailable:'vitest wrote no report: '+String(cause)}))}let at=0;while(at<bytes.length){try{at+=writeSync(1,bytes,at,bytes.length-at)}catch(cause){if(cause.code!=='EAGAIN')throw cause}}try{rmSync(dir,{recursive:true,force:true})}catch{}});",
  "process.argv=[process.argv[0],entry,'run','--reporter=json','--outputFile='+report];",
  "await import(pathToFileURL(entry).href);",
].join("");

const pytest = `import json,subprocess,sys,tempfile,xml.etree.ElementTree as ET
with tempfile.TemporaryDirectory(prefix="swarm-pytest-") as d:
 p=d+"/results.xml"
 result=subprocess.run([sys.executable,"-m","pytest","-q","--junitxml="+p],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  with open(p,"rb") as f: raw=f.read(4000001)
  if len(raw)>4000000 or b"<!DOCTYPE" in raw: raise ValueError("invalid report")
  root=ET.fromstring(raw)
  tests=[]
  for t in root.iter("testcase"):
   status="error" if t.find("error") is not None else "failed" if t.find("failure") is not None else "skipped" if t.find("skipped") is not None else "passed"
   tests.append({"id":t.get("classname","")+":"+t.get("name",""),"status":status})
  print(json.dumps({"schema":"swarm.pytest.v1","tests":tests}))
 except Exception as e: print(json.dumps({"unavailable":str(e)}))
 sys.exit(result.returncode)
`;

/** Recognize complete supported commands; anything else retains its existing measurement limits. */
export function structuredRunner(body: string | undefined): readonly string[] | null {
  if (body === "vitest" || body === "vitest run")
    return ["node", "--input-type=module", "-e", vitest];

  if (body === "uv run --locked --no-sync python -m pytest -q")
    return ["uv", "run", "--locked", "--no-sync", "python", "-c", pytest];
  const interpreter = /^((?:\.\.\/){0,32}\.venv\/bin\/python) -m pytest -q$/.exec(body ?? "")?.[1];
  if (interpreter !== undefined) return [interpreter, "-c", pytest];
  return null;
}

/** Display the exact vector while protecting literals if a legacy runner needs a shell rendering. */
export function renderRunnerArgv(argv: readonly string[]): string {
  return argv.map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(" ");
}
