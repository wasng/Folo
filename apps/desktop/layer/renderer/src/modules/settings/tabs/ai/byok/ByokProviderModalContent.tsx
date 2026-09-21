import { Button } from "@follow/components/ui/button/index.js"
import { Input } from "@follow/components/ui/input/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@follow/components/ui/select/index.js"
import type { ByokProviderName, UserByokProviderConfig } from "@follow/shared/settings/interface"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { BYOK_BASE_URLS } from "~/modules/entry-content/byok-summary"

import { PROVIDER_OPTIONS } from "./constants"

interface ByokProviderModalContentProps {
  provider: UserByokProviderConfig | null
  configuredProviders?: ByokProviderName[]
  onSave: (provider: UserByokProviderConfig) => void
  onCancel: () => void
}

const EMPTY_CONFIGURED_PROVIDERS: ByokProviderName[] = []

export const ByokProviderModalContent = ({
  provider,
  configuredProviders = EMPTY_CONFIGURED_PROVIDERS,
  onSave,
  onCancel,
}: ByokProviderModalContentProps) => {
  const { t } = useTranslation("ai")

  // Filter out already configured providers, but keep the current one if editing
  const availableProviders = PROVIDER_OPTIONS.filter(
    (option) => !configuredProviders.includes(option.value) || option.value === provider?.provider,
  )

  // Get the first available provider or fallback to the current one
  const defaultProvider = availableProviders[0]?.value ?? provider?.provider ?? "openai"

  const getDefaultBaseURL = (p: ByokProviderName) => {
    return provider?.provider === p ? (provider.baseURL ?? BYOK_BASE_URLS[p]) : BYOK_BASE_URLS[p]
  }

  const [formData, setFormData] = useState<UserByokProviderConfig>(() => ({
    provider: provider?.provider ?? defaultProvider,
    baseURL: provider?.baseURL ?? getDefaultBaseURL(provider?.provider ?? defaultProvider),
    apiKey: provider?.apiKey ?? null,
    model: provider?.model ?? null,
    headers: provider?.headers ?? {},
  }))

  const handleProviderChange = (value: ByokProviderName) => {
    setFormData((prev) => ({
      ...prev,
      provider: value,
      baseURL: getDefaultBaseURL(value),
      apiKey: null,
      model: null,
      headers: {},
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.model?.trim() || (formData.provider !== "ollama" && !formData.apiKey?.trim())) {
      return
    }
    onSave({
      ...formData,
      baseURL: formData.baseURL?.trim() || null,
      apiKey: formData.apiKey?.trim() || null,
      model: formData.model?.trim() || null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-[40ch] space-y-4">
      <div className="space-y-2">
        <Label htmlFor="provider">{t("byok.providers.form.provider")}</Label>
        <Select
          value={formData.provider}
          disabled={availableProviders.length === 0}
          onValueChange={(value) => handleProviderChange(value as ByokProviderName)}
        >
          <SelectTrigger id="provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableProviders.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="baseURL">{t("byok.providers.form.base_url")}</Label>
        <Input
          id="baseURL"
          type="url"
          placeholder={t("byok.providers.form.base_url_placeholder")}
          value={formData.baseURL ?? ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              baseURL: e.target.value || null,
            })
          }
        />
        <p className="text-xs text-text-secondary">{t("byok.providers.form.base_url_help")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="model">{t("byok.providers.form.model")}</Label>
        <Input
          id="model"
          type="text"
          required
          placeholder={t("byok.providers.form.model_placeholder")}
          value={formData.model ?? ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              model: e.target.value || null,
            })
          }
        />
        <p className="text-xs text-text-secondary">{t("byok.providers.form.model_help")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">{t("byok.providers.form.api_key")}</Label>
        <Input
          id="apiKey"
          type="password"
          required={formData.provider !== "ollama"}
          placeholder={t("byok.providers.form.api_key_placeholder")}
          value={formData.apiKey ?? ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              apiKey: e.target.value || null,
            })
          }
        />
        <p className="text-xs text-text-secondary">{t("byok.providers.form.api_key_help")}</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("words.cancel", { ns: "common" })}
        </Button>
        <Button type="submit">{t("words.save", { ns: "common" })}</Button>
      </div>
    </form>
  )
}
