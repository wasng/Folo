import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "~/lib/query-client"

import { WebsiteFeedPreview } from "./WebsiteFeedPreview"

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), discover: vi.fn() }))
vi.mock("~/lib/api-client", () => ({
  followClient: { api: { discover: { discover: mocks.discover } } },
}))
vi.mock("~/queries/feed", () => ({
  feed: { byId: ({ url }: { url: string }) => ({ key: ["feed", url], fn: mocks.lookup }) },
}))
vi.mock("~/lib/query-client", async () => {
  const { QueryClient } = await import("@tanstack/react-query")
  return { queryClient: new QueryClient() }
})
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("./FeedForm", () => ({
  FeedForm: ({ url, onSuccess }: { url: string; onSuccess: () => void }) => (
    <div data-testid="feed-form" data-url={url}>
      <button onClick={onSuccess}>subscribe</button>
    </div>
  ),
}))

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

async function renderPreview(url: string) {
  vi.stubGlobal("React", React)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const onSuccess = vi.fn()
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <WebsiteFeedPreview url={url} onSuccess={onSuccess} />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await vi.waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.status).toBe("success"))
    // React Query notifies observers on a timer after updating the cache.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    container,
    onSuccess,
    async cleanup() {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
    },
  }
}

describe("website preview workflow", () => {
  it("previews Bilibili dynamic immediately and allows switching before subscribing", async () => {
    const view = await renderPreview("https://space.bilibili.com/99157282/dynamic")
    try {
      expect(
        view.container.querySelector('[data-testid="feed-form"]')?.getAttribute("data-url"),
      ).toBe("rsshub://bilibili/user/dynamic/99157282")
      const videos = [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent === "discover.website.source.bilibili_video",
      )!
      await act(async () => videos.click())
      expect(
        view.container.querySelector('[data-testid="feed-form"]')?.getAttribute("data-url"),
      ).toBe("rsshub://bilibili/user/video/99157282")
      expect(view.onSuccess).not.toHaveBeenCalled()
      await act(async () =>
        view.container
          .querySelector<HTMLButtonElement>('[data-testid="feed-form"] button')!
          .click(),
      )
      expect(view.onSuccess).toHaveBeenCalledOnce()
      expect(mocks.lookup).not.toHaveBeenCalled()
    } finally {
      await view.cleanup()
    }
  })

  it("keeps native RSS URLs returned for any website", async () => {
    mocks.lookup.mockResolvedValue({
      feed: { url: "https://unknown.example.org/atom.xml", title: "Site" },
    })
    mocks.discover.mockResolvedValue({ data: [] })
    const view = await renderPreview("https://unknown.example.org/posts")
    try {
      expect(
        view.container.querySelector('[data-testid="feed-form"]')?.getAttribute("data-url"),
      ).toBe("https://unknown.example.org/atom.xml")
      expect(view.container.textContent).toContain("discover.website.detected")
    } finally {
      await view.cleanup()
    }
  })

  it("offers editable HTML extraction after discovery fails without claiming a feed was found", async () => {
    mocks.lookup.mockRejectedValue(new Error("Not a feed"))
    mocks.discover.mockResolvedValue({ data: [] })
    const view = await renderPreview("https://another.example.org/news")
    try {
      const preview = () =>
        view.container.querySelector('[data-testid="feed-form"]')?.getAttribute("data-url")
      expect(preview()).toContain("rsshub://rsshub/transform/html/")
      expect(view.container.textContent).toContain("Not a feed")
      expect(view.container.textContent).toContain("discover.website.extract_notice")
      expect(view.container.textContent).not.toContain("discover.website.detected")
      const edit = [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent === "discover.website.edit_rules",
      )!
      await act(async () => edit.click())
      const input = view.container.querySelector<HTMLInputElement>("#extract-item")!
      const initialUrl = preview()
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          ".news-card",
        )
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
      expect(preview()).toBe(initialUrl)
      await act(async () =>
        view.container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      )
      expect(decodeURIComponent(decodeURIComponent(preview()!))).toContain("item=.news-card")
      expect(view.onSuccess).not.toHaveBeenCalled()
    } finally {
      await view.cleanup()
    }
  })
})
