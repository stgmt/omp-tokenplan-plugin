# omp-tokenplan-plugin

Oh My Pi provider plugin for the **tokenplan** gateway
(`https://tokenplan.aipomogator.ru`). It registers a `tokenplan` provider
(OpenAI Responses API, Bearer auth) and fetches the live model catalog
from `GET /v1/models`. You pick the model in OMP's own `/model`.

`TOKENPLAN_BASE_URL` replaces the gateway address (tests, staging), for
example `TOKENPLAN_BASE_URL=http://127.0.0.1:3000/v1`. Unset or blank means
production. The extension and the installer both follow it.

## Requirements

- Oh My Pi 17.3+ (`omp` on PATH)
- A tokenplan API key

## Install (two commands)

```bash
omp plugin install github:stgmt/omp-tokenplan-plugin
bunx github:stgmt/omp-tokenplan-plugin --token <your-api-key>
```

The second command is the plugin's own installer. It:

1. checks the plugin is registered with OMP (installs it if not),
2. validates the token against `GET /v1/models` — a rejected key is
   never stored,
3. persists the key as the plugin `apiKey` setting
   (same thing `omp plugin config set omp-tokenplan-plugin apiKey <key>` does).

Key sources — stored settings win over the environment (`env` is the
declared fallback, so a stale env var can't shadow a key you just set):

| Priority | Source | How |
|---|---|---|
| 1 | Project override | `.omp/plugin-overrides.json` `settings.omp-tokenplan-plugin.apiKey` (also probed under `.claude`/`.codex`/`.gemini`) |
| 2 | Global user config | `omp plugin config set omp-tokenplan-plugin apiKey <key>` (writes `~/.omp/plugins/omp-plugins.lock.json`, profile/XDG-aware) |
| 3 | Env fallback | `export TOKENPLAN_API_KEY=sk-…` |
| — | `/login tokenplan` in the TUI | interactive prompt; stored in OMP auth credentials — independent of the list above |

`secret: true` masks the key in `omp plugin config list` output only —
it is stored as plaintext in the lock file. The key appears once on the
installer's child-process command line (`omp plugin config set`); if your
token contains cmd.exe metacharacters the installer still passes it safely
(no shell is used), but process-list snapshots can see argv.

## Usage

In an OMP session type `/model` and pick a `tokenplan/<model-id>` model.
The plugin adds no slash command of its own.

Reasoning defaults to `max` on tokenplan models. `/model` offers the
other levels (`minimal` … `xhigh`), and a level you pick there wins.

The provider uses OMP's `openai-responses` transport with
`Authorization: Bearer <key>`. Prompt caching is handled by OMP core
(`prompt_cache_key`), the plugin does not inject it manually.

## Fail-closed behavior

No API key → the provider advertises no models and makes **zero**
requests, so `/model` lists no tokenplan model; the install command above
stores a key. A `/v1/models` fetch that fails (network, non-200, empty
catalog) produces an error rather than stale or partial model metadata.

## Layout

| Path | Role |
|---|---|
| `src/extension.ts` | OMP extension entry: the `tokenplan` provider |
| `src/model.ts` | `/v1/models` DTO → provider model mapping (pure, testable) |
| `src/settings.ts` | API-key resolution: project override → global lock → env fallback |
| `bin/tokenplan-install.js` | one-shot install + token store + live validation |
| `dist/extension.js` | bundled extension (built by `bun run build`) |

## Build

```bash
bun run build    # bun build src/extension.ts → dist/extension.js
bun test         # test/: address override and reasoning default; fetch reaches only 127.0.0.1
```

`dist/extension.js` is committed because OMP installs the plugin straight
from the git repository — the bundle must load without a build step.

## License

MIT
