import SwiftUI

/// What the list says when it has no rows to show: still loading, failed, empty,
/// an empty category, or a search with no matches.
struct LorebookListOverlay: View {
    let model: LorebookModel

    var body: some View {
        switch model.loadState {
        case .loading:
            if model.entries.isEmpty {
                ProgressView("Loading Lorebook…")
            }
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load the Lorebook", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again", action: model.retry)
                    .buttonStyle(.borderedProminent)
            }
        case .loaded:
            if model.entries.isEmpty {
                LorebookEmptyView(model: model)
            } else if model.visibleEntries.isEmpty {
                if model.isSearching {
                    ContentUnavailableView.search
                } else if let category = model.filter.category {
                    LorebookEmptyCategoryView(model: model, category: category)
                }
            }
        }
    }
}
