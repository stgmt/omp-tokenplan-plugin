/**
 * Resolves the tokenplan API key the same way OMP plugin settings resolve
 * (highest-priority last wins): env var, then the global plugin lock
 * (~/.omp/plugins/omp-plugins.lock.json), then project overrides
 * (.omp/plugin-overrides.json). Reads only; never writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_VAR } from "./model.js";

export const PLUGIN_NAME = "omp-tokenplan-plugin";
export const SETTING_ID = "apiKey";

function readJson(file: string): unknown {
	try {
		if (!existsSync(file)) return undefined;
		return JSON.parse(readFileSync(file, "utf-8"));
	} catch {
		return undefined;
	}
}

function apiKeyFrom(doc: unknown): string | undefined {
	if (!doc || typeof doc !== "object") return undefined;
	const settings = (doc as { settings?: unknown }).settings;
	if (!settings || typeof settings !== "object") return undefined;
	const entry = (settings as Record<string, unknown>)[PLUGIN_NAME];
	if (!entry || typeof entry !== "object") return undefined;
	const value = (entry as Record<string, unknown>)[SETTING_ID];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Resolution order: `TOKENPLAN_API_KEY` env → project override → global lock.
 * The env var wins so CI and ad-hoc sessions never touch stored secrets.
 * Project override outranks the global lock, matching core merge semantics.
 */
export function resolveApiKey(cwd: string = process.cwd()): string | undefined {
	const env = process.env[ENV_VAR]?.trim();
	if (env) return env;

	const project = apiKeyFrom(readJson(join(cwd, ".omp", "plugin-overrides.json")));
	if (project) return project;

	const global = apiKeyFrom(
		readJson(join(homedir(), ".omp", "plugins", "omp-plugins.lock.json")),
	);
	if (global) return global;

	return undefined;
}
