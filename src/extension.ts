/**
 * omp-tokenplan-plugin extension entry.
 * Registers the `tokenplan` provider (openai-responses against
 * https://tokenplan.aipomogator.ru/v1, Bearer auth) and the /tokenplan
 * slash command. API key resolution is env → project override → global
 * lock file; a missing key means zero provider traffic, reported via
 * notify when the user tries to select a model.
 */

import {
	BASE_URL,
	ENV_VAR,
	FAIL_CLOSED_ERROR,
	fetchModels,
	PROVIDER,
	type ProviderModelShape,
} from "./model.ts";
import { PLUGIN_NAME, resolveApiKey, SETTING_ID } from "./settings.ts";

// ---------------------------------------------------------------------------
// Minimal structural types for the pieces of ExtensionAPI this extension
// touches — keeps the bundle free of dev-time type packages.
// ---------------------------------------------------------------------------

interface ModelLike {
	id: string;
	provider: string;
	[key: string]: unknown;
}

interface ModelQueryLike {
	list(): ModelLike[];
	resolve(spec: string): ModelLike | undefined;
}

interface UiLike {
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface CommandContextLike {
	ui: UiLike;
	models: ModelQueryLike;
	cwd: string;
}

interface CommandOptions {
	description?: string;
	handler: (args: string, ctx: CommandContextLike) => Promise<void>;
}

interface ProviderRegistration {
	baseUrl: string;
	apiKey?: string;
	api: string;
	authHeader: boolean;
	models: ProviderModelShape[];
	fetchDynamicModels(apiKey?: string): Promise<ProviderModelShape[]>;
	oauth?: {
		login(callbacks: {
			onPrompt(prompt: { message: string; placeholder?: string }): Promise<string>;
		}): Promise<string>;
		getApiKey(credentials: string): string;
	};
}

interface PiLike {
	setLabel(entryIdOrLabel: string, label?: string): void;
	setModel(model: ModelLike): Promise<boolean>;
	registerProvider(name: string, config: ProviderRegistration): void;
	registerCommand(name: string, options: CommandOptions): void;
}

// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ENV = "TOKENPLAN_MODEL";
const INSTALL_HINT = `run "bunx github:stgmt/${PLUGIN_NAME} --token <key>" or set ${ENV_VAR}`;

function pickDefaultModel(authenticated: ModelLike[]): ModelLike | undefined {
	const fromProvider = authenticated.filter((m) => m.provider === PROVIDER);
	if (fromProvider.length === 0) return undefined;
	const preferred = process.env[DEFAULT_MODEL_ENV]?.trim();
	if (preferred) {
		const hit = fromProvider.find(
			(m) => m.id === preferred || `${PROVIDER}/${m.id}` === preferred,
		);
		if (hit) return hit;
	}
	return fromProvider[0];
}

export default async function tokenplanExtension(pi: PiLike): Promise<void> {
	pi.setLabel("Tokenplan Gateway");

	const apiKey = resolveApiKey();

	pi.registerProvider(PROVIDER, {
		baseUrl: BASE_URL,
		api: "openai-responses",
		authHeader: true,
		...(apiKey ? { apiKey } : {}),
		// fail-closed: without a key there is nothing to advertise, and
		// fetchDynamicModels throws rather than synthesizing fake models.
		models: [],
		async fetchDynamicModels(key?: string): Promise<ProviderModelShape[]> {
			if (!key) return [];
			return fetchModels(key);
		},
		oauth: {
			async login(callbacks) {
				return callbacks.onPrompt({
					message: "Tokenplan API key",
					placeholder: "sk-...",
				});
			},
			getApiKey: (credentials) => credentials,
		},
	});

	pi.registerCommand("tokenplan", {
		description: "Switch to the default tokenplan gateway model (or a named one)",
		async handler(args, ctx) {
			const key = resolveApiKey(ctx.cwd ?? process.cwd());
			if (!key) {
				ctx.ui.notify(
					`No tokenplan API key configured — ${INSTALL_HINT} (or: omp plugin config set ${PLUGIN_NAME} ${SETTING_ID} <key>)`,
					"error",
				);
				return;
			}

			const spec = args.trim();
			const model = spec
				? ctx.models.resolve(spec.includes("/") ? spec : `${PROVIDER}/${spec}`)
				: pickDefaultModel(ctx.models.list());

			if (!model) {
				ctx.ui.notify(
					spec
						? `Model "${spec}" is not available on ${PROVIDER} — check \`omp models\` for the live catalog`
						: `No authenticated ${PROVIDER} model — ${INSTALL_HINT}`,
					"error",
				);
				return;
			}

			const ok = await pi.setModel(model);
			if (ok) {
				ctx.ui.notify(`Switched to ${PROVIDER}/${model.id}`, "info");
			} else {
				ctx.ui.notify(
					`Failed to switch to ${PROVIDER}/${model.id} — missing or invalid API key`,
					"error",
				);
			}
		},
	});
}
