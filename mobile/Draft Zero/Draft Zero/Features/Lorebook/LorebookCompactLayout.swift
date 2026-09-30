import SwiftUI

/// iPhone and narrow iPad windows: the list, with each entry's editor pushed over it.
struct LorebookCompactLayout: View {
    @Bindable var model: LorebookModel

    var body: some View {
        LorebookListPane(model: model)
            .navigationDestination(item: $model.selectedId) { entryId in
                LorebookEditorScreen(model: model, entryId: entryId)
            }
            .onAppear(perform: useCompactLayout)
    }

    private func useCompactLayout() {
        model.usesSplitLayout = false
    }
}
