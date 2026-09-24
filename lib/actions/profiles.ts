"use server"

import { NO_ORIGIN } from "@/lib/services/context"
import * as profiles from "@/lib/services/profiles"
import type { ActionResult, ProfileSettings } from "@/lib/types"

export async function createProfile(input: {
  name: string
  settings: ProfileSettings
}): Promise<ActionResult<{ id: string }>> {
  return profiles.createProfile(input, NO_ORIGIN)
}

export async function updateProfile(
  id: string,
  patch: { name?: string; settings?: Partial<ProfileSettings> }
): Promise<ActionResult> {
  return profiles.updateProfile({ id, patch }, NO_ORIGIN)
}

export async function reorderProfiles(
  orderedIds: string[]
): Promise<ActionResult> {
  return profiles.reorderProfiles({ orderedIds }, NO_ORIGIN)
}

export async function setDefaultProfile(id: string): Promise<ActionResult> {
  return profiles.setDefaultProfile({ id }, NO_ORIGIN)
}

export async function deleteProfile(id: string): Promise<ActionResult> {
  return profiles.deleteProfile({ id }, NO_ORIGIN)
}

export async function setStoryProfile(
  storyId: string,
  profileId: string | null
): Promise<ActionResult> {
  return profiles.setStoryProfile({ storyId, profileId }, NO_ORIGIN)
}

export async function saveStoryAsProfile(
  storyId: string,
  name: string
): Promise<ActionResult<{ id: string }>> {
  return profiles.saveStoryAsProfile({ storyId, name }, NO_ORIGIN)
}
