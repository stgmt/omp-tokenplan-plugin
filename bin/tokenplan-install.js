#!/usr/bin/env node

/**
 * tokenplan-install — one-shot setup for the omp-tokenplan-plugin.
 *
 *   tokenplan-install --token <api-key>
 *
 * What it does, in order:
 *   1. `omp plugin install github:stgmt/omp-tokenplan-plugin` (idempotent —
 *      skips this step when the plugin is already installed).
 *   2. Validates the token against GET https://tokenplan.aipomogator.ru/v1/models
 *      BEFORE persisting anything: a bad key is rejected, never stored.
 *   3. Persists the key as the plugin's `apiKey` setting via
 *      `omp plugin config set omp-tokenplan-plugin apiKey <token>`.
 *
 * Designed to be run via `bunx github:stgmt/omp-tokenplan-plugin --token <key>`
 * (no prior install needed) or `npx -y stgmt/omp-tokenplan-plugin --token <key>`.
 * Requires `omp` on PATH and either node or bun as the script runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PLUGIN_SPEC = "github:stgmt/omp-tokenplan-plugin";
const PLUGIN_NAME = "omp-tokenplan-plugin";
const BASE_URL = "https://tokenplan.aipomogator.ru/v1";

function fail(message, code = 1) {
	console.error(`tokenplan-install: ${message}`);
	process.exit(code);
}

function usage() {
	console.log("Usage: tokenplan-install --token <api-key>");
	console.log("       bunx github:stgmt/omp-tokenplan-plugin --token <api-key>");
}

function parseToken(argv) {
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--token" || arg === "-t" || arg === "--api-key") {
			const value = argv[i + 1];
			if (!value || value.startsWith("-")) fail(`missing value after ${arg}`);
			return value.trim();
		}
		if (arg.startsWith("--token=")) return arg.slice("--token=".length).trim();
	}
	return undefined;
}

function run(cmd, args) {
	const res = spawnSync(cmd, args, {
		stdio: "inherit",
		shell: process.platform === "win32",
		env: process.env,
	});
	if (res.error) {
		if (res.error.code === "ENOENT") return null;
		fail(`failed to spawn ${cmd}: ${res.error.message}`);
	}
	return res;
}

function omp(args, whatFailed) {
	const res = run("omp", args);
	if (!res) fail("`omp` is not on PATH — install Oh My Pi first");
	if (res.status !== 0) fail(`${whatFailed} (omp exited ${res.status})`);
}

function pluginInstalled() {
	const lock = join(homedir(), ".omp", "plugins", "omp-plugins.lock.json");
	try {
		if (!existsSync(lock)) return false;
		const doc = JSON.parse(readFileSync(lock, "utf-8"));
		return Boolean(doc?.plugins?.[PLUGIN_NAME]);
	} catch {
		return false;
	}
}

async function validateToken(token) {
	let res;
	try {
		res = await fetch(`${BASE_URL}/models`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			signal: AbortSignal.timeout(15_000),
		});
	} catch (err) {
		fail(`cannot reach ${BASE_URL} — check network/proxy (${err.message})`);
	}
	if (res.status === 401 || res.status === 403) {
		fail("token rejected by the gateway (401/403) — verify the key and try again");
	}
	if (!res.ok) fail(`gateway returned HTTP ${res.status} for /v1/models`);

	let body;
	try {
		body = await res.json();
	} catch {
		fail("gateway returned a non-JSON response for /v1/models");
	}
	const data = body?.data;
	if (!Array.isArray(data) || data.length === 0) {
		fail("gateway returned an empty model list — refusing to save an unverifiable key");
	}
	return data;
}

const token = parseToken(process.argv.slice(2));
if (!token) {
	usage();
	if (process.argv.some((a) => a === "--help" || a === "-h")) process.exit(0);
	fail("no --token given");
}

// 1. Install the plugin (skip if already registered — the spec's single
//    command is idempotent so a re-run only refreshes the key).
if (pluginInstalled()) {
	console.log(`tokenplan-install: ${PLUGIN_NAME} already installed, skipping install step`);
} else {
	console.log(`tokenplan-install: installing ${PLUGIN_SPEC} …`);
	omp(["plugin", "install", PLUGIN_SPEC], "plugin install failed");
}

// 2. Validate the key against the live gateway before persisting it.
console.log("tokenplan-install: validating token against /v1/models …");
const models = await validateToken(token);
console.log(`tokenplan-install: gateway OK, ${models.length} model(s) in catalog`);

// 3. Persist the key as the plugin's apiKey setting (global user scope).
omp(
	["plugin", "config", "set", PLUGIN_NAME, "apiKey", token],
	"failed to store the API key in plugin settings",
);

console.log("");
console.log("tokenplan-install: done. In an OMP session run:");
console.log("  /tokenplan            — switch to the default tokenplan model");
console.log("  /tokenplan <model-id> — switch to a specific tokenplan model");
