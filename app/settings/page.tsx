import type { Metadata } from "next"

import { SettingsView } from "@/components/settings-view"
import {
  countProfileFollowers,
  getAppSettings,
  listModelProfiles,
} from "@/lib/db/queries"
import { listModels } from "@/lib/generation/models"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPage() {
  // getAppSettings first, and alone: it lazily seeds the "Default" profile, so
  // listing profiles beside it would race the seed and render an empty card on
  // the very first load.
  const settings = await getAppSettings()
  const [models, profiles, followerCounts] = await Promise.all([
    listModels(),
    listModelProfiles(),
    countProfileFollowers(),
  ])

  return (
    <SettingsView
      settings={settings}
      models={models}
      profiles={profiles}
      followerCounts={followerCounts}
    />
  )
}
