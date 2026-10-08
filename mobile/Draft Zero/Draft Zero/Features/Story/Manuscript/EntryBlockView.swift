import SwiftUI

/// One passage. Its actions live in a context menu, and the newest passage
/// also carries its take switcher and Retry inline, since those are the moves
/// a writer makes on it most.
struct EntryBlockView: View {
    let entry: StoryEntry
    let isLast: Bool
    let busy: Bool
    let workspace: StoryWorkspace

    @State private var editing = false
    @State private var showingContext = false
    @State private var confirmingDelete = false
    @State private var confirmingRewind = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if entry.source == .user {
                ProseText(text: entry.text)
                    .modifier(PlayerTurnMarker(tint: workspace.tint))
            } else {
                ProseText(text: entry.text)
            }
            if isLast && entry.isGenerated {
                LastPassageBar(entry: entry, busy: busy, workspace: workspace, showContext: showContext)
            }
        }
        .padding(.vertical, 8)
        .contentShape(.rect)
        .contextMenu {
            EntryMenu(
                entry: entry,
                isLast: isLast,
                busy: busy,
                edit: { editing = true },
                showContext: showContext,
                rewind: { confirmingRewind = true },
                delete: { confirmingDelete = true },
                retry: { workspace.generation.retryLast() }
            )
        }
        .sheet(isPresented: $editing) {
            PassageEditorSheet(entry: entry, workspace: workspace)
        }
        .sheet(isPresented: $showingContext) {
            ContextViewerSheet(entry: entry, workspace: workspace)
        }
        .confirmationDialog("Delete this passage?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete Passage", role: .destructive, action: delete)
        } message: {
            Text("You can undo this from the composer.")
        }
        .confirmationDialog("Rewind to here?", isPresented: $confirmingRewind, titleVisibility: .visible) {
            Button("Remove \(following) \(following == 1 ? "Passage" : "Passages")", role: .destructive, action: rewind)
        } message: {
            Text("Everything after this passage is set aside as one step you can undo.")
        }
    }

    private var following: Int { workspace.followingCount(after: entry) }

    private func showContext() {
        showingContext = true
    }

    private func delete() {
        Task { await workspace.deleteEntry(entry) }
    }

    private func rewind() {
        Task { await workspace.rewind(to: entry) }
    }
}
