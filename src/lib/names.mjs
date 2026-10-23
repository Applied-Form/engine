/**
 * The names of the product, and the names they replace. Decision 0029 records the approval and the
 * table this file holds; every other file takes a name from here, so a name is spelled once.
 *
 * Every old name keeps working for one major version and prints one line on stderr (`deprecated`).
 * It is stderr only because stdout carries `--json` output and the MCP protocol. It is not
 * switchable. It never says "warning": test/af-audit.test.mjs counts the lines that do.
 *
 * This file imports nothing, so the open export can list it without pulling anything else in.
 */

export const PRODUCT = 'Standards';
export const FULL_NAME = 'Standards by Applied Form';
export const COMMAND = 'standards';
export const PACKAGE = '@appliedform/standards';
export const SERVER_NAME = 'io.github.Applied-Form/standards';
/** The client config key and the MCP serverInfo name. Decision 0029 (Q6): it stays `standards`; the foundation's server is `standards-schema`. */
export const CLIENT_KEY = 'standards';

/** The release that removes every old name below. The package major must stay under this one. */
export const REMOVE_IN = '5.0.0';

/** Files and directories: the name, and the one it replaces. */
export const CONFIG = { name: 'standards.config.json', legacy: 'af.config.json' };
export const BASELINE = { name: 'standards-baseline.json', legacy: 'af-baseline.json' };
export const DIR = { name: '.standards', legacy: '.af' };

/** Environment variables a user can set: the new name, and the old one it replaces. */
export const ENV = { STANDARDS_SYSTEM: 'AF_BRAND', STANDARDS_CHROMIUM: 'AF_CHROMIUM' };

/**
 * Internal, not for a person to set: the process that prints a file's deprecation line records the
 * file here, so the script it runs does not print the line again (src/lib/resolve-file.mjs).
 */
export const NOTED = 'STANDARDS_NOTED';

/** MCP tools: the old name, and the new one. A call under either name reaches the same handler. */
export const TOOL_MAP = {
  af_lint: 'standards_lint',
  af_fix: 'standards_fix',
  af_rules: 'standards_rules',
  af_tokens: 'standards_tokens',
  af_contrast: 'standards_contrast',
  af_brand: 'standards_brand',
  af_move: 'standards_move',
  af_system: 'standards_system',
  af_drift: 'standards_drift',
};

/**
 * The `<meta name="generator">` value of a report, and the two values older reports carry. A report
 * page is recognised by any of the three, permanently: a report written by an older release is
 * still a report.
 */
export const GENERATOR = 'standards audit';
export const LEGACY_GENERATORS = ['af audit', 'af report'];

/** The one deprecation line, without its newline. The caller writes it to stderr. */
export const deprecated = (old, current) =>
  `${old} is deprecated: use ${current}. ${old} will be removed in ${PRODUCT} ${REMOVE_IN}.`;
