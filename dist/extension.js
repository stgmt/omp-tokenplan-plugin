// @bun
// src/model.ts
var BASE_URL = "https://tokenplan.aipomogator.ru/v1";
var BASE_URL_ENV_VAR = "TOKENPLAN_BASE_URL";
var PROVIDER = "tokenplan";
var ENV_VAR = "TOKENPLAN_API_KEY";
var FALLBACK_CONTEXT_WINDOW = 1048576;
var FALLBACK_MAX_TOKENS = 384000;
var THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
var DEFAULT_THINKING_LEVEL = "max";
function resolveBaseUrl() {
  return process.env[BASE_URL_ENV_VAR]?.trim().replace(/\/+$/, "") || BASE_URL;
}
var FAIL_CLOSED_ERROR = "tokenplan model fetch failed; refusing to advertise unverified models";
function toProviderModel(dto) {
  const id = String(dto.id ?? "").trim();
  if (!id)
    throw new Error("tokenplan model entry without id");
  const input = Array.isArray(dto.input_modalities) && dto.input_modalities.length > 0 ? dto.input_modalities.map(String) : ["text"];
  const reasoning = dto.supports_reasoning ?? true;
  return {
    id,
    name: dto.display_name?.trim() || id,
    reasoning,
    ...reasoning ? { thinking: { efforts: [...THINKING_EFFORTS], defaultLevel: DEFAULT_THINKING_LEVEL } } : {},
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: dto.context_length ?? FALLBACK_CONTEXT_WINDOW,
    maxTokens: dto.max_completion_tokens ?? FALLBACK_MAX_TOKENS,
    compat: { supportsReasoningEffort: true, supportsStore: false }
  };
}
async function fetchModels(apiKey, baseUrl = resolveBaseUrl()) {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error(FAIL_CLOSED_ERROR);
  }
  if (!res.ok)
    throw new Error(FAIL_CLOSED_ERROR);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(FAIL_CLOSED_ERROR);
  }
  const data = body.data;
  if (!Array.isArray(data) || data.length === 0)
    throw new Error(FAIL_CLOSED_ERROR);
  return data.map((dto) => toProviderModel(dto));
}

// src/settings.ts
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var PLUGIN_NAME = "omp-tokenplan-plugin";
var SETTING_ID = "apiKey";
var LOCK_NAME = "omp-plugins.lock.json";
var OVERRIDES_NAME = "plugin-overrides.json";
var PROJECT_BASES = [".omp", ".claude", ".codex", ".gemini"];
function readJson(file) {
  try {
    if (!existsSync(file))
      return;
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return;
  }
}
function apiKeyFrom(doc) {
  if (!doc || typeof doc !== "object")
    return;
  const settings = doc.settings;
  if (!settings || typeof settings !== "object")
    return;
  const entry = settings[PLUGIN_NAME];
  if (!entry || typeof entry !== "object")
    return;
  const value = entry[SETTING_ID];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function globalLockCandidates() {
  const profile = (process.env.OMP_PROFILE ?? process.env.PI_PROFILE)?.trim() || undefined;
  const configDir = process.env.PI_CONFIG_DIR?.trim() || ".omp";
  const profileParts = profile ? ["profiles", profile] : [];
  const candidates = [];
  if (process.platform === "linux" || process.platform === "darwin") {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg)
      candidates.push(join(xdg, "omp", ...profileParts, "plugins", LOCK_NAME));
  }
  candidates.push(join(homedir(), configDir, ...profileParts, "plugins", LOCK_NAME));
  return candidates;
}
function resolveApiKey(cwd = process.cwd()) {
  for (const base of PROJECT_BASES) {
    const key = apiKeyFrom(readJson(join(cwd, base, OVERRIDES_NAME)));
    if (key)
      return key;
  }
  for (const lock of globalLockCandidates()) {
    const key = apiKeyFrom(readJson(lock));
    if (key)
      return key;
  }
  return process.env[ENV_VAR]?.trim() || undefined;
}

// src/extension.ts
async function tokenplanExtension(pi) {
  pi.setLabel("Tokenplan Gateway");
  const apiKey = resolveApiKey();
  const baseUrl = resolveBaseUrl();
  pi.registerProvider(PROVIDER, {
    baseUrl,
    api: "openai-responses",
    authHeader: true,
    ...apiKey ? { apiKey } : {},
    models: [],
    async fetchDynamicModels(key) {
      if (!key)
        return [];
      return fetchModels(key, baseUrl);
    },
    oauth: {
      name: "Tokenplan",
      async login(callbacks) {
        return callbacks.onPrompt({
          message: "Tokenplan API key",
          placeholder: "sk-..."
        });
      },
      getApiKey: (credentials) => credentials
    }
  });
}
export {
  tokenplanExtension as default
};
