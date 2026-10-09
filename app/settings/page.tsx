import type { Metadata } from "next"

import { SettingsView } from "@/components/settings-view"
import { buildSettingsPayload } from "@/lib/payloads/settings"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPage() {
  const {
    settings,
    models,
    decisionModels,
    localModels,
    imageModels,
    defaultImagePrice,
    profiles,
    followerCounts,
  } = await buildSettingsPayload()

  return (
    <SettingsView
      settings={settings}
      models={models}
      decisionModels={decisionModels}
      localModels={localModels}
      imageModels={imageModels}
      defaultImagePrice={defaultImagePrice}
      profiles={profiles}
      followerCounts={followerCounts}
    />
  )
}
