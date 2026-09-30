import SwiftUI

/// The two facts wanted whatever segment is showing: which model is about to
/// run, and how full its window already is. Readouts, so they are pinned
/// chrome rather than rows that scroll away while the writer changes them.
struct InspectorStatusStrip: View {
    let model: InspectorModel
    @Binding var section: InspectorSection

    var body: some View {
        let settings = model.settings
        let identity = settings.identity
        let parts = SettingsSummary.parts(
            modelId: identity.modelId,
            providerTag: identity.providerTag,
            thinking: identity.thinking,
            models: model.workspace.models
        )
        let profile = settings.followedProfile

        VStack(alignment: .leading, spacing: 10) {
            Button(action: showModelSettings) {
                InspectorModelLine(
                    profileName: profile?.name ?? "Custom",
                    isDefaultProfile: profile != nil && profile?.id == model.workspace.defaultProfileId,
                    parts: parts,
                    zdr: settings.effectiveZdr || settings.accountEnforcesZdr
                )
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the model settings.")

            Divider()

            InspectorContextMeter(loader: model.nextContext, isStale: settings.isSwitchingProfile)
        }
        .padding(12)
        .background(.background.secondary, in: .rect(cornerRadius: Theme.cornerRadius))
    }

    private func showModelSettings() {
        section = .model
    }
}
