import type { Metadata } from "next"

import { SettingsView } from "@/components/settings-view"
import { getAppSettings } from "@/lib/db/queries"
import { listModels } from "@/lib/generation/models"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPage() {
  const [settings, models] = await Promise.all([getAppSettings(), listModels()])

  return <SettingsView settings={settings} models={models} />
}
