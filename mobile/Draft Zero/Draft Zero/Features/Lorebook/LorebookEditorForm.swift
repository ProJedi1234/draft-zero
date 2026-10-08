import SwiftUI

/// An existing entry's fields, autosaving as the writer edits them.
struct LorebookEditorForm: View {
    let model: LorebookModel
    @Bindable var editor: LorebookEntryEditor

    var body: some View {
        Form {
            if let message = editor.saveState.failureMessage {
                LorebookSaveFailureSection(message: message, retry: editor.flush)
            }
            LorebookEntryFields(draft: $editor.draft, nameError: editor.nameError)
            LorebookCascadeSection(entries: model.cascade(from: editor.entryId))
            LorebookEditorFooter(name: editor.base.name, delete: deleteEntry)
        }
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private func deleteEntry() {
        model.delete(editor.entryId)
    }
}
