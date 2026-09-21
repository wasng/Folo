import type { UserByokSettings } from "@follow/shared/settings/interface"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useEntrySummary } from "./use-entry-summary"

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, providers: [] } as UserByokSettings,
  official: vi.fn((_options: { enabled: boolean }) => ({ data: "official", error: null })),
}))

vi.mock("~/atoms/settings/ai", () => ({ useAISettingKey: () => mocks.settings }))
vi.mock("@follow/store/summary/hooks", () => ({ usePrefetchSummary: mocks.official }))
vi.mock("@follow/store/entry/hooks", () => ({
  useEntry: (_id: string, selector: (entry: Record<string, string>) => unknown) =>
    selector({ title: "Title", content: "Article", readabilityContent: "Full article" }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("article summary routing", () => {
  it("never enables the official request on BYOK errors, and restores it when disabled", async () => {
    vi.stubGlobal("React", React)
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    mocks.settings = {
      enabled: true,
      providers: [{ provider: "openrouter", model: "vendor/model", apiKey: "test-key" }],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Provider credits exhausted", { status: 402 }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement("div")
    const root = createRoot(container)
    let result: ReturnType<typeof useEntrySummary> | undefined
    function Harness() {
      result = useEntrySummary({
        entryId: "entry-1",
        target: "readabilityContent",
        actionLanguage: "en",
        enabled: true,
      })
      return null
    }
    const render = () =>
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      )
    try {
      await act(async () => {
        render()
      })
      await act(async () => {
        await vi.waitFor(() =>
          expect(client.getQueryCache().getAll()[0]?.state.status).toBe("error"),
        )
      })
      expect(result?.error?.message).toContain("Provider credits exhausted")
      expect(result?.isByok).toBe(true)
      expect(mocks.official.mock.calls.every(([options]) => !options.enabled)).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).messages[1].content).toContain(
        "Full article",
      )
      mocks.settings = { ...mocks.settings, enabled: false }
      await act(async () => {
        render()
      })
      expect(mocks.official).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }))
      expect(result?.isByok).toBe(false)
      expect(result?.data).toBe("official")
    } finally {
      await act(async () => root.unmount())
      client.clear()
    }
  })
})
