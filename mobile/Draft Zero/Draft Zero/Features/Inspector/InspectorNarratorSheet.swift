import SwiftUI

/// The story's narrator prompt. Empty means no override: the story follows the
/// built-in prompt as it changes, shown greyed out in the empty field, rather
/// than freezing a copy of today's text. Edited as a draft and saved once.
struct InspectorNarratorSheet: View {
    let model: InspectorModel

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var original: String
    @State private var isSaving = false
    @FocusState private var isFocused: Bool

    init(model: InspectorModel) {
        self.model = model
        let saved = model.workspace.story?.systemPrompt ?? ""
        _text = State(initialValue: saved)
        _original = State(initialValue: saved)
    }

    private var isOverride: Bool { NarratorPrompt.isOverride(text) }
    private var hasChanges: Bool { text != original }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Narrator prompt", text: $text, prompt: Text(NarratorPrompt.builtIn), axis: .vertical)
                        .font(Theme.machineFont)
                        .lineLimit(10...)
                        .focused($isFocused)
                        .disabled(isSaving)
                } footer: {
                    Text(isOverride
                        ? "This story is told with its own prompt."
                        : "Empty uses the built-in prompt, shown greyed out. Type to give this story its own.")
                }
                Section {
                    if isOverride {
                        Button("Reset to Default", systemImage: "arrow.uturn.backward", action: resetToDefault)
                    } else {
                        Button("Start from the Built-in Prompt", systemImage: "doc.on.doc", action: copyBuiltIn)
                    }
                } footer: {
                    Text(isOverride
                        ? "Clears this story's prompt. Save to go back to the built-in one."
                        : "A copy stops following updates to the built-in prompt.")
                }
                .disabled(isSaving)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Narrator")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: close)
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: save)
                            .disabled(!hasChanges)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving || hasChanges)
        }
    }

    private func resetToDefault() {
        text = ""
    }

    private func copyBuiltIn() {
        text = NarratorPrompt.builtIn
        isFocused = true
    }

    private func close() {
        dismiss()
    }

    private func save() {
        isSaving = true
        Task {
            let saved = await model.saveNarrator(text)
            isSaving = false
            if saved { dismiss() }
        }
    }
}
