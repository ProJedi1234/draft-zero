import SwiftUI

/// Create, edit or duplicate a profile with the same controls a story's
/// inspector uses, plus a name. A draft: nothing is written until Save, and
/// the footer says how many stories a save will move.
struct ProfileEditorSheet: View {
    let target: ProfileEditorTarget
    let models: [OpenRouterModel]
    /// The global values an inheriting slider shows and generates under.
    let defaults: GenerationDefaults
    /// The app-wide floor; a profile can add to it, never lower it.
    let requireZdr: Bool
    let policies: AccountZdrPolicies
    let isDefault: Bool
    let followers: Int
    let onSave: (ProfileDraft, ProfileSettings) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProfileDraft
    @State private var original: ProfileDraft
    @State private var endpoints = ModelEndpointsLoader()
    @State private var isSaving = false
    @State private var error: String?
    @State private var isConfirmingDiscard = false
    @FocusState private var isNameFocused: Bool

    init(
        target: ProfileEditorTarget,
        models: [OpenRouterModel],
        defaults: GenerationDefaults,
        requireZdr: Bool,
        policies: AccountZdrPolicies,
        isDefault: Bool,
        followers: Int,
        onSave: @escaping (ProfileDraft, ProfileSettings) async throws -> Void
    ) {
        self.target = target
        self.models = models
        self.defaults = defaults
        self.requireZdr = requireZdr
        self.policies = policies
        self.isDefault = isDefault
        self.followers = followers
        self.onSave = onSave
        let seed = ProfileDraft(target: target, models: models)
        _draft = State(initialValue: seed)
        _original = State(initialValue: seed)
    }

    /// The window a pinned endpoint allows, else the model's; zero clamps nothing.
    private var contextLength: Int {
        let modelId = draft.settings.modelId
        let zdr = draft.settings.zdr || requireZdr || policies.enforces(modelId: modelId)
        return EndpointRouting.contextLength(
            endpoints: endpoints.endpoints(for: modelId),
            tag: draft.settings.providerTag,
            zdr: zdr,
            model: models.first { $0.id == modelId }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Name", text: $draft.name, prompt: Text("Quality"))
                        .submitLabel(.done)
                        .focused($isNameFocused)
                }
                Section {
                    ModelChoiceRows(
                        models: models,
                        modelId: draft.settings.modelId,
                        providerTag: draft.settings.providerTag,
                        thinking: $draft.settings.thinking,
                        zdr: $draft.settings.zdr,
                        requireZdr: requireZdr,
                        policies: policies,
                        endpoints: endpoints,
                        onModelChange: chooseModel,
                        onProviderChange: chooseProvider
                    )
                } header: {
                    Text("Model")
                }
                ProfileSamplingSection(settings: $draft.settings, defaults: defaults, contextLength: contextLength)
                ProfileDefaultSection(isDefault: isDefault, makeDefault: $draft.makeDefault, consequence: consequence)
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(target.mode.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: cancel)
                        .disabled(isSaving)
                        .confirmationDialog("Discard your changes?", isPresented: $isConfirmingDiscard, titleVisibility: .visible) {
                            Button("Discard Changes", role: .destructive, action: discard)
                            Button("Keep Editing", role: .cancel) {}
                        }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: save)
                            .disabled(draft.trimmedName.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving || draft != original)
            .onAppear(perform: focusNameIfNew)
        }
    }

    private var consequence: String? {
        target.mode == .edit ? ProfileText.editConsequence(followers: followers) : nil
    }

    private func chooseModel(_ modelId: String?) {
        guard let modelId else { return }
        draft.chooseModel(modelId, in: models)
    }

    private func chooseProvider(_ tag: String?) {
        let modelId = draft.settings.modelId
        let zdr = draft.settings.zdr || requireZdr || policies.enforces(modelId: modelId)
        let window = EndpointRouting.contextLength(
            endpoints: endpoints.endpoints(for: modelId),
            tag: tag,
            zdr: zdr,
            model: models.first { $0.id == modelId }
        )
        draft.chooseProvider(tag, contextLength: window)
    }

    private func cancel() {
        if draft == original {
            dismiss()
        } else {
            isConfirmingDiscard = true
        }
    }

    private func discard() {
        dismiss()
    }

    /// A new profile has nothing until it has a name, so start there.
    private func focusNameIfNew() {
        if target.mode != .edit { isNameFocused = true }
    }

    private func save() {
        if let problem = draft.validationMessage {
            error = problem
            return
        }
        let settings = draft.settingsForSave(contextLength: contextLength)
        isSaving = true
        error = nil
        Task {
            do {
                try await onSave(draft, settings)
                dismiss()
            } catch is CancellationError {
                isSaving = false
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't save the profile."
                isSaving = false
            }
        }
    }
}
