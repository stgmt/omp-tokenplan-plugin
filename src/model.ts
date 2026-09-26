/**
 * tokenplan gateway provider: /v1/models DTO → ProviderModelConfig mapping,
 * per the omp-tokenplan-plugin specification. Pure functions, no OMP imports,
 * so they stay unit-testable in isolation.
 */

export const BASE_URL = "https://tokenplan.aipomogator.ru/v1";
export const PROVIDER = "tokenplan";
export const ENV_VAR = "TOKENPLAN_API_KEY";

const FALLBACK_CONTEXT_WINDOW = 1_048_576;
const FALLBACK_MAX_TOKENS = 384_000;

/** Wire shape of one entry in GET /v1/models `data`. */
export interface TokenplanModelDto {
	id?: string;
	display_name?: string;
	context_length?: number;
	max_completion_tokens?: number;
	supports_reasoning?: boolean;
	input_modalities?: string[];
	/** Ignored: capability flags come from compat defaults, not this list. */
	supported_parameters?: string[];
	[key: string]: unknown;
}

/** Minimal model config as consumed by registerProvider(). */
export interface ProviderModelShape {
	id: string;
	name: string;
	reasoning: boolean;
	input: string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	compat: { supportsReasoningEffort?: boolean; supportsStore?: boolean };
}

export const FAIL_CLOSED_ERROR = "tokenplan model fetch failed; refusing to advertise unverified models";

/**
 * Map one gateway model DTO to a provider model entry.
 * `id` stays bare — OMP renders it as `tokenplan/<id>` from the provider name.
 */
export function toProviderModel(dto: TokenplanModelDto): ProviderModelShape {
	const id = String(dto.id ?? "").trim();
	if (!id) throw new Error("tokenplan model entry without id");
	const input = Array.isArray(dto.input_modalities) && dto.input_modalities.length > 0
		? dto.input_modalities.map(String)
		: ["text"];
	return {
		id,
		name: dto.display_name?.trim() || id,
		reasoning: dto.supports_reasoning ?? true,
		input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: dto.context_length ?? FALLBACK_CONTEXT_WINDOW,
		maxTokens: dto.max_completion_tokens ?? FALLBACK_MAX_TOKENS,
		compat: { supportsReasoningEffort: true, supportsStore: false },
	};
}

/**
 * GET {baseUrl}/models and map the catalog. Fail-closed: any transport,
 * status, or payload problem throws FAIL_CLOSED_ERROR rather than returning
 * stale or partial data.
 */
export async function fetchModels(apiKey: string, baseUrl: string = BASE_URL): Promise<ProviderModelShape[]> {
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	let res: Response;
	try {
		res = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new Error(FAIL_CLOSED_ERROR);
	}
	if (!res.ok) throw new Error(FAIL_CLOSED_ERROR);
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new Error(FAIL_CLOSED_ERROR);
	}
	const data = (body as { data?: unknown }).data;
	if (!Array.isArray(data) || data.length === 0) throw new Error(FAIL_CLOSED_ERROR);
	return data.map((dto) => toProviderModel(dto as TokenplanModelDto));
}
