import SwiftUI

/// What runs the story: the profile it follows, or in Custom mode its own
/// model, endpoint, thinking, retention and sliders; then the image model,
/// which no profile carries.
struct InspectorModelSection: View {
    let model: InspectorModel

    @Environment(AppModel.self) private var app
    @Environment(\.inspectorIsSheet) private var isSheet
    @AppStorage("inspectorOpen") private var inspectorOpen = false
    @State private var isNamingProfile = false
    @State private var profileName = ""

    var body: some View {
        let settings = model.settings
        let workspace = model.workspace

        Form {
            InspectorProfileSection(settings: settings, workspace: workspace, manageProfiles: manageProfiles)
            if settings.isCustom {
                Section {
                    ModelChoiceRows(
                        models: workspace.models,
                        modelId: settings.modelId,
                        providerTag: settings.providerTag,
                        thinking: Bindable(settings).thinking,
                        zdr: Bindable(settings).zdr,
                        requireZdr: workspace.requireZdr,
                        policies: settings.policies,
                        endpoints: settings.endpoints,
                        onModelChange: chooseModel,
                        onProviderChange: settings.chooseProvider
                    )
                } header: {
                    Text("Model")
                }
                InspectorSamplingSection(settings: settings)
                InspectorCustomActionsSection(settings: settings, saveAsProfile: startNamingProfile)
            }
            Section {
                ImageModelPickerRow(
                    title: "Image model",
                    models: workspace.imageModels,
                    selection: model.imageModel.value,
                    fallback: .appDefault(workspace.defaultImageModelId.isEmpty ? nil : workspace.defaultImageModelId),
                    price: workspace.imageModelPrice,
                    zdr: settings.effectiveZdr,
                    onSelect: model.chooseImageModel
                )
            } header: {
                Text("Pictures")
            } footer: {
                Text("Not part of a profile, so a story that follows one still chooses what it draws with.")
            }
        }
        .alert("Save as Profile", isPresented: $isNamingProfile) {
            TextField("Name", text: $profileName, prompt: Text("Quality"))
            Button("Save", action: saveProfile)
                .disabled(profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Cancel", role: .cancel, action: cancelNaming)
        } message: {
            Text("Keeps this story's settings as a named profile. The story follows it from now on, and so can any other.")
        }
    }

    private func chooseModel(_ modelId: String?) {
        guard let modelId else { return }
        model.settings.chooseModel(modelId)
    }

    private func startNamingProfile() {
        profileName = ""
        isNamingProfile = true
    }

    private func cancelNaming() {
        profileName = ""
    }

    private func saveProfile() {
        let name = profileName
        profileName = ""
        Task { await model.settings.saveAsProfile(named: name) }
    }

    /// Profiles are edited in Settings; the phone's sheet would cover that tab.
    private func manageProfiles() {
        if isSheet { inspectorOpen = false }
        app.selectedTab = .settings
    }
}
