import SwiftUI

/// Every setting as one grouped form. The server section always shows, so a
/// dead server can still be changed; the rest waits for the payload.
struct SettingsForm: View {
    let store: SettingsStore
    @Binding var editorTarget: ProfileEditorTarget?
    let retry: () -> Void

    var body: some View {
        Form {
            ServerSection()
                .id(SettingsSectionID.server)
            OpenRouterSection()
                .id(SettingsSectionID.openRouter)
            if let payload = store.payload, let editors = store.editors {
                let requireZdr = editors.requireZdr.value
                ProfilesSection(
                    store: store,
                    models: payload.models,
                    requireZdr: requireZdr,
                    editorTarget: $editorTarget
                )
                .id(SettingsSectionID.profiles)
                GenerationDefaultsSection(editor: editors.defaults)
                    .id(SettingsSectionID.defaults)
                PrivacySection(editor: editors.requireZdr, policies: store.policies)
                    .id(SettingsSectionID.privacy)
                SummarizerSection(
                    editor: editors.summarizer,
                    models: payload.models,
                    requireZdr: requireZdr,
                    policies: store.policies,
                    defaultContextWindow: editors.defaults.value.contextWindow
                )
                .id(SettingsSectionID.summarizer)
                AtmosphereSection(
                    editor: editors.atmosphere,
                    models: payload.models,
                    requireZdr: requireZdr,
                    policies: store.policies
                )
                .id(SettingsSectionID.atmosphere)
                ImageGenerationSection(
                    model: editors.defaultImageModel,
                    context: editors.imageContext,
                    imageModels: payload.imageModels,
                    requireZdr: requireZdr,
                    pricedModelId: payload.settings.defaultImageModelId,
                    price: payload.defaultImagePrice
                )
                .id(SettingsSectionID.images)
            } else {
                SettingsLoadingSection(error: store.loadError, retry: retry)
            }
            AboutSection()
                .id(SettingsSectionID.about)
        }
        .sheet(item: $editorTarget) { target in
            if let payload = store.payload, let editors = store.editors {
                ProfileEditorSheet(
                    target: target,
                    models: payload.models,
                    defaults: editors.defaults.value,
                    requireZdr: editors.requireZdr.value,
                    policies: store.policies,
                    isDefault: target.mode == .edit && target.profile?.id == store.defaultProfileId,
                    followers: target.mode == .edit ? target.profile.map { store.followers(of: $0.id) } ?? 0 : 0
                ) { draft, settings in
                    try await store.save(draft, settings: settings, target: target)
                }
            }
        }
    }
}
