import SwiftUI

/// A story's actions, as its context menu lists them.
struct StoryMenuItems: View {
    let onOpen: () -> Void
    let onOpenLorebook: () -> Void
    let onRename: () -> Void
    let onDuplicate: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Button("Open", systemImage: "book", action: onOpen)
        Button("Open Lorebook", systemImage: "book.closed", action: onOpenLorebook)
        Divider()
        Button("Rename…", systemImage: "pencil", action: onRename)
        Button("Duplicate", systemImage: "plus.square.on.square", action: onDuplicate)
        Divider()
        Button("Delete…", systemImage: "trash", role: .destructive, action: onDelete)
    }
}
