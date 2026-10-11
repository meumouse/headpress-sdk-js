#!/usr/bin/env node
// Stages the package on npm (`npm stage publish`) when its version is not on the registry yet.
// The trusted publisher only allows staging: a maintainer approves the staged version with 2FA on
// npmjs.com (or `npm stage approve <id>`) before it goes public. Run by release.yml through
// changesets/action, which calls the publish command on every push to main.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageUrl = new URL("../packages/headpress/", import.meta.url);
const dir = fileURLToPath(packageUrl);
const { name, version } = JSON.parse(readFileSync(new URL("package.json", packageUrl), "utf8"));

const npm = (args, options = {}) =>
  execFileSync("npm", args, { cwd: dir, encoding: "utf8", shell: process.platform === "win32", ...options });

let published = "";
try {
  published = npm(["view", `${name}@${version}`, "version"], { stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  // E404: the version does not exist yet.
}

if (published === version) {
  console.log(`${name}@${version} is already on npm; nothing to stage.`);
  process.exit(0);
}

// Pre-releases need an explicit dist-tag; the tag cannot change after staging.
const prerelease = version.match(/-([a-z]+)/i)?.[1];
const args = ["stage", "publish", "--access", "public", "--provenance"];
if (prerelease) args.push("--tag", prerelease);

npm(args, { stdio: "inherit" });
console.log(`Staged ${name}@${version}. Approve it on https://www.npmjs.com/package/${name} to publish it.`);
