"use client"

import * as React from "react"
import {
  Copy,
  MoreHorizontal,
  PencilLine,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { DeleteProfileDialog } from "@/components/settings/delete-profile-dialog"
import {
  ProfileEditorDialog,
  type ProfileEditorTarget,
} from "@/components/settings/profile-editor-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setDefaultProfile } from "@/lib/actions/profiles"
import { settingsSummaryWithPrice } from "@/lib/settings-summary"
import {
  zdrGroupForModel,
  type AccountZdrPolicies,
  type GenerationDefaults,
  type ModelProfile,
  type OpenRouterModel,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Manage the named bundles new stories start from and stories follow.
 *
 * Nothing here is a live control: the rows render the server's list, and every
 * change goes through a dialog or the row menu, each of which ends in a
 * commitChange that brings the fresh list back to every device.
 */
export function ModelProfilesCard({
  profiles,
  models,
  defaults,
  requireZdr,
  accountPolicies,
  defaultProfileId,
  followerCounts,
}: {
  profiles: ModelProfile[]
  models: OpenRouterModel[]
  /** The app-wide retention policy, which the editor's switch sits on top of. */
  requireZdr: boolean
  /** What the OpenRouter account enforces, per model group. */
  accountPolicies: AccountZdrPolicies
  /** The shared slider values a profile's unset fields fall back to. */
  defaults: GenerationDefaults
  defaultProfileId: string | null
  /** Stories per profile id; a profile nobody follows is simply absent. */
  followerCounts: Record<string, number>
}) {
  // Target and open flag are separate so a closing dialog keeps its content —
  // and its size — for the length of the exit animation.
  const [editorTarget, setEditorTarget] =
    React.useState<ProfileEditorTarget | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ModelProfile | null>(
    null
  )
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const defaultProfile =
    profiles.find((profile) => profile.id === defaultProfileId) ?? null

  function openEditor(target: ProfileEditorTarget) {
    setEditorTarget(target)
    setEditorOpen(true)
  }

  function openDelete(profile: ModelProfile) {
    setDeleteTarget(profile)
    setDeleteOpen(true)
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Model profiles</CardTitle>
        <CardDescription>
          A named model, provider, thinking level and sampling set. Stories
          follow one and track every change to it.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            // A new profile starts from the default rather than from nothing:
            // most are a variation on the one already in use.
            onClick={() =>
              openEditor({ mode: "create", profile: defaultProfile })
            }
          >
            <Plus data-icon="inline-start" />
            New profile
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {profiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No profiles yet. Create one to give new stories a starting point.
          </p>
        ) : (
          <ul className="-mx-2 divide-y divide-border/60">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                summary={settingsSummaryWithPrice(profile.settings, models)}
                // Effective, not stored: a profile that says nothing about
                // retention is still under the app-wide policy — and under its
                // own model group's account setting, which is why the marks in
                // a list can differ between two profiles that both say false.
                zdr={
                  profile.settings.zdr ||
                  requireZdr ||
                  accountPolicies[
                    zdrGroupForModel(profile.settings.modelId)
                  ] === "enforced"
                }
                isDefault={profile.id === defaultProfileId}
                onEdit={() => openEditor({ mode: "edit", profile })}
                onDuplicate={() => openEditor({ mode: "duplicate", profile })}
                onDelete={() => openDelete(profile)}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          New stories start from the default (★) profile.
        </p>
      </CardContent>

      {editorTarget ? (
        <ProfileEditorDialog
          target={editorTarget}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          models={models}
          defaults={defaults}
          requireZdr={requireZdr}
          isDefault={
            editorTarget.mode === "edit" &&
            editorTarget.profile?.id === defaultProfileId
          }
          followerCount={
            editorTarget.mode === "edit" && editorTarget.profile
              ? (followerCounts[editorTarget.profile.id] ?? 0)
              : 0
          }
        />
      ) : null}
      {deleteTarget ? (
        <DeleteProfileDialog
          profile={deleteTarget}
          followerCount={followerCounts[deleteTarget.id] ?? 0}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      ) : null}
    </Card>
  )
}

function ProfileRow({
  profile,
  summary,
  zdr,
  isDefault,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  profile: ModelProfile
  summary: string
  /** Routed only through providers that keep nothing — shown as a mark, not a word. */
  zdr: boolean
  isDefault: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  // Dialogs open only once the menu has finished closing, so the menu's focus
  // restoration never fights the dialog's focus trap (see StoryListItem).
  const [queued, setQueued] = React.useState<(() => void) | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function handleMenuClosed(open: boolean) {
    if (open || queued === null) return
    queued()
    setQueued(null)
  }

  function handleSetDefault() {
    startTransition(async () => {
      const result = await setDefaultProfile(profile.id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`New stories start from ${profile.name}`)
    })
  }

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        {/* Always rendered, invisible when not the default: the names have to
            line up down the column. */}
        <Star
          aria-hidden
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            isDefault ? "fill-current" : "invisible"
          )}
        />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{profile.name}</span>
            {isDefault ? <span className="sr-only"> (default)</span> : null}
            {zdr ? (
              <>
                <ShieldCheck
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="sr-only">, zero data retention</span>
              </>
            ) : null}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </span>
      </button>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpenChangeComplete={handleMenuClosed}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${profile.name} actions`}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setQueued(() => onEdit)}>
            <PencilLine />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isDefault || isPending}
            onClick={handleSetDefault}
          >
            <Star />
            Set as default
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setQueued(() => onDuplicate)}>
            <Copy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={isDefault}
            onClick={() => setQueued(() => onDelete)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
          {isDefault ? (
            // The action is refused server-side too; saying why here is what
            // stops the disabled row from reading as a bug.
            <p className="px-3 pt-1 pb-2 text-xs text-muted-foreground normal-case">
              Make another profile the default first.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
