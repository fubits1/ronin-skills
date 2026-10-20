#!/usr/bin/env node
/**
 * the bundles rolldown.config.js builds are committed and shipped as they are, so after a build
 * each one must be tracked and unchanged. a modified bundle is stale; an untracked one was never
 * committed. lists the offenders and exits 1. run it after `pnpm build` (`pnpm check:bundles`)
 */
import { execFileSync } from "node:child_process";
import config from "../rolldown.config.js";

const outputs = config.map(({ output }) => output.file);
const status = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all", "--", ...outputs],
  { encoding: "utf8" },
);
if (status.trim() !== "") {
  console.error(
    "bundles differ from their sources or are not committed:\n" + status,
  );
  process.exit(1);
}
