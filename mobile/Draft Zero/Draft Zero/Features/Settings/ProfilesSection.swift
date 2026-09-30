import SwiftUI

/// The named bundles stories follow: ordered, starred default first among
/// equals, each summarised in a line. Every change goes through the store,
/// which brings the fresh list back to every device.
struct ProfilesSection: View {
    let store: SettingsStore
    let models: [OpenRouterModel]
    /// The effective app-wide policy, for each row's retention mark.
    let requireZdr: Bool
    @Binding var editorTarget: ProfileEditorTarget?

    var body: some View {
        Section {
            if store.profiles.isEmpty {
                Text("No profiles yet. Create one to give new stories a starting point.")
                    .foregroundStyle(.secondary)
            }
            ForEach(store.profiles) { profile in
                ProfileRow(
                    profile: profile,
                    summary: SettingsSummary.lineWithPrice(profile.settings, models: models),
                    followers: store.followers(of: profile.id),
                    isDefault: profile.id == store.defaultProfileId,
                    zdr: isRetentionFree(profile),
                    onEdit: { editorTarget = ProfileEditorTarget(mode: .edit, profile: profile) },
                    onDuplicate: { editorTarget = ProfileEditorTarget(mode: .duplicate, profile: profile) },
                    onMakeDefault: { store.makeDefault(profile) },
                    onDelete: { store.delete(profile) }
                )
            }
            .onMove(perform: store.moveProfiles)
            Button("New Profile…", systemImage: "plus", action: createProfile)
        } header: {
            Text("Model profiles")
        } footer: {
            Text("A named model, provider, thinking level and sampling set. Stories follow one and track every change to it. New stories start from the starred default.")
        }
    }

    /// Effective, not stored: a profile saying false is still under the app
    /// floor and under its model group's account setting.
    private func isRetentionFree(_ profile: ModelProfile) -> Bool {
        profile.settings.zdr || requireZdr || store.policies.enforces(modelId: profile.settings.modelId)
    }

    /// Most new profiles are a variation on the one already in use.
    private func createProfile() {
        let seed = store.profiles.first { $0.id == store.defaultProfileId } ?? store.profiles.first
        editorTarget = ProfileEditorTarget(mode: .create, profile: seed)
    }
}
