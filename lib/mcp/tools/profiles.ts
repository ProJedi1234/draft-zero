// lib/mcp/tools/profiles.ts — profiles + save_profile + delete_profile.
//
// Model profiles are global, named bundles of generation settings that stories
// follow. These tools call lib/services/profiles.ts, the same service behind
// the settings page, so every device hears a write the way it hears the UI's.
// Profile writes are not in the story op journal, so none of them is undoable.
import { z } from "zod"

import {
  countProfileFollowers,
  getAppSettings,
  listModelProfiles,
} from "@/lib/db/queries"
import {
  loadModelCatalog,
  lookupModel,
  type ModelCatalog,
} from "@/lib/generation/models"
import {
  ToolInputError,
  line,
  plural,
  runTool,
  structured,
  type RegisterTool,
} from "@/lib/mcp/helpers"
import {
  checkModel,
  findProfile,
  modelInfo,
  modelInfoSchema,
  passedKeys,
  priceLine,
  profileSettingsFields,
  toSettingsPatch,
} from "@/lib/mcp/model-settings"
import { NO_ORIGIN } from "@/lib/services/context"
import {
  createProfile,
  deleteProfile,
  setDefaultProfile,
  updateProfile,
} from "@/lib/services/profiles"

/** The catalog entry for a model the call did not ask to change, if listed. */
function listedModel(catalog: ModelCatalog, modelId: string) {
  const lookup = lookupModel(catalog, modelId)
  return lookup.status === "found" ? lookup.model : null
}

const sliders = {
  temperature: z.number(),
  topP: z.number(),
  contextWindow: z.number().int(),
  loreBudget: z.number(),
  frequencyPenalty: z.number(),
  presencePenalty: z.number(),
}

/* -------------------------------- profiles ------------------------------- */

const listOutput = z.object({
  profiles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isDefault: z.boolean().describe("New stories start from this profile."),
      followers: z
        .number()
        .int()
        .describe("Stories following it. Editing it changes all of them."),
      model: z.string(),
      modelInfo: modelInfoSchema.describe(
        "From the live catalog; null when the model is not in it or it could not be read."
      ),
      modelListed: z
        .boolean()
        .nullable()
        .describe(
          "False when the live catalog no longer lists the model; null when the catalog could not be read."
        ),
      thinking: z.string(),
      providerTag: z.string().nullable(),
      zdr: z.boolean(),
      overrides: z
        .object({
          temperature: sliders.temperature.nullable(),
          topP: sliders.topP.nullable(),
          contextWindow: sliders.contextWindow.nullable(),
          loreBudget: sliders.loreBudget.nullable(),
          frequencyPenalty: sliders.frequencyPenalty.nullable(),
          presencePenalty: sliders.presencePenalty.nullable(),
        })
        .describe("This profile's slider values; null inherits `defaults`."),
    })
  ),
  defaults: z
    .object(sliders)
    .describe("App-wide slider values every null override inherits."),
  requireZdr: z
    .boolean()
    .describe(
      "App-wide zero-data-retention policy, applied on top of every profile and story."
    ),
})

export const registerProfiles: RegisterTool = (server) => {
  server.registerTool(
    "profiles",
    {
      title: "Model profiles",
      description:
        "Every model profile: its model with live pricing, thinking level, slider overrides, how many stories follow it, and which is the default. Read this before save_profile, delete_profile, or switching a story's profile with update_story.",
      inputSchema: z.object({}),
      outputSchema: listOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      runTool("profiles", async () => {
        // First and alone: on a fresh database this read seeds the default
        // profile, and a list taken alongside it would miss that profile.
        const settings = await getAppSettings()
        const [profiles, followers, catalog] = await Promise.all([
          listModelProfiles(),
          countProfileFollowers(),
          loadModelCatalog(),
        ])

        const rows = profiles.map((profile) => {
          const { modelId, thinking, providerTag, zdr, ...overrides } =
            profile.settings
          const found = lookupModel(catalog, modelId)
          return {
            id: profile.id,
            name: profile.name,
            isDefault: profile.id === settings.defaultProfileId,
            followers: followers[profile.id] ?? 0,
            model: modelId,
            modelInfo: modelInfo(found.status === "found" ? found.model : null),
            modelListed:
              found.status === "unverifiable" ? null : found.status === "found",
            thinking,
            providerTag,
            zdr,
            overrides,
          }
        })
        const fallback = rows.find((row) => row.isDefault)

        return structured(
          line(
            plural(rows.length, "profile"),
            fallback && `default "${fallback.name}"`
          ),
          {
            profiles: rows,
            defaults: settings.defaultGeneration,
            requireZdr: settings.requireZdr,
          }
        )
      })
  )
}

/* ------------------------------ save_profile ----------------------------- */

const saveInput = z.object({
  profile: z
    .string()
    .optional()
    .describe(
      "Id or name of the profile to edit. Omit it to create a new profile."
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Required when creating. Renames the profile when editing."),
  ...profileSettingsFields,
  makeDefault: z
    .literal(true)
    .optional()
    .describe("Make this the profile new stories start from."),
})

const saveOutput = z.object({
  id: z.string(),
  name: z.string(),
  created: z.boolean(),
  changed: z.array(z.string()).describe("Fields this call set."),
  followers: z
    .number()
    .int()
    .describe("Stories following it, all of which the edit reached."),
  isDefault: z.boolean(),
  model: z.string(),
  modelInfo: modelInfoSchema,
})

export const registerSaveProfile: RegisterTool = (server) => {
  server.registerTool(
    "save_profile",
    {
      title: "Save profile",
      description:
        "Create a model profile, or edit one by passing `profile`. Only the fields you pass change; a slider set to null inherits the app-wide default. An edit reaches every story following the profile at once. Model ids are checked against the live catalog. Not undoable.",
      inputSchema: saveInput,
      outputSchema: saveOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("save_profile", async () => {
        const { profile: ref, name, makeDefault, ...fields } = args
        const changed = passedKeys({ name, ...fields, makeDefault })
        const patch = toSettingsPatch(fields)
        const catalog = await loadModelCatalog()

        if (ref === undefined) {
          if (name === undefined || patch.modelId === undefined) {
            throw new ToolInputError(
              "A new profile needs a name and a model. To edit an existing one, pass profile."
            )
          }
          const model = checkModel(catalog, patch.modelId)
          const created = await createProfile(
            {
              name,
              settings: {
                modelId: patch.modelId,
                thinking: patch.thinking ?? "off",
                providerTag: patch.providerTag ?? null,
                zdr: patch.zdr ?? false,
                temperature: patch.temperature ?? null,
                topP: patch.topP ?? null,
                contextWindow: patch.contextWindow ?? null,
                loreBudget: patch.loreBudget ?? null,
                frequencyPenalty: patch.frequencyPenalty ?? null,
                presencePenalty: patch.presencePenalty ?? null,
              },
            },
            NO_ORIGIN
          )
          if (!created.ok) throw new ToolInputError(created.error)
          const { id } = created.data
          if (makeDefault) await makeDefaultOrThrow(id)

          return structured(
            line(
              `created profile "${name}"`,
              patch.modelId,
              priceLine(model),
              makeDefault && "now the default"
            ),
            {
              id,
              name,
              created: true,
              changed,
              followers: 0,
              isDefault: makeDefault === true,
              model: patch.modelId,
              modelInfo: modelInfo(model),
            }
          )
        }

        if (changed.length === 0) {
          throw new ToolInputError(
            "Nothing to change. Pass a name, a model, a setting or makeDefault."
          )
        }
        const target = findProfile(await listModelProfiles(), ref)
        const modelId = patch.modelId ?? target.settings.modelId
        const model =
          patch.modelId !== undefined
            ? checkModel(catalog, patch.modelId)
            : listedModel(catalog, modelId)

        const updated = await updateProfile(
          { id: target.id, patch: { name, settings: patch } },
          NO_ORIGIN
        )
        if (!updated.ok) throw new ToolInputError(updated.error)
        if (makeDefault) await makeDefaultOrThrow(target.id)

        const [followers, settings] = await Promise.all([
          countProfileFollowers(),
          getAppSettings(),
        ])
        const reached = followers[target.id] ?? 0
        const finalName = name ?? target.name

        return structured(
          line(
            `updated profile "${finalName}"`,
            changed.join(", "),
            reached > 0 && `reached ${plural(reached, "story", "stories")}`
          ),
          {
            id: target.id,
            name: finalName,
            created: false,
            changed,
            followers: reached,
            isDefault: settings.defaultProfileId === target.id,
            model: modelId,
            modelInfo: modelInfo(model),
          }
        )
      })
  )
}

async function makeDefaultOrThrow(id: string): Promise<void> {
  const result = await setDefaultProfile({ id }, NO_ORIGIN)
  if (!result.ok) throw new ToolInputError(result.error)
}

/* ----------------------------- delete_profile ---------------------------- */

const deleteInput = z.object({
  profile: z.string().describe("Id or name of the profile to delete."),
})

const deleteOutput = z.object({
  id: z.string(),
  name: z.string(),
  detached: z
    .number()
    .int()
    .describe(
      "Stories that followed it and are now Custom, with the same settings."
    ),
})

export const registerDeleteProfile: RegisterTool = (server) => {
  server.registerTool(
    "delete_profile",
    {
      title: "Delete profile",
      description:
        "Permanently delete a model profile. Stories that followed it switch to Custom with the exact settings they had, so none of them changes model. The default profile cannot be deleted. Not undoable.",
      inputSchema: deleteInput,
      outputSchema: deleteOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("delete_profile", async () => {
        const [profiles, followers] = await Promise.all([
          listModelProfiles(),
          countProfileFollowers(),
        ])
        const target = findProfile(profiles, args.profile)
        const detached = followers[target.id] ?? 0

        const result = await deleteProfile({ id: target.id }, NO_ORIGIN)
        if (!result.ok) {
          throw new ToolInputError(
            result.code === "conflict"
              ? `"${target.name}" is the default profile. Make another one the default with save_profile's makeDefault first.`
              : result.error
          )
        }

        return structured(
          line(
            `deleted profile "${target.name}"`,
            detached > 0 &&
              `${plural(detached, "story", "stories")} now Custom with the same settings`
          ),
          { id: target.id, name: target.name, detached }
        )
      })
  )
}
