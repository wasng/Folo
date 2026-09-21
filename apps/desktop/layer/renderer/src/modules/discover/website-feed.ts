export function normalizeDiscoverInput(input: string): string {
  const value = input.trim()
  const markdown = value.match(/^\[[^\]]*\]\((https?:\/\/\S+)\)$/i)
  if (markdown) return markdown[1]!
  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value)) {
    return `https://${value}`
  }
  return value
}

export function isFeedLikeUrl(input: string): boolean {
  return /^(?:https?:\/\/|rsshub:\/\/|folo:\/\/|follow:\/\/)/i.test(normalizeDiscoverInput(input))
}

export function isWebsiteUrl(input: string): boolean {
  return /^https?:\/\//i.test(normalizeDiscoverInput(input))
}

export function parseWebsiteUrl(input: string): URL {
  const url = new URL(normalizeDiscoverInput(input))
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Please enter an HTTP(S) URL without embedded credentials.")
  }
  return url
}

export type WebsiteFeedCandidate = {
  url: string
  title: string
  label?:
    "bilibili_dynamic" | "bilibili_video" | "xiaohongshu_notes" | "wechat_homepage" | "wechat_album"
}

export type WebsiteFeedNotice = "wechat" | "short_link" | "profile" | "generic"

export function getWebsiteFeedNotice(url: URL): WebsiteFeedNotice {
  if (url.hostname === "mp.weixin.qq.com") return "wechat"
  if (["b23.tv", "xhslink.com", "www.xhslink.com"].includes(url.hostname)) return "short_link"
  if (["xiaohongshu.com", "www.xiaohongshu.com", "www.bilibili.com"].includes(url.hostname)) {
    return "profile"
  }
  return "generic"
}

// Based on RSSHub route declarations and their radar source/target mappings.
// Unknown domains always continue through server discovery and HTML extraction.
export function getWebsiteFeedCandidates(url: URL): WebsiteFeedCandidate[] {
  const path = url.pathname.replace(/\/+$/, "")
  if (url.hostname === "space.bilibili.com") {
    const match = path.match(/^\/(\d+)(?:\/(dynamic|video|upload)(?:\/video)?)?$/)
    if (match) {
      const dynamic: WebsiteFeedCandidate = {
        url: `rsshub://bilibili/user/dynamic/${match[1]}`,
        title: "Bilibili",
        label: "bilibili_dynamic",
      }
      const videos: WebsiteFeedCandidate = {
        url: `rsshub://bilibili/user/video/${match[1]}`,
        title: "Bilibili",
        label: "bilibili_video",
      }
      return match[2] && match[2] !== "dynamic" ? [videos, dynamic] : [dynamic, videos]
    }
  }
  if (["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname)) {
    const match = path.match(/^\/user\/profile\/([a-f\d]{24})$/i)
    if (match)
      return [
        {
          url: `rsshub://xiaohongshu/user/${match[1]}/notes`,
          title: "Xiaohongshu",
          label: "xiaohongshu_notes",
        },
      ]
  }
  if (url.hostname === "mp.weixin.qq.com") {
    const biz = url.searchParams.get("__biz")
    if (!biz || !/^[\w+/=-]+$/.test(biz)) return []
    const encodedBiz = encodeURIComponent(biz)
    if (path === "/mp/homepage") {
      const hid = url.searchParams.get("hid")
      const cid = url.searchParams.get("cid")
      if (hid && /^\d+$/.test(hid)) {
        return [
          {
            url: `rsshub://wechat/mp/homepage/${encodedBiz}/${hid}${cid && /^\d+$/.test(cid) ? `/${cid}` : ""}`,
            title: "WeChat",
            label: "wechat_homepage",
          },
        ]
      }
    }
    if (path === "/mp/appmsgalbum") {
      const aid = url.searchParams.get("album_id")
      if (aid && /^\d+$/.test(aid)) {
        return [
          {
            url: `rsshub://wechat/mp/msgalbum/${encodedBiz}/${aid}`,
            title: "WeChat",
            label: "wechat_album",
          },
        ]
      }
    }
  }
  return []
}

export const DEFAULT_HTML_RULES = {
  item: "article",
  itemTitle: "h1, h2, h3",
  itemLink: "h1 a, h2 a, h3 a",
}

export function createWebsiteFeedUrl(input: string, rules: Record<string, string>): string {
  const url = parseWebsiteUrl(input)
  url.hash = ""
  // Encode parameter values before encoding the route segment, so '&' in a
  // selector/title and '?' in the source URL cannot create extra parameters.
  const params = new URLSearchParams(Object.entries(rules).filter(([, value]) => value.trim()))
  return `rsshub://rsshub/transform/html/${encodeURIComponent(url.href)}/${encodeURIComponent(params.toString())}`
}

type WebsiteFeedServices = {
  lookup: (url: string) => Promise<WebsiteFeedCandidate | null>
  discover: (url: string) => Promise<WebsiteFeedCandidate[]>
}

export async function resolveWebsiteFeed(input: string, services: WebsiteFeedServices) {
  const url = parseWebsiteUrl(input)
  const matched = getWebsiteFeedCandidates(url)
  if (matched.length)
    return { candidates: matched, kind: "matched" as const, errors: [] as string[] }

  const results = await Promise.allSettled([services.lookup(url.href), services.discover(url.href)])
  const candidates = new Map<string, WebsiteFeedCandidate>()
  const errors: string[] = []
  for (const result of results) {
    if (result.status === "rejected") {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
      continue
    }
    const items = Array.isArray(result.value) ? result.value : result.value ? [result.value] : []
    for (const candidate of items) {
      if (isFeedLikeUrl(candidate.url) && !candidates.has(candidate.url)) {
        candidates.set(candidate.url, candidate)
      }
    }
  }
  return { candidates: [...candidates.values()], kind: "discovered" as const, errors }
}
