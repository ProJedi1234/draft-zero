import SwiftUI

/// A lorebook with no entries yet: what entries are for, and the two ways to add some.
struct LorebookEmptyView: View {
    let model: LorebookModel

    var body: some View {
        ContentUnavailableView {
            Label("No Entries Yet", systemImage: "book.closed")
        } description: {
            Text("Entries tell the model about the people, places and ideas in this story. Each one joins the context when one of its keys appears in recent text.")
        } actions: {
            Button("New Entry", systemImage: "plus", action: newEntry)
                .buttonStyle(.borderedProminent)
            Button("Import Story Cards…", systemImage: "square.and.arrow.down", action: importCards)
        }
        .frame(maxWidth: 560)
    }

    private func newEntry() {
        model.isCreatingEntry = true
    }

    private func importCards() {
        model.isPickingCardFile = true
    }
}
