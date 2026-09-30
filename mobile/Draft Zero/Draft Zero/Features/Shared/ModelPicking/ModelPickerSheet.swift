import SwiftUI

/// The text catalog as a searchable list, grouped by lab. Under zero data
/// retention the models no retention-free endpoint serves collect at the
/// bottom, greyed, so a writer sees why a model is missing instead of hunting.
struct ModelPickerSheet: View {
    let title: String
    let models: [OpenRouterModel]
    let selection: String?
    let defaultOption: ModelDefaultOption?
    let zdr: Bool
    let onSelect: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let visible = ModelCatalog.filter(models, query: query)
        let split = ModelCatalog.partition(visible, zdr: zdr)
        let groups = ModelCatalog.groupByProvider(split.allowed)
        let showsDefault = defaultOption != nil && (query.isEmpty || "default".localizedStandardContains(query))

        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if showsDefault, let defaultOption {
                        Section {
                            DefaultChoiceRow(
                                title: defaultOption.title,
                                detail: ModelCatalog.displayName(defaultOption.modelId, in: models),
                                isSelected: selection == nil,
                                onSelect: { choose(nil) }
                            )
                        }
                    }
                    ForEach(groups) { group in
                        Section(group.provider) {
                            ForEach(group.entries) { model in
                                ModelListRow(model: model, isSelected: model.id == selection, isBlocked: false) {
                                    choose(model.id)
                                }
                            }
                        }
                    }
                    if !split.blocked.isEmpty {
                        Section {
                            ForEach(split.blocked) { model in
                                ModelListRow(model: model, isSelected: false, isBlocked: true) {}
                            }
                        } header: {
                            Text("No zero-retention provider")
                        } footer: {
                            Text("Zero data retention is on, and every provider serving these keeps prompts.")
                        }
                    }
                }
                .overlay {
                    if visible.isEmpty && !(showsDefault) {
                        ContentUnavailableView.search
                    }
                }
                .onAppear {
                    if let selection { proxy.scrollTo(selection, anchor: .center) }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search models")
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
