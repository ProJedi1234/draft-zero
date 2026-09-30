import SwiftUI

/// Names the entry open in the split layout's editor and says whether it has saved.
struct LorebookEditorHeader: View {
    let editor: LorebookEntryEditor

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: editor.draft.category.systemImage)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(editor.draft.hasBlankName ? "Untitled Entry" : editor.draft.name)
                .font(.headline)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 12)
            LorebookSaveStatusLabel(editor: editor)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }
}
