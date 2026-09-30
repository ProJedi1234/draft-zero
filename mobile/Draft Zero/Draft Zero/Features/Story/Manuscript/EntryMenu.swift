import SwiftUI

/// A passage's actions. Only the newest passage can be retried; earlier ones
/// offer Rewind instead, because everything after them was written against them.
struct EntryMenu: View {
    let entry: StoryEntry
    let isLast: Bool
    let busy: Bool
    let edit: () -> Void
    let showContext: () -> Void
    let rewind: () -> Void
    let delete: () -> Void
    let retry: () -> Void

    var body: some View {
        Button("Copy", systemImage: "doc.on.doc") {
            UIPasteboard.general.string = entry.text
        }
        Button(editLabel, systemImage: "pencil", action: edit)
            .disabled(busy)
        if entry.isGenerated {
            Button("What It Was Shown", systemImage: "text.magnifyingglass", action: showContext)
        }
        if isLast {
            if entry.isGenerated {
                Button("Retry", systemImage: "arrow.clockwise", action: retry)
                    .disabled(busy)
            }
        } else {
            Button("Rewind to Here", systemImage: "arrow.uturn.backward", action: rewind)
                .disabled(busy)
        }
        Divider()
        Button("Delete Passage", systemImage: "trash", role: .destructive, action: delete)
            .disabled(busy)
    }

    private var editLabel: String {
        guard let kind = entry.actionKind, entry.inputText != nil else { return "Edit Passage" }
        return "Edit Your \(kind.label)"
    }
}
