import type { Metadata } from "next"

import { SettingsView } from "@/components/settings-view"
import {
  countProfileFollowers,
  getAppSettings,
  listModelProfiles,
} from "@/lib/db/queries"
import { listModels } from "@/lib/generation/models"
import {
  getImageModelPrice,
  listImageModels,
  resolveImageModelId,
} from "@/lib/images/models"

export const metadata: Metadata = {
  title: "Settings",
}

export default async function SettingsPage() {
  // getAppSettings first, and alone: it lazily seeds the "Default" profile, so
  // listing profiles beside it would race the seed and render an empty card on
  // the very first load.
  const settings = await getAppSettings()
  const [models, imageModels, profiles, followerCounts] = await Promise.all([
    listModels(),
    listImageModels(),
    listModelProfiles(),
    countProfileFollowers(),
  ])
  // Priced for the RESOLVED default — the stored id, or what null falls to —
  // so the card's footnote matches what a fresh story would actually pay.
  const defaultImagePrice = await getImageModelPrice(
    await resolveImageModelId(null, settings.requireZdr)
  )

  return (
    <SettingsView
      settings={settings}
      models={models}
      imageModels={imageModels}
      defaultImagePrice={defaultImagePrice}
      profiles={profiles}
      followerCounts={followerCounts}
    />
  )
}
