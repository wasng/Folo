import type { UserByokProviderConfig } from "@follow/shared/settings/interface"
import { afterEach, describe, expect, it, vi } from "vitest"

import { generateByokSummary, getSummaryProvider } from "./byok-summary"

const config: UserByokProviderConfig = {
  provider: "openrouter",
  apiKey: "test-key",
  model: "vendor/custom-model",
}

afterEach(() => vi.unstubAllGlobals())

describe("BYOK summary", () => {
  it("uses the official path when disabled or missing a model or key", () => {
    expect(getSummaryProvider({ enabled: false, providers: [config] })).toBeNull()
    expect(getSummaryProvider({ enabled: true, providers: [] })).toBeNull()
    for (const incomplete of [
      { ...config, model: " " },
      { ...config, apiKey: null },
    ]) {
      expect(getSummaryProvider({ enabled: true, providers: [incomplete] })).toBeNull()
    }
  })

  it("selects the first complete provider and accepts Ollama without a key", () => {
    const ollama: UserByokProviderConfig = { provider: "ollama", model: "llama3.2" }
    expect(
      getSummaryProvider({ enabled: true, providers: [{ ...config, model: null }, ollama] })
        ?.config,
    ).toBe(ollama)
  })

  it("isolates caches after settings change without putting credentials in keys", () => {
    const first = getSummaryProvider({ enabled: true, providers: [config] })!
    expect(getSummaryProvider({ enabled: true, providers: [config] })?.id).toBe(first.id)
    expect(getSummaryProvider({ enabled: true, providers: [{ ...config }] })?.id).not.toBe(first.id)
    expect(first.id).not.toContain(config.apiKey)
  })

  it("sends the custom model, article and language directly to OpenRouter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "Summary" } }] })),
      )
    vi.stubGlobal("fetch", fetchMock)
    const signal = new AbortController().signal
    expect(
      await generateByokSummary({
        config,
        title: "Title",
        content: "<p>Article</p><script>untrusted()</script>",
        language: "zh-CN",
        signal,
      }),
    ).toBe("Summary")
    const [url, request] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(request.headers.get("Authorization")).toBe("Bearer test-key")
    expect(request.signal).toBe(signal)
    expect(request.credentials).toBe("omit")
    const payload = JSON.parse(request.body)
    expect(payload.model).toBe("vendor/custom-model")
    expect(payload.max_tokens).toBe(4096)
    expect(payload.messages[0].content).toContain("zh-CN")
    expect(payload.messages[1].content).toBe("Title\n\nArticle")
  })

  it("preserves custom endpoints and provider errors without an official fallback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":{"message":"Insufficient provider credits"}}', { status: 402 }),
      )
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      generateByokSummary({
        config: { ...config, baseURL: "https://example.com/custom/v1/" },
        content: "Article",
        language: "en",
      }),
    ).rejects.toThrow("Insufficient provider credits")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://example.com/custom/v1/chat/completions",
    )
  })

  it("rejects empty responses and empty articles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"choices":[]}'))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      generateByokSummary({ config, content: "Article", language: "en" }),
    ).rejects.toThrow("empty summary")
    await expect(
      generateByokSummary({ config, content: "<p></p>", language: "en" }),
    ).rejects.toThrow("article content is empty")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
