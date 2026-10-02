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

        HStack(spacing: 8) {
            Button(action: showModelSettings) {
                InspectorModelLine(
                    profileName: settings.followedProfile?.name ?? "Custom",
                    parts: parts,
                    zdr: settings.effectiveZdr || settings.accountEnforcesZdr
                )
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the model settings.")

            InspectorContextMeter(loader: model.nextContext, isStale: settings.isSwitchingProfile)
        }
    }

    private func showModelSettings() {
        section = .model
    }
}
