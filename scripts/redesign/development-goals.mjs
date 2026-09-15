const node = (id, instruction, files, dependsOn = []) => ({
  id,
  title: id,
  instruction,
  files,
  dependsOn,
  acceptance: ["tests"],
});
const test = "import {test} from 'node:test'; import assert from 'node:assert/strict'; ";
export const developmentGoals = [
  {
    id: "missing-prerequisite",
    category: "missing-dependency",
    goal: "Add beta.js exporting beta=7 and consumer.js exporting doubledBeta() returning twice beta, with maintained tests. A prerequisite omitted from the supplied graph must be requested and repaired without restarting beta after it is accepted.",
    files: { "base.test.js": `${test}test('runtime',()=>assert.equal(1+1,2));\n` },
    nodes: [
      node(
        "a-consumer",
        "Create consumer.js exporting doubledBeta() by importing {beta} from './beta.js' and returning beta*2. Add consumer.test.js. The z-beta task owns beta.js. If that prerequisite is absent from your base, use coordinate with kind dependency-request, prerequisite z-beta, and the observed reason. Do not create beta.js outside your contract.",
        ["consumer.js", "consumer.test.js"],
      ),
      node(
        "z-beta",
        "Create beta.js exporting const beta=7 and beta.test.js exercising it. Preserve existing files.",
        ["beta.js", "beta.test.js"],
      ),
    ],
    check:
      "import assert from 'node:assert/strict'; import {beta} from '../beta.js'; import {doubledBeta} from '../consumer.js'; assert.equal(beta,7);assert.equal(doubledBeta(),14);",
    expected: "a dependency revision followed by acceptance, with beta landed once",
  },
  {
    id: "clean-behavioral-merge",
    category: "incompatible-behavior",
    goal: "Increase both independent constants: a must equal 2, b must be an integer at least 2. Preserve the existing integration invariant that a+b must not equal 4. Keep the protected regression and add maintained tests.",
    files: {
      "a.js": "export const a=1;\n",
      "b.js": "export const b=1;\n",
      "base.test.js":
        test +
        "import {a} from './a.js';import {b} from './b.js';test('integration invariant',()=>assert.notEqual(a+b,4));\n",
    },
    tasks: [
      "Change a.js to export a=2 and add a.test.js. Preserve b.js and the protected regression. This task is one part of a goal whose combined invariant is a+b!=4.",
      "Increase the integer b in b.js by at least one and add b.test.js. Preserve a.js and the protected regression. b=2 is the initial minimal candidate on the supplied base; if integrated feedback rejects it, a larger integer satisfying the original b>=2 requirement is authorized.",
    ],
    peerInformation: false,
    check:
      "import assert from 'node:assert/strict';import {a} from '../a.js';import {b} from '../b.js';assert.equal(a,2);assert.ok(Number.isInteger(b)&&b>=2);assert.notEqual(a+b,4);",
    expected:
      "a clean textual merge refused by the combined regression and a new bounded repair accepted",
  },
  {
    id: "textual-conflict",
    category: "merge-conflict",
    goal: "Enable both alpha and beta flags in config.js, preserving its public flags export and adding maintained tests for both. Independent edits were intentionally assigned the same initial line.",
    files: {
      "config.js": "export const flags={alpha:false,beta:false};\n",
      "base.test.js":
        test +
        "import {flags} from './config.js';test('flag shape',()=>{assert.equal(typeof flags.alpha,'boolean');assert.equal(typeof flags.beta,'boolean');});\n",
    },
    tasks: [
      "Enable flags.alpha in config.js, preserve the other existing flag, and add alpha.test.js. Do not implement the peer's beta flag task.",
      "Enable flags.beta in config.js, preserve the other existing flag, and add beta.test.js. Do not implement the peer's alpha flag task. On conflict repair, preserve already integrated peer changes.",
    ],
    peerInformation: false,
    check:
      "import assert from 'node:assert/strict';import {flags} from '../config.js';assert.deepEqual(flags,{alpha:true,beta:true});",
    expected:
      "overlapping independently produced patches cause a textual conflict and a new attempt integrates both",
  },
  {
    id: "interface-mismatch",
    category: "interface-mismatch",
    goal: "Expose service.lookupResult(store,id) as {ok:true,value} for present Map entries (including false and null) or {ok:false,error:'not-found'} for missing ones. Preserve service.lookup and client.get. Add client.getResult(id) forwarding the same explicit result contract. Implement maintained tests. The supplied decomposition contains an incorrect proposed consumer interface and must be corrected from final-check feedback.",
    files: {
      "service.js": "export function lookup(store,id){return store.get(id);}\n",
      "client.js":
        "import {lookup} from './service.js';export function client(store){return {get:id=>lookup(store,id)};}\n",
      "base.test.js":
        test +
        "import {client} from './client.js';test('legacy client',()=>assert.equal(client(new Map([['x',1]])).get('x'),1));\n",
    },
    nodes: [
      node(
        "producer",
        "Add service.lookupResult(store,id): use store.has to return {ok:true,value:store.get(id)} or {ok:false,error:'not-found'}. Preserve lookup. Add service.test.js.",
        ["service.js", "service.test.js"],
      ),
      node(
        "consumer",
        "Add client(store).getResult(id), preserving get, and add client.test.js. Initial interface proposal: {success:true,record} for present entries and {success:false,reason:'not-found'} for absent entries. This proposal is unverified and may be corrected from integrated check feedback without changing the goal's obligations.",
        ["client.js", "client.test.js"],
      ),
    ],
    check:
      "import assert from 'node:assert/strict';import {lookupResult} from '../service.js';import {client} from '../client.js';const s=new Map([['x',1],['n',null],['f',false]]);for(const [id,value] of s){assert.deepEqual(lookupResult(s,id),{ok:true,value});assert.deepEqual(client(s).getResult(id),{ok:true,value});assert.equal(client(s).get(id),value);}assert.deepEqual(client(s).getResult('missing'),{ok:false,error:'not-found'});",
    expected:
      "locally green producer and consumer fail the exact interface obligation, then goal repair corrects it",
  },
  {
    id: "interrupted-run",
    category: "interruption",
    goal: "Implement first.js first() returning 2, then second.js second() returning first()+1, with maintained tests. Resume after an injected crash immediately after the first accepted landing without a fresh budget or duplicate landing.",
    files: {
      "first.js": "export function first(){return 1;}\n",
      "base.test.js":
        test +
        "import {first} from './first.js';test('number',()=>assert.equal(typeof first(),'number'));\n",
    },
    nodes: [
      node("first", "Change first.js first() to return 2 and add first.test.js.", [
        "first.js",
        "first.test.js",
      ]),
      node(
        "second",
        "Create second.js exporting second(), importing first from first.js and returning first()+1. Add second.test.js.",
        ["second.js", "second.test.js"],
        ["first"],
      ),
    ],
    interruptAfterLanding: true,
    check:
      "import assert from 'node:assert/strict';import {first} from '../first.js';import {second} from '../second.js';assert.equal(first(),2);assert.equal(second(),3);",
    expected:
      "recorded post-landing crash resumes with one accepted first landing and the original remaining budget",
  },
  {
    id: "over-decomposition",
    category: "over-decomposition",
    goal: "Complete quote.js quote({subtotal,coupon,shipping}) using the pricing modules. All inputs are nonnegative finite numbers, coupon<=1. Apply discount(subtotal,coupon), then add shipping, then tax at 20% on the discounted subtotal only. Return the numeric total. Invalid input throws TypeError. Preserve module exports and add maintained interaction tests. The supplied tiny tasks omit wiring quote.js; recover by combining their coupled obligations.",
    files: {
      "quote.js": "export function quote({subtotal}){return subtotal;}\n",
      "base.test.js":
        test +
        "import {quote} from './quote.js';test('zero quote',()=>assert.equal(quote({subtotal:0,coupon:0,shipping:0}),0));\n",
    },
    nodes: [
      node(
        "discount",
        "Create discount.js exporting discount(subtotal,coupon) returning subtotal*(1-coupon), and discount.test.js. Validate nonnegative finite subtotal and finite coupon 0..1. quote.js is authorized for later integration, but this initial node implements only the discount module.",
        ["discount.js", "discount.test.js", "quote.js", "quote.test.js"],
      ),
      node(
        "shipping",
        "Create shipping.js exporting addShipping(subtotal,shipping) returning their sum, and shipping.test.js. Validate nonnegative finite inputs. quote.js is authorized for later integration, but this initial node implements only the shipping module.",
        ["shipping.js", "shipping.test.js", "quote.js", "quote.test.js"],
      ),
      node(
        "tax",
        "Create tax.js exporting tax(subtotal) returning subtotal*0.2, and tax.test.js. Validate nonnegative finite input. quote.js is authorized for later integration, but this initial node implements only the tax module.",
        ["tax.js", "tax.test.js", "quote.js", "quote.test.js"],
      ),
    ],
    check:
      "import assert from 'node:assert/strict';import {quote} from '../quote.js';assert.equal(quote({subtotal:100,coupon:0.1,shipping:5}),113);assert.equal(quote({subtotal:20,coupon:1,shipping:3}),3);for(const input of [{subtotal:-1,coupon:0,shipping:0},{subtotal:1,coupon:2,shipping:0},{subtotal:1,coupon:0,shipping:Infinity}])assert.throws(()=>quote(input),TypeError);",
    expected:
      "all local tasks may pass while quote remains incomplete; final goal repair combines their requirements into one worker",
  },
];
