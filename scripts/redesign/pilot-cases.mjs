import { z } from "zod";
import { titleFilterFor } from "../../src/eval/oracle-filter.ts";

export const pilotCaseIds = [
  "iamkun-dayjs-2948",
  "iamkun-dayjs-2330",
  "iamkun-dayjs-2640",
  "koajs-koa-1115",
  "koajs-koa-1828",
  "koajs-koa-1998",
  "tj-commander-js-1678",
  "tj-commander-js-2006",
  "tj-commander-js-2339",
  "jhlywa-chess-js-554",
  "jhlywa-chess-js-451",
  "jhlywa-chess-js-501",
  "gvergnaud-ts-pattern-319",
  "gvergnaud-ts-pattern-253",
  "gvergnaud-ts-pattern-270",
  "python-attrs-attrs-4b5b295b",
  "python-attrs-attrs-5aa76a44",
  "python-attrs-attrs-97f8d175",
  "pallets-click-271effb3",
  "pallets-click-f58ca3e8",
  "pallets-click-a1d87858",
  "pallets-itsdangerous-9b7b635a",
  "pallets-itsdangerous-c30678d1",
  "pallets-itsdangerous-7f4dcf83",
];
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
export const sourceCaseSchema = z.object({
  id: z.enum(pilotCaseIds),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  baseCommit: commit,
  mergeCommit: commit,
  sourceLink: z.string().url(),
  taskText: z.string(),
  language: z.enum(["javascript", "typescript", "python"]),
  previouslyExposed: z.boolean(),
  changed: z.array(z.string()),
  testFile: z.string().optional(),
  runner: z.string().optional(),
  sealedCases: z.array(z.string()).optional(),
  heldBackCases: z.array(z.string()).optional(),
});
export const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Both halves retain their real runner's filter, including Node's flag ordering. */
export function filteredCheck(candidate, destination, titles) {
  if (!titles?.length || !candidate.runner)
    throw new Error(`${candidate.id}: missing recorded test selector`);
  const runner = candidate.runner.includes("vitest")
    ? "vitest"
    : candidate.runner.includes("jest")
      ? "jest"
      : "node";
  const prefix =
    runner === "jest"
      ? ["./node_modules/.bin/jest", "--ci"]
      : runner === "vitest"
        ? ["./node_modules/.bin/vitest", "run"]
        : ["node", "--test"];
  const flags = titleFilterFor(runner, titles);
  if (flags === null) throw new Error(`${candidate.id}: unsupported selector`);
  const setup = ["jhlywa-chess-js-451", "jhlywa-chess-js-554"].includes(candidate.id)
    ? "npm run parser && "
    : "";
  return setup + [...prefix, ...flags, destination].map(quote).join(" ");
}

export const pythonGoals = {
  "python-attrs-attrs-4b5b295b": {
    goal: "Support generator functions as field-level and class-level on_setattr hooks. Run the pre-yield body before assignment, assign the yielded value, then run the post-yield body. Do not invoke hooks during initialization. Propagate exceptions while preserving whether assignment has occurred; reject a second yield and close that generator. Keep ordinary callable hooks and public typing support. Add maintained tests.",
    check: `import attrs, pytest
calls = []
def hook(instance, attribute, value):
    calls.append(('before', instance.value))
    yield value * 2
    calls.append(('after', instance.value))
for slots in [False, True]:
    @attrs.define(slots=slots, on_setattr=hook)
    class Box:
        value: int
    box = Box(3 + offset)
    before = len(calls)
    assert box.value == 3 + offset
    box.value = 7 + offset
    assert calls[before:] == [('before', 3 + offset), ('after', (7 + offset) * 2)]
    assert box.value == (7 + offset) * 2
closed = []
def twice(instance, attribute, value):
    try:
        yield value
        yield value + 1
    finally:
        closed.append(True)
@attrs.define
class Limited:
    value: int = attrs.field(on_setattr=twice)
limited = Limited(1)
with pytest.raises(RuntimeError):
    limited.value = 13 + offset
assert limited.value == 13 + offset and closed == [True]
for after_assignment in [False, True]:
    def fail(instance, attribute, value):
        if not after_assignment:
            raise ValueError('before')
        yield value
        raise ValueError('after')
    @attrs.define(on_setattr=fail)
    class Failing:
        value: int
    failing = Failing(3)
    with pytest.raises(ValueError, match='after' if after_assignment else 'before'):
        failing.value = 17 + offset
    assert failing.value == (17 + offset if after_assignment else 3)
@attrs.define(on_setattr=lambda instance, attribute, value: value + 1)
class Ordinary:
    value: int
ordinary = Ordinary(1)
ordinary.value = 19 + offset
assert ordinary.value == 20 + offset
`,
  },
  "python-attrs-attrs-5aa76a44": {
    goal: "Add ne(bound) to the public attr.validators and attrs.validators API and type stubs. Accept values unequal to bound and raise ValueError for an equal value, consistently with existing comparison validators. Preserve composition, meaningful repr, and exposed bound. Add maintained tests.",
    check: `import attr, attrs, pytest
assert attrs.validators.ne is attr.validators.ne
validator = attrs.validators.ne(11 + offset)
assert validator.bound == 11 + offset and '!=' in repr(validator)
@attrs.define
class Item:
    number: int = attrs.field(validator=validator)
for value in [10 + offset, 12 + offset]:
    assert Item(value).number == value
with pytest.raises(ValueError):
    Item(11 + offset)
@attrs.define
class Maybe:
    value: object = attrs.field(validator=attrs.validators.optional(validator))
assert Maybe(None).value is None
with pytest.raises(ValueError):
    Maybe(11 + offset)
`,
  },
  "python-attrs-attrs-97f8d175": {
    goal: "Recognize typing.ForwardRef values naming ClassVar annotations as class variables. Exclude these annotations from attrs fields, including slots and non-slots classes, while retaining normal instance annotations. Preserve existing string annotations. Add maintained regression tests.",
    check: `import attr, typing
for slots in [False, True]:
    for annotation in [typing.ForwardRef('ClassVar[int]'), typing.ForwardRef('typing.ClassVar[int]')]:
        class Source:
            __annotations__ = {'shared': annotation, 'value': int}
            shared = 31 + offset
            value = 5 + offset
        Model = attr.define(Source, slots=slots)
        assert set(attr.fields_dict(Model)) == {'value'}
        assert Model().value == 5 + offset
        assert Model.shared == 31 + offset
`,
  },
  "pallets-click-271effb3": {
    goal: "Add Option.get_help_spec(ctx), returning the spellings and metavar from the left help column even for hidden options. Preserve get_help_record behavior: hidden options return None and visible records retain their help description. Cover ordinary options, flags, secondary spellings and slash-prefixed forms. Add maintained tests.",
    check: `import click
ctx = click.Context(click.Command('program'))
for hidden in [False, True]:
    option = click.Option(['-n', '--number'], type=int, hidden=hidden, help='count')
    assert option.get_help_spec(ctx) == '-n, --number INTEGER'
    assert option.get_help_record(ctx) == (None if hidden else ('-n, --number INTEGER', 'count'))
    option = click.Option(['--enabled/--disabled'], hidden=hidden)
    assert option.get_help_spec(ctx) == '--enabled / --disabled'
    option = click.Option(['/verbose;/quiet'], hidden=hidden)
    assert option.get_help_spec(ctx) == '/verbose; /quiet'
    name = '--value' + str(offset)
    option = click.Option([name], metavar='ITEM', hidden=hidden)
    assert option.get_help_spec(ctx) == name + ' ITEM'
`,
  },
  "pallets-click-f58ca3e8": {
    goal: "Preserve Click Sentinel singleton identity through copy, deepcopy and pickle. Commands and options containing the unset sentinel must also duplicate correctly without changing their semantics. Cover every public sentinel member and supported pickle protocols. Add maintained tests.",
    check: `import copy, pickle, click
from click._utils import Sentinel, UNSET
protocols = [0, 2, 4] if offset == 0 else [1, 3, pickle.HIGHEST_PROTOCOL]
for sentinel in Sentinel:
    assert copy.copy(sentinel) is sentinel
    assert copy.deepcopy(sentinel) is sentinel
    for protocol in protocols:
        assert pickle.loads(pickle.dumps(sentinel, protocol)) is sentinel
option = click.Option(['--name'])
command = click.Command('greet', params=[option])
for duplicate in [copy.copy, copy.deepcopy, lambda value: pickle.loads(pickle.dumps(value))]:
    copied = duplicate(command)
    assert copied.params[0].default is UNSET
    assert copied.params[0].name == 'name'
`,
  },
  "pallets-click-a1d87858": {
    goal: "Allow click.edit filename to accept os.PathLike objects, including pathlib.Path, individually or in an iterable alongside strings. Preserve the return behavior and safely pass filenames containing spaces to the editor. Update public typing and add maintained tests.",
    check: `import click, pathlib, tempfile
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory, 'document ' + str(offset) + '.txt')
    for filename in [path, [path], [str(path)]]:
        path.write_text('before\\n', encoding='utf8')
        assert click.edit(filename=filename, editor="sed -i 's/before/after/'") is None
        assert path.read_text(encoding='utf8') == 'after\\n'
`,
  },
  "pallets-itsdangerous-9b7b635a": {
    goal: "Support key rotation in Signer, Serializer, URLSafeSerializer and JSONWebSignatureSerializer: accept one key or an ordered list from oldest to newest, sign with the newest, verify with every supplied key, and keep the existing single-key API. Reject signatures from keys not in the list. Add maintained integration tests.",
    check: `import itsdangerous as signing, pytest
keys = ['older-' + str(offset), 'newer-' + str(offset)]
for factory in [signing.Signer, signing.Serializer, signing.URLSafeSerializer, signing.JSONWebSignatureSerializer]:
    rotating, old, newest, outsider = [factory(value) for value in [keys, keys[0], keys[-1], 'outside']]
    if factory is signing.Signer:
        assert newest.unsign(rotating.sign(b'payload')) == b'payload'
        assert rotating.unsign(old.sign(b'payload')) == b'payload'
        with pytest.raises(signing.BadSignature):
            rotating.unsign(outsider.sign(b'payload'))
    else:
        assert newest.loads(rotating.dumps({'n': offset})) == {'n': offset}
        assert rotating.loads(old.dumps({'n': offset})) == {'n': offset}
        with pytest.raises(signing.BadSignature):
            rotating.loads(outsider.dumps({'n': offset}))
`,
  },
  "pallets-itsdangerous-c30678d1": {
    goal: "Reject a signed timestamp whose age is negative when max_age is supplied, using SignatureExpired with the original payload and signing timestamp. Preserve acceptance at age zero and within max_age, existing expiry behavior and return_timestamp support. Add maintained tests.",
    check: `import itsdangerous as signing, pytest
class Clocked(signing.TimestampSigner):
    current = 100000 + offset
    def get_timestamp(self):
        return self.current
signer = Clocked('development-fixture')
encoded = signer.sign(b'payload')
signer.current -= 1
with pytest.raises(signing.SignatureExpired) as refused:
    signer.unsign(encoded, max_age=10)
assert refused.value.payload == b'payload'
assert refused.value.date_signed is not None
signer.current += 1
assert signer.unsign(encoded, max_age=0) == b'payload'
signer.current += 5
assert signer.unsign(encoded, max_age=5, return_timestamp=True)[0] == b'payload'
signer.current += 1
with pytest.raises(signing.SignatureExpired):
    signer.unsign(encoded, max_age=5)
`,
  },
  "pallets-itsdangerous-7f4dcf83": {
    goal: "Do not access hashlib.sha1 while importing itsdangerous. Permit applications in environments without SHA-1 to import the package and select another digest for Signer and HMACAlgorithm. Retain SHA-1 as the default when available and preserve signatures. Add maintained tests.",
    check: `import hashlib
original = hashlib.sha1
del hashlib.sha1
import itsdangerous
from itsdangerous.signer import HMACAlgorithm
signer = itsdangerous.Signer('development-fixture', digest_method=hashlib.sha256)
assert signer.unsign(signer.sign(str(offset))) == str(offset).encode()
algorithm = HMACAlgorithm(hashlib.sha256)
signature = algorithm.get_signature(b'fixture', b'payload')
assert algorithm.verify_signature(b'fixture', b'payload', signature)
hashlib.sha1 = original
normal = itsdangerous.Signer('development-fixture')
assert normal.unsign(normal.sign(b'legacy')) == b'legacy'
`,
  },
};

export function pythonCheck(id, exposure) {
  const definition = pythonGoals[id];
  if (!definition) throw new Error(`No Python acceptance definition for ${id}`);
  return `offset = ${exposure === "sealed" ? 0 : 29}\n${definition.check}`;
}

export const pilotSettingsSchema = z.strictObject({
  model: z
    .string()
    .min(1)
    .refine((value) => !value.toLowerCase().includes("cloud")),
  endpoint: z.literal("http://127.0.0.1:11434/v1"),
  maxSteps: z.number().int().positive(),
  plannerSteps: z.number().int().positive(),
  attempts: z.number().int().nonnegative(),
  repairAttempts: z.number().int().min(0).max(8),
  graphRevisions: z.number().int().min(0).max(16),
  modelConcurrency: z.number().int().positive(),
  testConcurrency: z.number().int().positive(),
  worktreeConcurrency: z.number().int().positive(),
  cleanupMs: z.number().int().positive(),
});

export const pythonTyping = {
  "python-attrs-attrs-4b5b295b":
    "from typing import Any, Generator\nimport attrs\ndef hook(instance: Any, attribute: attrs.Attribute[int], value: Any) -> Generator[int, None, None]:\n    yield int(value)\n@attrs.define(on_setattr=hook)\nclass Box:\n    value: int = attrs.field(on_setattr=hook)\n",
  "python-attrs-attrs-5aa76a44":
    "import attrs, attr\nfrom attrs.validators import ne\n@attrs.define\nclass Box:\n    value: int = attrs.field(validator=ne(7))\ncomparison = attr.validators.ne(9)\n",
  "pallets-click-a1d87858":
    "import click\nfrom pathlib import Path\nfrom typing import Iterable\ndef edit(paths: Iterable[str | Path]) -> None:\n    click.edit(filename=Path('document.txt'))\n    click.edit(filename=paths)\n",
};
