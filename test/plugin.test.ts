/**
 * Owner decisions of 2026-09-28: the gateway address comes from
 * TOKENPLAN_BASE_URL (production when unset) and reasoning defaults to
 * "max". fetch reaches only 127.0.0.1 here, so no test can hit production.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tokenplanExtension from "../src/extension.ts";
import { toProviderModel } from "../src/model.ts";

const PROD = "https://tokenplan.aipomogator.ru/v1";
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const ENV_NAMES = ["TOKENPLAN_BASE_URL", "TOKENPLAN_API_KEY", "HOME", "USERPROFILE", "PI_CONFIG_DIR", "OMP_PROFILE", "PI_PROFILE", "XDG_DATA_HOME"];

const realFetch = globalThis.fetch;
let savedEnv: Record<string, string | undefined>;
let home: string;
let blocked: string[];

beforeEach(() => {
	savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
	for (const name of ENV_NAMES) delete process.env[name];
	// The owner's own omp settings stay out of reach: an empty home.
	home = mkdtempSync(join(tmpdir(), "tokenplan-plugin-"));
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	blocked = [];
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.hostname !== "127.0.0.1") {
			blocked.push(url.href);
			return Promise.reject(new Error(`test fetch reaches only 127.0.0.1, not ${url.href}`));
		}
		return realFetch(input, init);
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	for (const name of ENV_NAMES) {
		if (savedEnv[name] === undefined) delete process.env[name];
		else process.env[name] = savedEnv[name];
	}
	rmSync(home, { recursive: true, force: true });
});

interface Registered {
	name: string;
	config: {
		baseUrl: string;
		apiKey?: string;
		fetchDynamicModels(apiKey?: string): Promise<ReturnType<typeof toProviderModel>[]>;
	};
}

async function register(): Promise<Registered> {
	const registered: Registered[] = [];
	await tokenplanExtension({
		setLabel() {},
		registerProvider(name, config) {
			registered.push({ name, config });
		},
	});
	expect(registered).toHaveLength(1);
	return registered[0]!;
}

test("without TOKENPLAN_BASE_URL the provider points at production", async () => {
	const { name, config } = await register();
	expect(name).toBe("tokenplan");
	expect(config.baseUrl).toBe(PROD);
	expect(config.apiKey).toBeUndefined();
});

test("a blank TOKENPLAN_BASE_URL means production too", async () => {
	process.env.TOKENPLAN_BASE_URL = "  ";
	expect((await register()).config.baseUrl).toBe(PROD);
});

test("TOKENPLAN_BASE_URL replaces the address for the provider and the model list", async () => {
	const seen: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			seen.push(`${req.method} ${new URL(req.url).pathname} ${req.headers.get("authorization")}`);
			return Response.json({ data: [{ id: "deepseek-flash" }] });
		},
	});
	try {
		const base = `http://127.0.0.1:${server.port}/v1`;
		process.env.TOKENPLAN_BASE_URL = ` ${base}/ `;
		const { config } = await register();
		expect(config.baseUrl).toBe(base);
		// The model list keeps the address the provider was registered with.
		process.env.TOKENPLAN_BASE_URL = "http://127.0.0.2:9/v1";
		const models = await config.fetchDynamicModels("sk-test");
		expect(models.map((m) => m.id)).toEqual(["deepseek-flash"]);
		expect(seen).toEqual(["GET /v1/models Bearer sk-test"]);
		expect(blocked).toEqual([]);
	} finally {
		server.stop(true);
	}
});

test("reasoning defaults to max, the other levels stay in /model", () => {
	expect(toProviderModel({ id: "deepseek-flash" }).thinking).toEqual({ efforts: EFFORTS, defaultLevel: "max" });
	expect(toProviderModel({ id: "deepseek-flash", supports_reasoning: true }).thinking).toEqual({
		efforts: EFFORTS,
		defaultLevel: "max",
	});
});

test("a model without reasoning gets no reasoning level", () => {
	const model = toProviderModel({ id: "plain", supports_reasoning: false });
	expect(model.reasoning).toBe(false);
	expect(model.thinking).toBeUndefined();
});
