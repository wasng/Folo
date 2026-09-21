# Web BYOK article summaries

## Scope

Based on official `dev` at `379a6e6da`, with PR #5001 commit
`5b8f75d1776263847789a9b1f486fd12cc75dbf8` applied using `git cherry-pick --no-commit`.
This implements the first phase of `folo_byok_requirements.md`: single-article
summaries in the existing Web UI. Translation, chat, and timeline summaries retain
their upstream behavior and may still require a Folo plan.

## Run and configure

1. Run `pnpm install --frozen-lockfile` at the repository root.
2. Run `pnpm --filter Folo dev:web` and open the URL printed by Vite.
3. In Settings → AI → BYOK, enable BYOK and add OpenRouter.
4. Set Base URL to `https://openrouter.ai/api/v1`, enter your API key and any model
   ID available to your provider account. Save the configuration.
5. Enable article summaries in Settings → General and open an article.

The first configured provider with a nonempty model and API key is selected;
Ollama requires only a model. Settings persist in this browser's local storage.
Switching provider in the configuration form clears credentials and model and
restores that provider's default URL. Custom URLs must expose the OpenAI-compatible
`/chat/completions` API and allow browser requests from your Web origin (CORS).
Local Ollama also needs an allowed browser origin; HTTPS pages may restrict HTTP
endpoints. The browser reports network/CORS failures without exposing a provider
response body.

## Behavior

- A complete, enabled BYOK configuration sends article text directly to the
  provider; it does not call Folo's summary endpoint or consume Folo credits.
- Readability mode summarizes the loaded readability content; otherwise it uses
  the article content already loaded by Folo.
- BYOK failures display the provider status/body or browser network error. There
  is no automatic fallback to Folo and no automatic retry that might incur fees.
- Disabled or incomplete BYOK configurations keep the original official path.
- BYOK results have a separate in-memory cache, isolated by configuration,
  article content, language and content mode. Credentials are excluded from query
  keys. Editing a provider creates a new cache identity.

## Manual acceptance

Use a free Folo account and your own provider credentials:

1. Save settings, reload, and verify the provider, URL and model remain populated.
2. Open an article with summaries enabled. Verify a POST to your provider's
   `/chat/completions`, the exact configured model, and no Folo summary request.
3. Confirm summary text is displayed without an upgrade prompt.
4. Use an invalid key/model and verify the provider error appears without a Folo
   plan prompt or fallback request.
5. Change model, language and readability mode; verify a fresh matching summary.
6. Disable BYOK and verify the official request and original upgrade handling.
7. Check subscription navigation, reading and favorites as usual.

Automated tests use mocked provider responses; live provider billing and a real
free-account session require the manual checks above.

## Validation on Windows

- Repository typecheck: all 20 tasks passed.
- Repository formatting/typecheck/lint gate: all 22 tasks passed; upstream lint
  warnings remain (zero errors).
- Web tests: 44 files, 147 tests passed, with no type errors. This includes 9
  summary/provider/routing/card tests across 3 files.
- Web production build: passed using `pnpm exec cross-env WEB_BUILD=1 vite build`
  from `apps/desktop` (avoids the upstream shell-specific `rm` wrapper).
- Development server: HTTP 200 at `http://127.0.0.1:2233/`; headless Edge rendered
  the application with no JavaScript page errors. The test environment could not
  connect to the official server, so authenticated use remains unverified.
- The full repository test command was interrupted by the unrelated CLI build's
  `chmod` command, which is unavailable in Windows PowerShell. The Web suite was
  subsequently run independently to completion.
