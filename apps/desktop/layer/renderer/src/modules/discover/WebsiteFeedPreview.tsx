import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.js"
import { LoadingCircle } from "@follow/components/ui/loading/index.jsx"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { followClient } from "~/lib/api-client"
import { queryClient } from "~/lib/query-client"
import { feed } from "~/queries/feed"

import { FeedForm } from "./FeedForm"
import {
  createWebsiteFeedUrl,
  DEFAULT_HTML_RULES,
  getWebsiteFeedNotice,
  parseWebsiteUrl,
  resolveWebsiteFeed,
} from "./website-feed"

export function WebsiteFeedPreview({ url, onSuccess }: { url: string; onSuccess: () => void }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [rules, setRules] = useState(DEFAULT_HTML_RULES)
  const [htmlUrl, setHtmlUrl] = useState(() => createWebsiteFeedUrl(url, DEFAULT_HTML_RULES))
  const [editing, setEditing] = useState(false)
  const discovery = useQuery({
    queryKey: ["website-feed", url],
    retry: false,
    queryFn: () =>
      resolveWebsiteFeed(url, {
        lookup: async (sourceUrl) => {
          const query = feed.byId({ url: sourceUrl })
          const result = await queryClient.fetchQuery({
            queryKey: query.key,
            queryFn: query.fn,
            retry: false,
          })
          return result?.feed?.url
            ? { url: result.feed.url, title: result.feed.title || result.feed.url }
            : null
        },
        discover: async (sourceUrl) => {
          const { data } = await followClient.api.discover.discover({
            keyword: sourceUrl,
            target: "feeds",
          })
          return data.flatMap((item) =>
            item.feed?.url ? [{ url: item.feed.url, title: item.feed.title || item.feed.url }] : [],
          )
        },
      }),
  })
  if (discovery.isPending) {
    return (
      <div className="center min-h-40 gap-3">
        <LoadingCircle size="medium" />
        {t("discover.website.loading")}
      </div>
    )
  }
  if (discovery.error) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>{discovery.error.message}</p>
        <Button onClick={() => discovery.refetch()}>{t("discover.website.retry")}</Button>
      </div>
    )
  }

  const candidates = discovery.data.candidates
  const activeUrl = selected === "html" ? htmlUrl : selected || candidates[0]?.url || htmlUrl
  const isHtml = selected === "html" || (!selected && !candidates.length)
  const notice = getWebsiteFeedNotice(parseWebsiteUrl(url))

  return (
    <div className="w-full space-y-4" data-testid="website-feed-preview">
      <p className="break-all text-xs text-text-secondary">{url}</p>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={t("discover.website.sources")}>
          {candidates.map((candidate) => (
            <Button
              key={candidate.url}
              variant={activeUrl === candidate.url ? "primary" : "outline"}
              onClick={() => {
                setSelected(candidate.url)
                setEditing(false)
              }}
            >
              {candidate.label ? t(`discover.website.source.${candidate.label}`) : candidate.title}
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-lg bg-fill-secondary p-3 text-sm text-text-secondary">
        <p>{t(isHtml ? "discover.website.extract_notice" : "discover.website.detected")}</p>
        {isHtml && <p>{t(`discover.website.notice.${notice}`)}</p>}
        {!!discovery.data.errors.length && !candidates.length && (
          <details>
            <summary>{t("discover.website.lookup_failed")}</summary>
            {discovery.data.errors.map((error, index) => (
              <p key={index} className="break-all">
                {error}
              </p>
            ))}
          </details>
        )}
        <p className="break-all font-mono text-xs" data-testid="resolved-feed-url">
          {activeUrl}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setSelected("html")
            setEditing(true)
          }}
        >
          {t("discover.website.edit_rules")}
        </Button>
      </div>
      {editing && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            setHtmlUrl(createWebsiteFeedUrl(url, rules))
            setSelected("html")
          }}
        >
          {(["item", "itemTitle", "itemLink"] as const).map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`extract-${key}`}>{t(`discover.website.rule.${key}`)}</Label>
              <Input
                id={`extract-${key}`}
                value={rules[key]}
                required={key === "item"}
                onChange={(event) => setRules({ ...rules, [key]: event.target.value })}
              />
            </div>
          ))}
          <Button type="submit">{t("discover.preview")}</Button>
        </form>
      )}
      <FeedForm key={activeUrl} url={activeUrl} onSuccess={onSuccess} showErrorDetails />
    </div>
  )
}
