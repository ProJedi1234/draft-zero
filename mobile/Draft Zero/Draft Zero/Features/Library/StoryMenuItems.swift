import SwiftUI

/// A story's actions, as its context menu lists them.
struct StoryMenuItems: View {
    let onOpen: () -> Void
    let onOpenLorebook: () -> Void
    let onRename: () -> Void
    let onDuplicate: (DuplicateScope) -> Void
    let onDelete: () -> Void

    var body: some View {
        Button("Open", systemImage: "book", action: onOpen)
        Button("Open Lorebook", systemImage: "book.closed", action: onOpenLorebook)
        Divider()
        Button("Rename…", systemImage: "pencil", action: onRename)
        Button("Duplicate", systemImage: "plus.square.on.square") { onDuplicate(.full) }
        Button("Duplicate from Opening", systemImage: "arrow.counterclockwise") { onDuplicate(.opening) }
        Divider()
        Button("Delete…", systemImage: "trash", role: .destructive, action: onDelete)
    }
}
