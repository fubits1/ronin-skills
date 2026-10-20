import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const RULE_KINDS = ["allow", "deny", "ask"];
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

// "Bash(<x>)" -> "<x>", a bare "Bash" (every Bash command) -> "*"; anything else -> null
function bashRuleBody(rule) {
  if (typeof rule !== "string") {
    return null;
  }
  if (rule === "Bash") {
    return "*";
  }
  if (!rule.startsWith("Bash(") || !rule.endsWith(")")) {
    return null;
  }
  return rule.slice(5, -1);
}

// git's stdout, or null when git fails (not a repository, path not tracked, git missing)
function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
  } catch {
    return null;
  }
}

/**
 * the repository root Claude Code keys trust and the local settings file on: the main checkout for
 * a linked worktree (the one case where `--git-dir` and `--git-common-dir` differ), null outside a
 * repository
 */
function repositoryRoot(dir, git) {
  const output = git(
    [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ],
    dir,
  );
  if (output === null) {
    return null;
  }
  const [topLevel, gitDir, commonDir] = output.trim().split("\n");
  return gitDir === commonDir ? topLevel : dirname(commonDir);
}

/**
 * Claude Code's record of accepted trust dialogs: `projects["<path>"].hasTrustDialogAccepted` in
 * `~/.claude.json` (permissions docs, "What runs before you trust a folder"). with
 * CLAUDE_CONFIG_DIR set, "all settings … are stored under this path", so the file is read from
 * there instead (inferred: the docs don't name the file for that case)
 */
function readTrustedProjects(env, home) {
  return (
    readJson(join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"))?.projects ??
    {}
  );
}

// a missing, unreadable or invalid file reads as null
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const isTrusted = (projects, dir) =>
  projects?.[dir]?.hasTrustDialogAccepted === true;

// outside a repository, trust in a parent folder extends to its subdirectories
function isTrustedOrUnderTrusted(projects, dir) {
  for (let current = dir; ; current = dirname(current)) {
    if (isTrusted(projects, current)) {
      return true;
    }
    if (dirname(current) === current) {
      return false;
    }
  }
}

/**
 * "your configuration home is your home directory, or a directory whose `.claude` subdirectory
 * you've set as CLAUDE_CONFIG_DIR": its local file applies without trust or git checks
 */
function isConfigurationHome(dir, env, home) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  const configHome =
    configDir && basename(configDir) === ".claude" ? dirname(configDir) : home;
  return resolve(dir) === resolve(configHome);
}

// the file is repository-supplied when "tracked in git, or `.claude` is a symlink"
function isOwnLocalFile(dir, git) {
  if (lstatSync(join(dir, ".claude")).isSymbolicLink()) {
    return false;
  }
  const tracked = git(
    ["ls-files", "--error-unmatch", "--", ".claude/settings.local.json"],
    dir,
  );
  return tracked === null;
}

/**
 * settings files to read, each flagged with whether its allow rules may GRANT. deny/ask rules only
 * restrict, so they are read from every file Claude Code could apply. allow rules grant exactly
 * when Claude Code itself applies them (permissions docs, "Project allow rules and workspace
 * trust"):
 *   - user `settings.json` (`$CLAUDE_CONFIG_DIR` honoured): always
 *   - project `.claude/settings.json`, loaded from the directory the session started in: only once
 *     the trust dialog was accepted for the repository root (or that folder outside a repository);
 *     "trusting a parent folder doesn't count for these rules"
 *   - `.claude/settings.local.json` at the repository root (main checkout for a worktree), where
 *     "Yes, and don't ask again" saves rules: right away in your configuration home; elsewhere
 *     once the folder is trusted (outside a repository a trusted parent counts), and only while it
 *     is your own file
 * a session started in ~ makes the project file the user file; the first entry (granting) wins.
 * SNIP_WRAPPER_SETTINGS replaces the whole list with one granting file (tests, diagnostics).
 */
export function settingsFiles({
  projectDir = process.cwd(),
  env = process.env,
  home = homedir(),
  git = runGit,
  trustedProjects = () => readTrustedProjects(env, home),
} = {}) {
  if (env.SNIP_WRAPPER_SETTINGS) {
    return [{ path: env.SNIP_WRAPPER_SETTINGS, grants: true }];
  }
  const userDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const startDir = resolve(projectDir);
  const repoRoot = repositoryRoot(startDir, git);
  const trustKey = repoRoot ?? startDir;
  let projects;
  const trust = () => (projects ??= trustedProjects());

  const projectPath = join(startDir, ".claude", "settings.json");
  const localPath = join(trustKey, ".claude", "settings.local.json");
  const localGrants = () => {
    if (isConfigurationHome(trustKey, env, home)) {
      return true;
    }
    const trusted = repoRoot
      ? isTrusted(trust(), trustKey)
      : isTrustedOrUnderTrusted(trust(), trustKey);
    return trusted && isOwnLocalFile(trustKey, git);
  };
  const files = [
    { path: join(userDir, "settings.json"), grants: true },
    {
      path: projectPath,
      grants: existsSync(projectPath) && isTrusted(trust(), trustKey),
    },
    { path: localPath, grants: existsSync(localPath) && localGrants() },
  ];
  const seen = new Set();
  return files.filter(({ path }) => !seen.has(path) && seen.add(path));
}

/**
 * Bash rules only (Read/WebFetch/etc. are irrelevant to a Bash command). returns {allow, deny, ask}
 * as arrays of the string INSIDE Bash(...). a missing, corrupt or malformed file contributes no
 * rules and never throws: a type-invalid `allow` (e.g. a number) once threw out of the loader and
 * fail-opened the whole hook, discarding valid deny rules from the other files (B2).
 */
export function loadRules(files) {
  const rules = { allow: [], deny: [], ask: [] };
  for (const { path, grants } of files) {
    const permissions = readJson(path)?.permissions;
    for (const kind of RULE_KINDS) {
      const list = permissions?.[kind];
      if (!Array.isArray(list) || (kind === "allow" && !grants)) {
        continue;
      }
      for (const rule of list) {
        const body = bashRuleBody(rule);
        if (body !== null) {
          rules[kind].push(body);
        }
      }
    }
  }
  return rules;
}

const SNIP_HOOK_COMMAND = /(^|[/\s"'])snip(\.exe)?["']?\s+hook\b/;

/**
 * the `snip hook` handler registered under `PreToolUse` in the settings files, as
 * `{command, args}` (shell form when `args` is absent), or null when none is registered
 */
export function snipHookHandler(files) {
  for (const { path } of files) {
    const hooks = readJson(path)?.hooks?.PreToolUse;
    for (const entry of Array.isArray(hooks) ? hooks : []) {
      for (const handler of Array.isArray(entry?.hooks) ? entry.hooks : []) {
        const line = [handler?.command, ...(handler?.args ?? [])].join(" ");
        if (
          typeof handler?.command === "string" &&
          SNIP_HOOK_COMMAND.test(line)
        ) {
          return { command: handler.command, args: handler.args };
        }
      }
    }
  }
  return null;
}

/**
 * translate a Claude Code Bash-rule body into a RegExp, per the permissions docs:
 *   trailing " *" or ":*"  -> space-then-anything, a word boundary (`ls *` matches `ls -la`, not
 *                             `lsof`). it also matches the bare command (`ls`), but only when that
 *                             trailing `*` is the rule's only wildcard: `Bash(* --help *)` matches
 *                             `npm --help x`, not `npm --help`
 *   `*` elsewhere          -> ".*" (any run incl. spaces, and the newlines of a multi-line quoted
 *                             argument: the `s` flag)
 *   no wildcard            -> exact match
 * a conservative slice of Claude Code's matcher. every metacharacter is escaped, so the RegExp
 * constructor cannot throw.
 */
function ruleToRegex(body) {
  const trailingWord = body.endsWith(":*") || body.endsWith(" *");
  const head = trailingWord ? body.slice(0, -2) : body;
  const pattern = head
    .split("*")
    .map((part) => part.replace(REGEX_SPECIALS, "\\$&"))
    .join(".*");
  if (!trailingWord) {
    return new RegExp(`^${pattern}$`, "s");
  }
  const tail = head.includes("*") ? "\\s.*" : "(\\s.*)?";
  return new RegExp(`^${pattern}${tail}$`, "s");
}

export function compileRules(bodies) {
  return bodies.map((body) => ({ body, regex: ruleToRegex(body) }));
}

// the first rule body matching `text`, or null
export function firstMatch(text, compiledRules) {
  return compiledRules.find(({ regex }) => regex.test(text))?.body ?? null;
}
