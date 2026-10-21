// What a sinon tree gives for the mock onCall case and the stub accessor case.
//   node probe-sinon-mock.mjs <tree>
import { pathToFileURL } from "node:url";
const tree = process.argv[2];
const { default: sinonMock } = await import(pathToFileURL(`${tree}/src/sinon/mock.js`).href);
const { default: createStub } = await import(pathToFileURL(`${tree}/src/sinon/stub.js`).href);

const object = {
  accumulator: [],
  accumulate(thing) {
    this.accumulator.push(thing);
    return `added ${thing}`;
  },
};
const mock = sinonMock(object);
for (const [index, thing] of ["first thing", "second thing", "third thing"].entries())
  mock.expects("accumulate").withArgs(thing).onCall(index).callsFake((value) => `mock-added ${value}`);
const results = [];
for (const thing of ["first thing", "second thing", "third thing"]) {
  try {
    results.push(object.accumulate(thing));
  } catch (error) {
    results.push(`threw ${error.name}: ${error.message.split("\n")[0]}`);
  }
}
let verify;
try {
  mock.verify();
  verify = "verify passed";
} catch (error) {
  verify = `verify threw ${error.name}: ${error.message.split("\n")[0]}`;
}
console.log(JSON.stringify({ results, accumulator: object.accumulator, verify }));

const myObj = { prop: "foo" };
const stub = createStub(myObj, "prop").get(() => "bar");
const reads = [myObj.prop, myObj.prop, myObj.prop];
console.log(JSON.stringify({ reads, getter: stub.getter === undefined ? "undefined" : `callCount ${stub.getter.callCount}` }));
const other = { prop: "foo" };
const setter = createStub(other, "prop").set((value) => {
  other.example = value;
});
other.prop = "bar";
other.prop = "baz";
console.log(JSON.stringify({ example: other.example, setter: setter.setter === undefined ? "undefined" : `callCount ${setter.setter.callCount}` }));
