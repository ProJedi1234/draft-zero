import SwiftUI

/// Which profile the story follows. Following one, this card is the whole
/// segment's text settings: the bundle is global, so a knob here would be a
/// silent fork of it. Choosing Custom is the way to the story's own settings.
struct InspectorProfileSection: View {
    @Bindable var settings: StoryModelSettings
    let workspace: StoryWorkspace
    let manageProfiles: () -> Void

    var body: some View {
        let followed = settings.followedProfile

        Section {
            Menu {
                Picker("Profile", selection: $settings.profileChoice) {
                    ForEach(workspace.profiles) { profile in
                        InspectorProfileMenuItem(
                            name: profile.name,
                            detail: summary(of: profile),
                            isDefault: profile.id == workspace.defaultProfileId
                        )
                        .tag(Optional(profile.id))
                    }
                    InspectorProfileMenuItem(name: "Custom", detail: "Settings for this story only", isDefault: false)
                        .tag(String?.none)
                }
                .pickerStyle(.inline)
                Button("Manage Profiles…", systemImage: "gearshape", action: manageProfiles)
            } label: {
                InspectorProfileCard(
                    name: followed?.name ?? "Custom",
                    isDefault: followed != nil && followed?.id == workspace.defaultProfileId,
                    summary: followed.map { summary(of: $0) },
                    pricing: followed.flatMap { pricing(of: $0) },
                    basedOn: followed == nil ? settings.basedOnProfile?.name : nil,
                    zdr: settings.effectiveZdr || settings.accountEnforcesZdr
                )
            }
            .tint(.primary)
            .accessibilityLabel("Profile: \(followed?.name ?? "Custom")")
            .accessibilityHint("Chooses the profile this story follows.")
            if followed != nil {
                Button("Customize for This Story", systemImage: "slider.horizontal.3", action: customize)
            }
        } header: {
            HStack(spacing: 6) {
                Text("Profile")
                if settings.isSwitchingProfile {
                    ProgressView()
                        .controlSize(.mini)
                        .accessibilityLabel("Switching profile")
                }
            }
        } footer: {
            if let followed {
                Text("\(followed.name) is shared by every story that follows it. Customize to tune this story alone.")
            } else {
                Text("These settings belong to this story alone.")
            }
        }
    }

    private func summary(of profile: ModelProfile) -> String {
        SettingsSummary.line(
            modelId: profile.settings.modelId,
            providerTag: profile.settings.providerTag,
            thinking: profile.settings.thinking,
            models: workspace.models
        )
    }

    /// Priced against the endpoint that will actually serve it: a pinned one
    /// under the retention policy, else the model's own. A local model has a host
    /// instead of a price, as on the web's profile card.
    private func pricing(of profile: ModelProfile) -> String? {
        let modelId = profile.settings.modelId
        let model = workspace.model(modelId)
        if let model, let local = model.local {
            return SettingsSummary.localPricing(local, contextLength: model.contextLength)
        }
        let endpoint = EndpointRouting.routableEndpoint(
            settings.endpoints.endpoints(for: modelId),
            tag: profile.settings.providerTag,
            zdr: settings.effectiveZdr || settings.accountEnforcesZdr
        )
        guard let prices = endpoint?.pricing ?? model?.pricing,
              let window = endpoint?.contextLength ?? model?.contextLength else { return nil }
        return SettingsSummary.pricing(prices, contextLength: window, maxCompletionTokens: model?.maxCompletionTokens)
    }

    private func customize() {
        settings.chooseProfile(nil)
    }
}
