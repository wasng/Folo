import { describe, expect, it, vi } from "vitest"

import {
  createWebsiteFeedUrl,
  DEFAULT_HTML_RULES,
  getWebsiteFeedCandidates,
  getWebsiteFeedNotice,
  isFeedLikeUrl,
  normalizeDiscoverInput,
  parseWebsiteUrl,
  resolveWebsiteFeed,
} from "./website-feed"

describe("website input", () => {
  it("accepts arbitrary domains, pasted Markdown links and existing feed schemes", () => {
    expect(normalizeDiscoverInput(" example.org/news?q=中文 ")).toBe(
      "https://example.org/news?q=中文",
    )
    expect(normalizeDiscoverInput("[Site](https://example.org/posts)")).toBe(
      "https://example.org/posts",
    )
    for (const value of [
      "rsshub://test/route",
      "follow://feed/123",
      "folo://feed/123",
      "https://example.org/feed.xml",
    ]) {
      expect(isFeedLikeUrl(value)).toBe(true)
      expect(normalizeDiscoverInput(value)).toBe(value)
    }
    expect(isFeedLikeUrl("a search keyword")).toBe(false)
  })

  it("does not forward embedded credentials or non-HTTP URLs for extraction", () => {
    for (const value of [
      "https://user:password@example.org",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ]) {
      expect(() => parseWebsiteUrl(value)).toThrow()
    }
  })
})

describe("verified route mappings", () => {
  it("maps Bilibili dynamic and upload pages and keeps both choices", () => {
    expect(
      getWebsiteFeedCandidates(
        new URL("https://space.bilibili.com/99157282/dynamic?spm_id_from=1"),
      )[0]?.url,
    ).toBe("rsshub://bilibili/user/dynamic/99157282")
    const candidates = getWebsiteFeedCandidates(
      new URL("https://space.bilibili.com/99157282/upload/video"),
    )
    expect(candidates.map((item) => item.url)).toEqual([
      "rsshub://bilibili/user/video/99157282",
      "rsshub://bilibili/user/dynamic/99157282",
    ])
  })

  it("maps Xiaohongshu profiles without carrying tracking credentials into the feed", () => {
    expect(
      getWebsiteFeedCandidates(
        new URL(
          "https://www.xiaohongshu.com/user/profile/593032945e87e77791e03696?xsec_token=private",
        ),
      )[0]?.url,
    ).toBe("rsshub://xiaohongshu/user/593032945e87e77791e03696/notes")
  })

  it("maps WeChat columns and albums while preserving cid=0 and encoded IDs", () => {
    expect(
      getWebsiteFeedCandidates(
        new URL("https://mp.weixin.qq.com/mp/homepage?__biz=MzA3MDM3NjE5NQ%3D%3D&hid=4&cid=0"),
      )[0]?.url,
    ).toBe("rsshub://wechat/mp/homepage/MzA3MDM3NjE5NQ%3D%3D/4/0")
    expect(
      getWebsiteFeedCandidates(
        new URL("https://mp.weixin.qq.com/mp/appmsgalbum?__biz=abc%2Bdef%3D&album_id=123"),
      )[0]?.url,
    ).toBe("rsshub://wechat/mp/msgalbum/abc%2Bdef%3D/123")
  })

  it.each([
    "https://space.bilibili.com.example.org/99157282/dynamic",
    "https://space.bilibili.com/99157282/favlist",
    "https://www.bilibili.com/video/BV123",
    "https://www.xiaohongshu.com/explore/593032945e87e77791e03696",
    "https://mp.weixin.qq.com/s?__biz=abc",
    "https://mp.weixin.qq.com/mp/homepage?__biz=abc",
    "https://arbitrary.example.org/posts",
  ])("does not invent routes for %s", (url) => {
    expect(getWebsiteFeedCandidates(new URL(url))).toEqual([])
  })

  it("explains short links and individual WeChat articles", () => {
    expect(getWebsiteFeedNotice(new URL("https://xhslink.com/a/abc"))).toBe("short_link")
    expect(getWebsiteFeedNotice(new URL("https://mp.weixin.qq.com/s/abc"))).toBe("wechat")
  })
})

describe("all-site discovery and extraction", () => {
  it("skips unnecessary discovery for deterministic routes", async () => {
    const services = { lookup: vi.fn(), discover: vi.fn() }
    const result = await resolveWebsiteFeed("https://space.bilibili.com/99157282/dynamic", services)
    expect(result.kind).toBe("matched")
    expect(services.lookup).not.toHaveBeenCalled()
    expect(services.discover).not.toHaveBeenCalled()
  })

  it("discovers native feeds on arbitrary domains and deduplicates choices", async () => {
    const native = { url: "https://example.org/feed.xml", title: "Native" }
    const services = {
      lookup: vi.fn().mockResolvedValue(native),
      discover: vi
        .fn()
        .mockResolvedValue([native, { url: "https://example.org/atom", title: "Atom" }]),
    }
    const result = await resolveWebsiteFeed("example.org/news", services)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]).toEqual(native)
    expect(services.discover).toHaveBeenCalledWith("https://example.org/news")
  })

  it("retains discovery results if the original page is not a feed", async () => {
    const result = await resolveWebsiteFeed("https://unknown.example.org", {
      lookup: vi.fn().mockRejectedValue(new Error("Not RSS")),
      discover: vi.fn().mockResolvedValue([{ url: "rsshub://other/route", title: "Found" }]),
    })
    expect(result.candidates[0]?.url).toBe("rsshub://other/route")
    expect(result.errors).toEqual(["Not RSS"])
  })

  it("retains actual discovery errors and leaves generic extraction available", async () => {
    const result = await resolveWebsiteFeed("https://unknown.example.org", {
      lookup: vi.fn().mockRejectedValue(new Error("Offline")),
      discover: vi.fn().mockRejectedValue(new Error("Unauthorized")),
    })
    expect(result.candidates).toEqual([])
    expect(result.errors).toEqual(["Offline", "Unauthorized"])
    expect(createWebsiteFeedUrl("https://unknown.example.org", DEFAULT_HTML_RULES)).toMatch(
      /^rsshub:\/\/rsshub\/transform\/html\//,
    )
  })

  it("encodes URL, selector and title independently without query injection", () => {
    const url = "https://example.org/news?q=中文&sort=new#section"
    const rules = { item: 'a[href*="?a=1&b=2"]', title: "News & item=body", itemLink: "" }
    const route = createWebsiteFeedUrl(url, rules)
    const [encodedUrl, encodedRules] = route
      .replace("rsshub://rsshub/transform/html/", "")
      .split("/")
    expect(decodeURIComponent(encodedUrl!)).toBe(new URL(url.split("#")[0]!).href)
    const params = new URLSearchParams(decodeURIComponent(encodedRules!))
    expect(params.get("item")).toBe(rules.item)
    expect(params.get("title")).toBe(rules.title)
    expect([...params.keys()]).toEqual(["item", "title"])
  })
})
