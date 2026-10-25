import { storyFeatures, type StoryFeatures } from "@/lib/services/world.schema"

/** Old stories and invalid stored flags both default to every feature off. */
export function parseStoryFeatures(json: string | null): StoryFeatures {
  if (!json) return {}
  try {
    const parsed = storyFeatures.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}
