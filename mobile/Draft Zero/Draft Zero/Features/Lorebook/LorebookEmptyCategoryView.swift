import SwiftUI

/// The filter is on a category with no entries.
struct LorebookEmptyCategoryView: View {
    let model: LorebookModel
    let category: LorebookCategory

    var body: some View {
        ContentUnavailableView {
            Label("No \(category.pluralLabel)", systemImage: category.systemImage)
        } description: {
            Text("Nothing in this category yet.")
        } actions: {
            Button("New \(category.label)", systemImage: "plus", action: newEntry)
                .buttonStyle(.borderedProminent)
            Button("Show All Entries", action: showAll)
        }
    }

    private func newEntry() {
        model.isCreatingEntry = true
    }

    private func showAll() {
        model.filter = .all
    }
}
