"use strict";

/**
 * The config parser. swarm.toml is a file rather than model output, but it is the one place
 * a scanner alleged prototype pollution, and the only thing standing against that claim is
 * a hand-written probe run once. Jazzer.js's prototype-pollution detector runs on every
 * input here, so the refutation is continuous instead of a note in a dismissal.
 *
 * What is under test:
 *   - parsing settles as a config or as MalformedSwarmTomlError, never anything else
 *   - no input reaches Object.prototype, whatever keys it spells
 *   - a config that comes back has the shape the rest of the loop reads it as
 */

const { strict: assert } = require("node:assert");

const { MalformedSwarmTomlError, parseSwarmToml } = require(
  "../.swarm/fuzz-build/config/swarm-toml.js",
);

/**
 * Checked explicitly as well as by the bug detector: the detector is what catches pollution
 * of any builtin, this is what pins the specific claim that was dismissed by hand.
 */
const pristinePrototypeKeys = Object.getOwnPropertyNames(Object.prototype).sort().join(",");

const nullableString = (value) => value === null || typeof value === "string";
const nullableNumber = (value) => value === null || typeof value === "number";

module.exports.fuzz = function (data) {
  let config;
  try {
    config = parseSwarmToml(data.toString("utf8"), "swarm.toml");
  } catch (error) {
    // A file that does not parse or does not validate is a user error the loop reports.
    // Every other way out is a finding.
    if (!(error instanceof MalformedSwarmTomlError)) {
      throw error;
    }
    assertPrototypeIntact();
    return;
  }

  assertPrototypeIntact();

  for (const [key, value] of Object.entries(config.providers)) {
    assert.ok(nullableString(value), `providers.${key} came back as ${typeof value}`);
  }
  for (const [key, value] of Object.entries(config.budgets)) {
    assert.ok(nullableNumber(value), `budgets.${key} came back as ${typeof value}`);
  }
  assert.ok(nullableString(config.models.pin), "models.pin came back as a non-string");

  for (const gate of Object.keys(config.gates)) {
    // Read straight into a command line, so an inherited key would be a command nobody
    // configured.
    assert.ok(
      Object.hasOwn(config.gates, gate),
      `gates.${gate} is inherited rather than configured`,
    );
    assert.equal(typeof config.gates[gate], "string", `gates.${gate} is not a command`);
  }
};

function assertPrototypeIntact() {
  assert.equal(
    Object.getOwnPropertyNames(Object.prototype).sort().join(","),
    pristinePrototypeKeys,
    "parsing a config reached Object.prototype",
  );
}
