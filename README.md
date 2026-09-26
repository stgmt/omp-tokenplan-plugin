# omp-tokenplan-plugin

Oh My Pi provider plugin for the **tokenplan** gateway
(`https://tokenplan.aipomogator.ru`). It registers a `tokenplan` provider
(OpenAI Responses API, Bearer auth), fetches the live model catalog from
`GET /v1/models`, and adds a `/tokenplan` slash command to switch the
session model.

## Requirements

- [Oh My Pi](https://github.com/stgmt/oh-my-pi) 17.3+ (`omp` on PATH)
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

Alternative key sources, highest priority first:

| Source | How |
|---|---|
| `TOKENPLAN_API_KEY` env var | `export TOKENPLAN_API_KEY=sk-…` — wins over stored config, good for CI |
| Project override | `omp plugin config set omp-tokenplan-plugin apiKey <key> --scope project` (writes `.omp/plugin-overrides.json`) |
| Global user config | `omp plugin config set omp-tokenplan-plugin apiKey <key>` (writes `~/.omp/plugins/omp-plugins.lock.json`) |
| `/login tokenplan` in the TUI | interactive prompt; stored in OMP auth credentials |

## Usage

```
/tokenplan                 → switch to the default tokenplan model
/tokenplan <model-id>      → switch to a specific model (e.g. /tokenplan deepseek-chat)
```

Model specs from `omp models` (e.g. `tokenplan/deepseek-chat`) are accepted;
bare `/tokenplan` uses the first authenticated tokenplan model.

The provider uses OMP's `openai-responses` transport with
`Authorization: Bearer <key>`. Prompt caching is handled by OMP core
(`prompt_cache_key`), the plugin does not inject it manually.

## Fail-closed behavior

No API key → the provider advertises no models, makes **zero** requests,
and `/tokenplan` prints how to configure one. A `/v1/models` fetch that
fails (network, non-200, empty catalog) produces an error rather than
stale or partial model metadata.

## Layout

| Path | Role |
|---|---|
| `src/extension.ts` | OMP extension entry: provider + `/tokenplan` command |
| `src/model.ts` | `/v1/models` DTO → provider model mapping (pure, testable) |
| `src/settings.ts` | API-key resolution: env → project override → global lock |
| `bin/tokenplan-install.js` | one-shot install + token store + live validation |
| `dist/extension.js` | bundled extension (built by `bun run build`) |

## Build

```bash
bun run build    # bun build src/extension.ts → dist/extension.js
```

`dist/extension.js` is committed because OMP installs the plugin straight
from the git repository — the bundle must load without a build step.

## License

MIT
