#!/usr/bin/env node
/**
 * Pull the Headpress contract into contract/.
 *
 *   node scripts/contract-pull.mjs --url http://headpress.local [--plugin <path to the headpress plugin>]
 *   node scripts/contract-pull.mjs --from <dir> --plugin <path to the headpress plugin>
 *
 * `--from` reads the output of `wp headpress contract export --dir=<dir>` (Headpress 1.3+), which
 * also has `routes.json` (every storefront route with its scope, module, args and schema). Use it to
 * pull the contract of a branch the site does not serve over HTTP.
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
    from: { type: "string" },
    plugin: { type: "string" },
    insecure: { type: "boolean", default: false },
  },
});

if (!values.url && !values.from) {
  console.error("Usage: node scripts/contract-pull.mjs (--url <site url> | --from <export dir>) [--plugin <plugin dir>] [--insecure]");
  process.exit(1);
}

// Local by Flywheel and similar tools use self-signed certificates.
if (values.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let base;
let schema;
if (values.from) {
  const dir = resolve(values.from);
  base = "wp headpress contract export";
  schema = JSON.parse(readFileSync(join(dir, "store-config.schema.json"), "utf8"));
  const routes = join(dir, "routes.json");
  if (existsSync(routes)) {
    writeFileSync(join(contractDir, "routes.json"), `${JSON.stringify(JSON.parse(readFileSync(routes, "utf8")), null, 2)}\n`);
  }
} else {
  base = values.url.replace(/\/$/, "");
  const response = await fetch(`${base}/wp-json/headpress/v1/store/config/schema`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    console.error(`Schema request failed: HTTP ${response.status}`);
    process.exit(1);
  }
  schema = await response.json();
}
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
