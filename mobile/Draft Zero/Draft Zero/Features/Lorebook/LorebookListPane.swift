import SwiftUI

/// The entries, grouped by category, with their swipe and context actions.
/// Selecting a row opens its editor: beside the list, or pushed over it.
struct LorebookListPane: View {
    @Bindable var model: LorebookModel

    var body: some View {
        List(selection: $model.selectedId) {
            ForEach(model.sections) { section in
                Section {
                    ForEach(section.entries) { entry in
                        LorebookListRow(model: model, entry: entry)
                    }
                } header: {
                    LorebookSectionHeader(category: section.category, count: section.entries.count)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .overlay {
            LorebookListOverlay(model: model)
        }
        .animation(Theme.quickAnimation, value: model.order)
    }
}
