import SwiftUI

/// First run: nothing in the library yet, and the two ways to fill it.
struct LibraryEmptyView: View {
    let isCreating: Bool
    let onNewStory: () -> Void
    let onImport: (ImportKind) -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Write Your First Story", systemImage: "text.book.closed")
        } description: {
            Text("Start a draft and the library builds itself, or bring one in from NovelAI or AI Dungeon.")
        } actions: {
            Button("New Story", systemImage: "square.and.pencil", action: onNewStory)
                .buttonStyle(.borderedProminent)
                .disabled(isCreating)
            ImportMenu(onPick: onImport)
                .buttonStyle(.bordered)
        }
    }
}
