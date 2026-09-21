import type { SupportedActionLanguage } from "@follow/shared"
import { useEntry } from "@follow/store/entry/hooks"
import { usePrefetchSummary } from "@follow/store/summary/hooks"
import { useQuery } from "@tanstack/react-query"

import { useAISettingKey } from "~/atoms/settings/ai"

import { generateByokSummary, getSummaryProvider } from "./byok-summary"

export function useEntrySummary({
  entryId,
  target,
  actionLanguage,
  enabled,
}: {
  entryId: string
  target: "content" | "readabilityContent"
  actionLanguage: SupportedActionLanguage
  enabled: boolean
}) {
  const provider = getSummaryProvider(useAISettingKey("byok"))
  const content = useEntry(entryId, (entry) => entry[target])
  const title = useEntry(entryId, (entry) => entry.title)
  const official = usePrefetchSummary({
    entryId,
    target,
    actionLanguage,
    enabled: enabled && !provider,
  })
  const byok = useQuery({
    queryKey: ["byok-summary", provider?.id, entryId, target, actionLanguage, content],
    enabled: enabled && !!provider && content !== undefined,
    queryFn: ({ signal }) => {
      if (!provider) throw new Error("BYOK: no configured provider.")
      return generateByokSummary({
        config: provider.config,
        title,
        content: content || "",
        language: actionLanguage,
        signal,
      })
    },
    retry: false,
    staleTime: 1000 * 60 * 60 * 24,
  })
  return { ...(provider ? byok : official), isByok: !!provider }
}
