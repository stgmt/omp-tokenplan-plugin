// @bun
// src/model.ts
var BASE_URL = "https://tokenplan.aipomogator.ru/v1";
var PROVIDER = "tokenplan";
var ENV_VAR = "TOKENPLAN_API_KEY";
var FALLBACK_CONTEXT_WINDOW = 1048576;
var FALLBACK_MAX_TOKENS = 384000;
var FAIL_CLOSED_ERROR = "tokenplan model fetch failed; refusing to advertise unverified models";
function toProviderModel(dto) {
  const id = String(dto.id ?? "").trim();
  if (!id)
    throw new Error("tokenplan model entry without id");
  const input = Array.isArray(dto.input_modalities) && dto.input_modalities.length > 0 ? dto.input_modalities.map(String) : ["text"];
  return {
    id,
    name: dto.display_name?.trim() || id,
    reasoning: dto.supports_reasoning ?? true,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: dto.context_length ?? FALLBACK_CONTEXT_WINDOW,
    maxTokens: dto.max_completion_tokens ?? FALLBACK_MAX_TOKENS,
    compat: { supportsReasoningEffort: true, supportsStore: false }
  };
}
async function fetchModels(apiKey, baseUrl = BASE_URL) {
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
function resolveApiKey(cwd = process.cwd()) {
  const env = process.env[ENV_VAR]?.trim();
  if (env)
    return env;
  const project = apiKeyFrom(readJson(join(cwd, ".omp", "plugin-overrides.json")));
  if (project)
    return project;
  const global = apiKeyFrom(readJson(join(homedir(), ".omp", "plugins", "omp-plugins.lock.json")));
  if (global)
    return global;
  return;
}

// src/extension.ts
var DEFAULT_MODEL_ENV = "TOKENPLAN_MODEL";
var INSTALL_HINT = `run "bunx github:stgmt/${PLUGIN_NAME} --token <key>" or set ${ENV_VAR}`;
function pickDefaultModel(authenticated) {
  const fromProvider = authenticated.filter((m) => m.provider === PROVIDER);
  if (fromProvider.length === 0)
    return;
  const preferred = process.env[DEFAULT_MODEL_ENV]?.trim();
  if (preferred) {
    const hit = fromProvider.find((m) => m.id === preferred || `${PROVIDER}/${m.id}` === preferred);
    if (hit)
      return hit;
  }
  return fromProvider[0];
}
async function tokenplanExtension(pi) {
  pi.setLabel("Tokenplan Gateway");
  const apiKey = resolveApiKey();
  pi.registerProvider(PROVIDER, {
    baseUrl: BASE_URL,
    api: "openai-responses",
    authHeader: true,
    ...apiKey ? { apiKey } : {},
    models: [],
    async fetchDynamicModels(key) {
      if (!key)
        return [];
      return fetchModels(key);
    },
    oauth: {
      async login(callbacks) {
        return callbacks.onPrompt({
          message: "Tokenplan API key",
          placeholder: "sk-..."
        });
      },
      getApiKey: (credentials) => credentials
    }
  });
  pi.registerCommand("tokenplan", {
    description: "Switch to the default tokenplan gateway model (or a named one)",
    async handler(args, ctx) {
      const key = resolveApiKey(ctx.cwd ?? process.cwd());
      if (!key) {
        ctx.ui.notify(`No tokenplan API key configured \u2014 ${INSTALL_HINT} (or: omp plugin config set ${PLUGIN_NAME} ${SETTING_ID} <key>)`, "error");
        return;
      }
      const spec = args.trim();
      const model = spec ? ctx.models.resolve(spec.includes("/") ? spec : `${PROVIDER}/${spec}`) : pickDefaultModel(ctx.models.list());
      if (!model) {
        ctx.ui.notify(spec ? `Model "${spec}" is not available on ${PROVIDER} \u2014 check \`omp models\` for the live catalog` : `No authenticated ${PROVIDER} model \u2014 ${INSTALL_HINT}`, "error");
        return;
      }
      const ok = await pi.setModel(model);
      if (ok) {
        ctx.ui.notify(`Switched to ${PROVIDER}/${model.id}`, "info");
      } else {
        ctx.ui.notify(`Failed to switch to ${PROVIDER}/${model.id} \u2014 missing or invalid API key`, "error");
      }
    }
  });
}
export {
  tokenplanExtension as default
};
