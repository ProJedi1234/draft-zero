import SwiftUI

/// An entry's editor as its own page, pushed over the list on compact widths.
struct LorebookEditorScreen: View {
    let model: LorebookModel
    let entryId: String

    @Environment(LibraryStore.self) private var library
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let tint = library.story(model.storyId)?.tint ?? .none
        Group {
            if let editor = model.editors[entryId] {
                LorebookEditorForm(model: model, editor: editor)
                    .navigationTitle(editor.draft.hasBlankName ? "Untitled Entry" : editor.draft.name)
                    .navigationSubtitle(editor.statusLine)
            } else {
                ContentUnavailableView(
                    "Entry Unavailable",
                    systemImage: "book.closed",
                    description: Text("This entry is no longer in the lorebook.")
                )
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .background {
            StoryAmbientBackground(tint: LorebookTint.wash(tint))
        }
        .tint(LorebookTint.accent(tint, scheme: colorScheme))
        .onAppear(perform: model.surfaceAppeared)
        .onDisappear(perform: model.surfaceDisappeared)
    }
}
