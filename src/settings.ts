/**
 * Resolves the tokenplan API key the same way OMP plugin settings resolve:
 * project overrides (first readable of .omp/.claude/.codex/.gemini
 * plugin-overrides.json) beat the global plugin lock, and the env var is the
 * documented fallback when nothing is stored — matching PluginSettingBase.env
 * semantics. Reads only; never writes.
 *
 * The global lock path follows core's rules (pi-utils dirs.ts): the config
 * dir is PI_CONFIG_DIR or ".omp", named profiles (OMP_PROFILE/PI_PROFILE) get
 * ~/.omp/profiles/<name>/, and on Linux/macOS a migrated install lives under
 * $XDG_DATA_HOME/omp — the XDG path wins when it exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_VAR } from "./model.ts";

export const PLUGIN_NAME = "omp-tokenplan-plugin";
export const SETTING_ID = "apiKey";

const LOCK_NAME = "omp-plugins.lock.json";
const OVERRIDES_NAME = "plugin-overrides.json";
/** Same order as core's PROJECT_CONFIG_BASES priority list. */
const PROJECT_BASES = [".omp", ".claude", ".codex", ".gemini"];

function readJson(file: string): unknown {
	try {
		if (!existsSync(file)) return undefined;
		return JSON.parse(readFileSync(file, "utf-8"));
	} catch {
		return undefined;
	}
}

/** Extract settings.<pkg>.apiKey from a lock/overrides document. */
export function apiKeyFrom(doc: unknown): string | undefined {
	if (!doc || typeof doc !== "object") return undefined;
	const settings = (doc as { settings?: unknown }).settings;
	if (!settings || typeof settings !== "object") return undefined;
	const entry = (settings as Record<string, unknown>)[PLUGIN_NAME];
	if (!entry || typeof entry !== "object") return undefined;
	const value = (entry as Record<string, unknown>)[SETTING_ID];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Candidate global lock paths in core's precedence order. Exported because
 * the installer bin (a standalone script) needs the same candidates for its
 * "already installed" check — keep the shapes in sync.
 */
export function globalLockCandidates(): string[] {
	const profile = (process.env.OMP_PROFILE ?? process.env.PI_PROFILE)?.trim() || undefined;
	const configDir = process.env.PI_CONFIG_DIR?.trim() || ".omp";
	const profileParts = profile ? ["profiles", profile] : [];
	const candidates: string[] = [];
	if (process.platform === "linux" || process.platform === "darwin") {
		const xdg = process.env.XDG_DATA_HOME;
		if (xdg) candidates.push(join(xdg, "omp", ...profileParts, "plugins", LOCK_NAME));
	}
	candidates.push(join(homedir(), configDir, ...profileParts, "plugins", LOCK_NAME));
	return candidates;
}

/**
 * Stored settings first — project override, then global lock — and the env
 * var last as the declared fallback, so a stale TOKENPLAN_API_KEY cannot
 * shadow a key the user just wrote with `omp plugin config set`.
 */
export function resolveApiKey(cwd: string = process.cwd()): string | undefined {
	for (const base of PROJECT_BASES) {
		const key = apiKeyFrom(readJson(join(cwd, base, OVERRIDES_NAME)));
		if (key) return key;
	}
	for (const lock of globalLockCandidates()) {
		const key = apiKeyFrom(readJson(lock));
		if (key) return key;
	}
	return process.env[ENV_VAR]?.trim() || undefined;
}
