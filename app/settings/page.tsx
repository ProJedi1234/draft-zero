import type { Metadata } from "next"

import { SettingsView } from "@/components/settings-view"
import { getAppSettings } from "@/lib/db/queries"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPage() {
  const settings = await getAppSettings()

  return <SettingsView settings={settings} />
}
