import SwiftUI

/// Regular width: the list beside the selected entry's editor, as the web lays
/// it out from `md` up. A hand-built split, because this screen already lives
/// inside the library's navigation stack. Until there is an entry to edit, the
/// list's loading, error and empty states get the whole width.
struct LorebookSplitLayout: View {
    let model: LorebookModel

    var body: some View {
        HStack(spacing: 0) {
            if model.entries.isEmpty {
                LorebookListPane(model: model)
            } else {
                LorebookListPane(model: model)
                    .containerRelativeFrame(.horizontal) { width, _ in
                        min(max(width * 0.36, 320), 420)
                    }
                Divider()
                    .ignoresSafeArea(edges: .bottom)
                LorebookEditorPane(model: model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear(perform: useSplitLayout)
        .onChange(of: model.order) {
            model.selectFirstIfNeeded()
        }
    }

    private func useSplitLayout() {
        model.usesSplitLayout = true
        model.selectFirstIfNeeded()
    }
}
