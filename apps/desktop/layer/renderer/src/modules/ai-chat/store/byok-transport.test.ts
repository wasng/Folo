import type { UserByokProviderConfig, UserByokSettings } from "@follow/shared/settings/interface"
import type { UIMessageChunk } from "ai"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createByokChatTransport } from "./byok-transport"
import type { BizUIMessage } from "./types"

type StubEntry = {
  title?: string | null
  author?: string | null
  url?: string | null
  feedId?: string | null
  publishedAt?: Date
  content?: string | null
  readabilityContent?: string | null
  description?: string | null
  read?: boolean
}

const mocks = vi.hoisted(() => ({
  byok: { value: { enabled: true, providers: [] } as UserByokSettings },
  entries: {} as Record<string, StubEntry>,
  entryIds: [] as string[],
  feedTitle: null as string | null,
}))

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: () => ({ byok: mocks.byok.value }),
}))

vi.mock("@follow/store/entry/getter", () => ({
  getEntry: (id: string) => mocks.entries[id] ?? null,
  getEntryIdsByFeedId: () => mocks.entryIds,
  getEntryIdsByView: () => mocks.entryIds,
}))

vi.mock("@follow/store/subscription/getter", () => ({
  getSubscriptionByFeedId: () => (mocks.feedTitle ? { title: mocks.feedTitle } : undefined),
}))

vi.mock("@follow/store/feed/getter", () => ({
  getFeedById: () => (mocks.feedTitle ? { title: mocks.feedTitle } : undefined),
}))

const config: UserByokProviderConfig = {
  provider: "openrouter",
  apiKey: "test-key",
  model: "vendor/custom-model",
}

const setProvider = (provider: UserByokProviderConfig) => {
  mocks.byok.value = { enabled: true, providers: [provider] }
}

const message = (
  role: "system" | "user" | "assistant",
  id: string,
  parts: BizUIMessage["parts"],
): BizUIMessage => ({ id, role, parts, createdAt: new Date(0) })

/** Stream the given raw SSE payloads, optionally split mid-line to test buffering. */
const sseResponse = (chunks: string[]) => {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  )
}

const collect = async (stream: ReadableStream<UIMessageChunk>) => {
  const chunks: UIMessageChunk[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

const send = (
  transport: ReturnType<typeof createByokChatTransport>,
  messages: BizUIMessage[],
  abortSignal?: AbortSignal,
) =>
  transport.sendMessages({
    trigger: "submit-message",
    chatId: "chat-1",
    messageId: undefined,
    messages,
    abortSignal,
  })

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.entries = {}
  mocks.entryIds = []
  mocks.feedTitle = null
})

describe("BYOK chat transport", () => {
  it("refuses to run without a complete provider", async () => {
    mocks.byok.value = { enabled: false, providers: [config] }
    await expect(send(createByokChatTransport(), [])).rejects.toThrow("no configured provider")

    mocks.byok.value = { enabled: true, providers: [{ ...config, model: " " }] }
    await expect(send(createByokChatTransport(), [])).rejects.toThrow("no configured provider")
  })

  it("posts text-only history to the provider with the user's own key", async () => {
    setProvider(config)
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    vi.stubGlobal("fetch", fetchMock)
    const signal = new AbortController().signal
    const transport = createByokChatTransport()

    await collect(
      await send(
        transport,
        [
          message("user", "u1", [
            { type: "step-start" },
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ]),
          message("assistant", "a1", [{ type: "text", text: "" }]),
          message("assistant", "a2", [{ type: "text", text: "Hi there" }]),
        ],
        signal,
      ),
    )

    const [url, request] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(request.method).toBe("POST")
    expect(request.credentials).toBe("omit")
    expect(request.signal).toBe(signal)
    expect(request.headers.get("Authorization")).toBe("Bearer test-key")
    expect(request.headers.get("Content-Type")).toBe("application/json")

    const payload = JSON.parse(request.body)
    expect(payload.model).toBe("vendor/custom-model")
    expect(payload.stream).toBe(true)
    // Non-text parts are dropped, empty messages are skipped, and the system
    // prompt is prepended.
    expect(payload.messages).toEqual([
      { role: "system", content: expect.stringContaining("Folo AI") },
      { role: "user", content: "Hello world" },
      { role: "assistant", content: "Hi there" },
    ])
  })

  it("sends what the user typed and the attached reading context", async () => {
    setProvider(config)
    mocks.entries = {
      "entry-1": {
        title: "Folo ships BYOK",
        author: "Jane",
        url: "https://example.com/post",
        feedId: "feed-1",
        publishedAt: new Date("2026-09-01T00:00:00Z"),
        content: "<p>Hello <b>world</b></p><script>tracker()</script>",
      },
    }
    mocks.feedTitle = "Folo Blog"
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    vi.stubGlobal("fetch", fetchMock)

    await collect(
      await send(createByokChatTransport(), [
        message("user", "u1", [
          {
            type: "data-block",
            data: [
              { id: "b1", type: "mainEntry", value: "entry-1" },
              { id: "b2", type: "unreadOnly", value: "true" },
              { id: "b3", type: "mainFeed", value: "feed-1" },
              { id: "b4", type: "mainEntry", value: "missing-entry", disabled: true },
            ],
          },
          { type: "data-rich-text", data: { state: "{}", text: "Summarise this" } },
        ]),
      ]),
    )

    const [, request] = fetchMock.mock.calls[0]!
    const content = JSON.parse(request.body).messages[1].content
    // Folo keeps the typed text in a data part, not in a text part.
    expect(content).toContain("Summarise this")
    // Context blocks are spelled out because the provider cannot resolve ids.
    expect(content).toContain("<reading_context>")
    expect(content).toContain("Folo ships BYOK")
    expect(content).toContain("Jane")
    expect(content).toContain("Folo Blog")
    expect(content).toContain("Only unread entries are in scope.")
    // Markup is stripped, scripts along with it.
    expect(content).toContain("Hello world")
    expect(content).not.toContain("tracker()")
    expect(content).not.toContain("<p>")
    // Disabled blocks are excluded.
    expect(content.match(/currently reading/g)).toHaveLength(1)
  })

  it("lists the entries in scope when the user asks about a feed or view", async () => {
    setProvider(config)
    mocks.entries = {
      "e-old": { title: "Older post", feedId: "feed-1", publishedAt: new Date("2026-09-01") },
      "e-new": { title: "Newer post", feedId: "feed-1", publishedAt: new Date("2026-09-05") },
      "e-read": {
        title: "Already read",
        feedId: "feed-1",
        publishedAt: new Date("2026-09-06"),
        read: true,
      },
    }
    mocks.entryIds = ["e-old", "e-read", "e-new"]
    mocks.feedTitle = "Folo Blog"
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    vi.stubGlobal("fetch", fetchMock)

    await collect(
      await send(createByokChatTransport(), [
        message("user", "u1", [
          {
            type: "data-block",
            data: [
              { id: "b1", type: "mainView", value: "0" },
              { id: "b2", type: "mainFeed", value: "feed-1" },
              { id: "b3", type: "unreadOnly", value: "true" },
            ],
          },
          { type: "data-rich-text", data: { state: "{}", text: "What is new today?" } },
        ]),
      ]),
    )

    const [, request] = fetchMock.mock.calls[0]!
    const content = JSON.parse(request.body).messages[1].content
    expect(content).toContain("Entries in this scope")
    expect(content).toContain("Folo Blog")
    expect(content).toContain("What is new today?")
    // Most recent first, and read entries are filtered out by the unread block.
    expect(content.indexOf("Newer post")).toBeLessThan(content.indexOf("Older post"))
    expect(content).not.toContain("Already read")
  })

  it("turns SSE deltas into UI message chunks", async () => {
    setProvider(config)
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
            "data: [DONE]\n\ndata: not-json\n\n",
          ]),
        ),
    )

    const chunks = await collect(await send(createByokChatTransport(), []))
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ])
    const ids = chunks
      .filter((chunk) => chunk.type !== "start" && chunk.type !== "finish")
      .map((chunk) => (chunk as { id: string }).id)
    expect(new Set(ids).size).toBe(1)
    expect(
      chunks
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => (chunk as { delta: string }).delta),
    ).toEqual(["He", "llo"])
  })

  it("reassembles deltas split across stream chunks", async () => {
    setProvider(config)
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"choices":[{"delta":{"content":"Par"}}]}\n\ndata: {"choi',
            'ces":[{"delta":{"content":"tial"}}]}\n\n',
          ]),
        ),
    )

    const chunks = await collect(await send(createByokChatTransport(), []))
    expect(
      chunks
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => (chunk as { delta: string }).delta),
    ).toEqual(["Par", "tial"])
  })

  it("keeps custom endpoints and surfaces provider errors without a Folo fallback", async () => {
    setProvider({ ...config, baseURL: "https://example.com/custom/v1/" })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":{"message":"Insufficient provider credits"}}', { status: 402 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(send(createByokChatTransport(), [])).rejects.toThrow(
      "Insufficient provider credits",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://example.com/custom/v1/chat/completions",
    )
  })

  it("cannot reconnect to a BYOK stream", async () => {
    setProvider(config)
    await expect(
      createByokChatTransport().reconnectToStream({ chatId: "chat-1" }),
    ).resolves.toBeNull()
  })
})
