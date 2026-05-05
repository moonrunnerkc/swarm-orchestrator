/**
 * Contract types mirroring src/contract/schema/v1.json.
 *
 * All obligation kinds are modeled as a discriminated union over the
 * `type` property. The envelope carries an `$id` URI, a semver version,
 * and a non-empty obligations array.
 *
 * @packageDocumentation
 */

/**
 * The single field that disambiguates obligation variants at runtime.
 */
export type ObligationKind =
  | "file-must-exist"
  | "build-must-pass"
  | "test-must-pass";

/**
 * A file-provision obligation: the generated output must contain a file
 * at the given relative path.
 *
 * @property type - Literal "file-must-exist".
 * @property path - Relative file path that must exist after generation.
 * @property description - Optional human-readable explanation.
 */
export interface FileMustExistObligation {
  readonly type: "file-must-exist";
  readonly path: string;
  readonly description?: string;
}

/**
 * A build-verification obligation: a shell command must exit with
 * exit code 0.
 *
 * @property type - Literal "build-must-pass".
 * @property command - Shell command string that must succeed.
 * @property description - Optional human-readable explanation.
 */
export interface BuildMustPassObligation {
  readonly type: "build-must-pass";
  readonly command: string;
  readonly description?: string;
}

/**
 * A test-verification obligation: a test runner command must exit
 * with exit code 0.
 *
 * @property type - Literal "test-must-pass".
 * @property command - Test runner command string that must succeed.
 * @property description - Optional human-readable explanation.
 */
export interface TestMustPassObligation {
  readonly type: "test-must-pass";
  readonly command: string;
  readonly description?: string;
}

/**
 * Discriminated union of all obligation kinds supported by the
 * v1 contract schema.
 */
export type Obligation =
  | FileMustExistObligation
  | BuildMustPassObligation
  | TestMustPassObligation;

/**
 * The contract envelope schema as defined in
 * src/contract/schema/v1.json.
 *
 * @property $id - Unique URI identifying this contract definition.
 * @property version - Semver string (e.g. "1.0.0").
 * @property obligations - Non-empty array of obligations that agents
 *                        must satisfy.
 */
export interface ContractEnvelope {
  readonly $id: string;
  readonly version: string;
  readonly obligations: readonly Obligation[];
}

/**
 * Type guard that narrows an Obligation to FileMustExistObligation.
 *
 * @param obligation - The value to test.
 * @returns `true` if `obligation.type === "file-must-exist"`.
 */
export function isFileMustExist(
  obligation: Obligation,
): obligation is FileMustExistObligation {
  return obligation.type === "file-must-exist";
}

/**
 * Type guard that narrows an Obligation to BuildMustPassObligation.
 *
 * @param obligation - The value to test.
 * @returns `true` if `obligation.type === "build-must-pass"`.
 */
export function isBuildMustPass(
  obligation: Obligation,
): obligation is BuildMustPassObligation {
  return obligation.type === "build-must-pass";
}

/**
 * Type guard that narrows an Obligation to TestMustPassObligation.
 *
 * @param obligation - The value to test.
 * @returns `true` if `obligation.type === "test-must-pass"`.
 */
export function isTestMustPass(
  obligation: Obligation,
): obligation is TestMustPassObligation {
  return obligation.type === "test-must-pass";
}
