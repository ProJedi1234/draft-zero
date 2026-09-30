import SwiftUI

/// The image catalog as a searchable list grouped by lab, with the fallback
/// as its first row and models ZDR rules out greyed at the bottom.
struct ImageModelPickerSheet: View {
    let title: String
    let models: [OpenRouterImageModel]
    let selection: String?
    let fallback: ImageModelFallback
    let zdr: Bool
    let onSelect: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let visible = ModelCatalog.filter(models, query: query)
        let split = ModelCatalog.partition(visible, zdr: zdr)
        let groups = ModelCatalog.groupByProvider(split.allowed)
        let fallbackName = fallback.resolve(in: models, zdr: zdr).map { id in models.first { $0.id == id }?.name ?? id }
        let showsFallback = query.isEmpty || "default".localizedStandardContains(query)

        NavigationStack {
            List {
                if showsFallback {
                    Section {
                        DefaultChoiceRow(
                            title: fallback.title,
                            detail: fallbackName ?? fallback.caption,
                            isSelected: selection == nil,
                            onSelect: { choose(nil) }
                        )
                    } footer: {
                        Text(fallback.caption)
                    }
                }
                ForEach(groups) { group in
                    Section(group.provider) {
                        ForEach(group.entries) { model in
                            ImageModelListRow(model: model, isSelected: model.id == selection, isBlocked: false) {
                                choose(model.id)
                            }
                        }
                    }
                }
                if !split.blocked.isEmpty {
                    Section {
                        ForEach(split.blocked) { model in
                            ImageModelListRow(model: model, isSelected: false, isBlocked: true) {}
                        }
                    } header: {
                        Text("No zero-retention provider")
                    } footer: {
                        Text("Zero data retention is on, and every provider serving these keeps prompts.")
                    }
                }
            }
            .overlay {
                if visible.isEmpty && !showsFallback {
                    ContentUnavailableView.search
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search image models")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: close)
                }
            }
        }
    }

    private func choose(_ modelId: String?) {
        if modelId != selection { onSelect(modelId) }
        dismiss()
    }

    private func close() {
        dismiss()
    }
}
