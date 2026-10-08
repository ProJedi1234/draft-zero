import SwiftUI

/// A new entry's fields. The id is minted when the sheet opens, so trying
/// again after a lost reply lands on the row the first attempt wrote.
struct LorebookNewEntrySheet: View {
    let model: LorebookModel

    @State private var draft: NewLorebookEntry
    @State private var entryId = RandomID.make()
    @State private var isSaving = false
    @State private var errorMessage: String?

    @Environment(\.dismiss) private var dismiss

    init(model: LorebookModel, category: LorebookCategory) {
        self.model = model
        _draft = State(initialValue: NewLorebookEntry(name: "", category: category, priority: 50))
    }

    var body: some View {
        NavigationStack {
            Form {
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }
                LorebookEntryFields(draft: $draft, nameError: nil, focusesName: true)
            }
            .navigationTitle("New Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: cancel)
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                            .accessibilityLabel("Creating entry")
                    } else {
                        Button("Create", role: .confirm, action: create)
                            .disabled(draft.hasBlankName)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving || draft != NewLorebookEntry(name: "", category: draft.category, priority: 50))
        }
    }

    private func cancel() {
        dismiss()
    }

    private func create() {
        isSaving = true
        errorMessage = nil
        Task {
            do {
                try await model.create(draft, id: entryId)
                dismiss()
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? "Couldn't create this entry."
                isSaving = false
            }
        }
    }
}
