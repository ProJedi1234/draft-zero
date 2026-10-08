import SwiftUI

/// Filter, import and new-entry actions.
struct LorebookToolbar: ToolbarContent {
    let model: LorebookModel

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            LorebookFilterMenu(model: model)
            if model.isImporting {
                ProgressView()
                    .accessibilityLabel("Importing story cards")
            } else {
                Button("Import Story Cards…", systemImage: "square.and.arrow.down", action: importCards)
            }
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItem(placement: .topBarTrailing) {
            Button("New Entry", systemImage: "plus", action: newEntry)
        }
    }

    private func importCards() {
        model.isPickingCardFile = true
    }

    private func newEntry() {
        model.isCreatingEntry = true
    }
}
