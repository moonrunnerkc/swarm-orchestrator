// The accessor task's API requirement, as the audit established it: the spies a stub exposes as
// stub.getter and stub.setter must carry the surface sinon's own accessor spies carry, not only
// a call count. Written for the scoring checkout's root; exits 1 at the first requirement the
// tree does not meet. Used as a hidden check of the development trial and never shown to an arm.
import assert from "node:assert/strict";
import createStub from "./src/sinon/stub.js";
import spy from "./src/sinon/spy.js";

const names = (value) => {
  const seen = new Set();
  for (
    let at = value;
    at !== null && at !== Function.prototype && at !== Object.prototype;
    at = Object.getPrototypeOf(at)
  )
    for (const name of Object.getOwnPropertyNames(at)) seen.add(name);
  return seen;
};

// The reference surface: an accessor spy sinon.spy(obj, "prop", ["set"]) produces. Two of its
// names belong to the wrapping of an existing accessor (restore, wrappedMethod) and are not
// asked of a stub's replacement spy.
const spied = {};
Object.defineProperty(spied, "prop", {
  get() {
    return "foo";
  },
  set(value) {
    spied.example = value;
  },
  configurable: true,
});
const reference = spy(spied, "prop", ["set"]).set;
const required = [...names(reference)].filter(
  (name) => typeof reference[name] === "function" && !["restore", "wrappedMethod"].includes(name),
);

// 1. The setter spy: the task's own example, then the surface beyond it.
const obj = { prop: "foo" };
const setterStub = createStub(obj, "prop").set((value) => {
  obj.example = value;
});
obj.prop = "bar";
obj.prop = "baz";
assert.equal(obj.example, "baz", "the replacement setter runs");
assert.equal(setterStub.setter.callCount, 2, "stub.setter counts calls");
assert.ok(setterStub.setter.calledWith("bar"), "stub.setter.calledWith");
const missing = required.filter((name) => typeof setterStub.setter[name] !== "function");
assert.deepEqual(missing, [], `stub.setter lacks the accessor spy surface: ${missing.join(", ")}`);
assert.equal(setterStub.setter.withArgs("bar").callCount, 1, "stub.setter.withArgs filters calls");
assert.equal(setterStub.setter.getCall(1).args[0], "baz", "stub.setter.getCall");
assert.equal(setterStub.setter.firstCall.args[0], "bar", "stub.setter.firstCall");
setterStub.setter.resetHistory();
assert.equal(setterStub.setter.callCount, 0, "stub.setter.resetHistory");

// 2. The getter spy, the same way.
const read = { prop: "foo" };
const getterStub = createStub(read, "prop").get(() => "bar");
assert.equal(read.prop, "bar");
assert.equal(read.prop, "bar");
assert.equal(read.prop, "bar");
assert.ok(getterStub.getter.calledThrice, "stub.getter.calledThrice");
const missingGetter = required.filter((name) => typeof getterStub.getter[name] !== "function");
assert.deepEqual(missingGetter, [], `stub.getter lacks the accessor spy surface: ${missingGetter.join(", ")}`);
assert.equal(getterStub.getter.withArgs().callCount, 3, "stub.getter.withArgs");
assert.equal(getterStub.getter.returnValues[0], "bar", "stub.getter records return values");

// 3. What .get and .set did before must stay: chainable, configurable, restorable, reset.
const kept = { prop: "original" };
const chain = createStub(kept, "prop").get(() => "replaced");
assert.equal(chain.get(() => "again"), chain, ".get stays chainable");
assert.equal(Object.getOwnPropertyDescriptor(kept, "prop").configurable, true, "configurable as before");
chain.restore();
assert.equal(kept.prop, "original", "restore puts the original back");
const reset = { prop: "foo" };
const resetStub = createStub(reset, "prop").get(() => "bar");
assert.equal(typeof resetStub.getter, "function");
resetStub.resetBehavior();
assert.equal(resetStub.getter, undefined, "resetBehavior removes stub.getter");
assert.equal(resetStub.setter, undefined, "resetBehavior removes stub.setter");
process.stdout.write(`api check passed: ${required.length} spy methods present on stub.getter and stub.setter\n`);
