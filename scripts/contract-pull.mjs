#!/usr/bin/env node
/**
 * Pull the Headpress contract into contract/.
 *
 *   node scripts/contract-pull.mjs --url http://headpress.local [--plugin <path to the headpress plugin>]
 *
 * - store-config.schema.json  ← GET {url}/wp-json/headpress/v1/store/config/schema
 * - commerce.schema.json      ← {plugin}/tests/contracts/commerce.schema.json (the live schema
 *                               only says `commerce: object`)
 * - meta.json                 ← where and when it came from, and the plugin version and commit
 *
 * Run `pnpm codegen` afterwards. The site must have every core module registered (they are listed
 * in the schema whether enabled or not).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractDir = join(root, "contract");

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    plugin: { type: "string" },
    insecure: { type: "boolean", default: false },
  },
});

if (!values.url) {
  console.error("Usage: node scripts/contract-pull.mjs --url <site url> [--plugin <plugin dir>] [--insecure]");
  process.exit(1);
}

// Local by Flywheel and similar tools use self-signed certificates.
if (values.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const base = values.url.replace(/\/$/, "");
const response = await fetch(`${base}/wp-json/headpress/v1/store/config/schema`, {
  headers: { Accept: "application/json" },
});
if (!response.ok) {
  console.error(`Schema request failed: HTTP ${response.status}`);
  process.exit(1);
}
const schema = await response.json();
// The $id carries the site URL; drop it so pulls from different sites diff cleanly.
delete schema.$id;
writeFileSync(join(contractDir, "store-config.schema.json"), `${JSON.stringify(schema, null, 2)}\n`);

const meta = {
  source: base,
  pulled_at: new Date().toISOString(),
  headpress_version: null,
  headpress_commit: null,
  headpress_dirty: null,
};

if (values.plugin) {
  const plugin = resolve(values.plugin);
  const commerce = join(plugin, "tests", "contracts", "commerce.schema.json");
  if (existsSync(commerce)) {
    writeFileSync(join(contractDir, "commerce.schema.json"), readFileSync(commerce, "utf8"));
  } else {
    console.warn(`Not found: ${commerce} (commerce.schema.json left as is)`);
  }

  const header = readFileSync(join(plugin, "headpress.php"), "utf8");
  meta.headpress_version = /^\s*\*\s*Version:\s*(\S+)/m.exec(header)?.[1] ?? null;
  try {
    const git = (...args) => execFileSync("git", ["-C", plugin, ...args], { encoding: "utf8" }).trim();
    meta.headpress_commit = git("rev-parse", "--short", "HEAD");
    meta.headpress_dirty = git("status", "--porcelain").length > 0;
  } catch {
    // Not a git checkout: version only.
  }
}

writeFileSync(join(contractDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`Contract pulled from ${base}${meta.headpress_version ? ` (Headpress ${meta.headpress_version})` : ""}.`);
