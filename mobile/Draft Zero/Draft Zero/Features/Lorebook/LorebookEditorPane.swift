import SwiftUI

/// The split layout's detail: the selected entry's editor under a slim header.
struct LorebookEditorPane: View {
    let model: LorebookModel

    var body: some View {
        ZStack {
            if let entryId = model.selectedId, let editor = model.editors[entryId] {
                LorebookEditorForm(model: model, editor: editor)
                    .frame(maxWidth: Theme.readingWidth)
                    .frame(maxWidth: .infinity)
                    .safeAreaBar(edge: .top) {
                        LorebookEditorHeader(editor: editor)
                    }
                    .id(entryId)
            } else {
                ContentUnavailableView(
                    "No Entry Selected",
                    systemImage: "book.pages",
                    description: Text("Choose an entry from the list, or create a new one.")
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
