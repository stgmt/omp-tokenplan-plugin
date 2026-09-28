/**
 * omp-tokenplan-plugin extension entry.
 * Registers the `tokenplan` provider (openai-responses, Bearer auth) against
 * the gateway in TOKENPLAN_BASE_URL, production
 * https://tokenplan.aipomogator.ru/v1 when it is unset. The model is picked in
 * OMP's built-in /model picker; the plugin registers no slash command.
 * Reasoning defaults to "max"; /model offers the other levels.
 * API key resolution is project override → global lock file → env; a missing
 * key means zero provider traffic and no tokenplan model in /model.
 */

import { fetchModels, PROVIDER, resolveBaseUrl, type ProviderModelShape } from "./model.ts";
import { resolveApiKey } from "./settings.ts";

// ---------------------------------------------------------------------------
// Minimal structural types for the pieces of ExtensionAPI this extension
// touches — keeps the bundle free of dev-time type packages.
// ---------------------------------------------------------------------------

interface ProviderRegistration {
	baseUrl: string;
	apiKey?: string;
	api: string;
	authHeader: boolean;
	models: ProviderModelShape[];
	fetchDynamicModels(apiKey?: string): Promise<ProviderModelShape[]>;
	oauth?: {
		name: string;
		login(callbacks: {
			onPrompt(prompt: { message: string; placeholder?: string }): Promise<string>;
		}): Promise<string>;
		getApiKey(credentials: string): string;
	};
}

interface PiLike {
	setLabel(entryIdOrLabel: string, label?: string): void;
	registerProvider(name: string, config: ProviderRegistration): void;
}

// ---------------------------------------------------------------------------

export default async function tokenplanExtension(pi: PiLike): Promise<void> {
	pi.setLabel("Tokenplan Gateway");

	const apiKey = resolveApiKey();
	// One address for the requests and the model list.
	const baseUrl = resolveBaseUrl();

	pi.registerProvider(PROVIDER, {
		baseUrl,
		api: "openai-responses",
		authHeader: true,
		...(apiKey ? { apiKey } : {}),
		// fail-closed: without a key there is nothing to advertise, and
		// fetchDynamicModels throws rather than synthesizing fake models.
		models: [],
		async fetchDynamicModels(key?: string): Promise<ProviderModelShape[]> {
			if (!key) return [];
			return fetchModels(key, baseUrl);
		},
		oauth: {
			name: "Tokenplan",
			async login(callbacks) {
				return callbacks.onPrompt({
					message: "Tokenplan API key",
					placeholder: "sk-...",
				});
			},
			getApiKey: (credentials) => credentials,
		},
	});
}
