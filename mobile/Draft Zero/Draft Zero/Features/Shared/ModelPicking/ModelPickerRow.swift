import SwiftUI

/// A form row naming the chosen text model; tapping it opens the searchable,
/// provider-grouped catalog. Takes plain values and reports the choice, so
/// the caller applies whatever coupling a model change needs.
struct ModelPickerRow: View {
    let title: String
    let models: [OpenRouterModel]
    /// The chosen id, or nil to follow `defaultOption`.
    let selection: String?
    let defaultOption: ModelDefaultOption?
    /// The bundle's retention policy: models no ZDR endpoint serves are greyed.
    let zdr: Bool
    let onSelect: (String?) -> Void

    @State private var isPresented = false

    /// A picker that must always name a model, like a story's or a profile's.
    init(_ title: String = "Model", models: [OpenRouterModel], selection: String, zdr: Bool, onSelect: @escaping (String) -> Void) {
        self.title = title
        self.models = models
        self.selection = selection
        self.defaultOption = nil
        self.zdr = zdr
        self.onSelect = { id in if let id { onSelect(id) } }
    }

    /// A picker whose nil follows a built-in default, like the summarizer's.
    init(
        _ title: String = "Model",
        models: [OpenRouterModel],
        selection: String?,
        defaultOption: ModelDefaultOption,
        zdr: Bool,
        onSelect: @escaping (String?) -> Void
    ) {
        self.title = title
        self.models = models
        self.selection = selection
        self.defaultOption = defaultOption
        self.zdr = zdr
        self.onSelect = onSelect
    }

    private var resolvedId: String {
        selection ?? defaultOption?.modelId ?? ""
    }

    private var detail: String? {
        let alias = models.first { $0.id == resolvedId }?.aliasTarget.map { "Points to \($0)" }
        if selection == nil, let defaultOption {
            return [defaultOption.title, alias].compactMap { $0 }.joined(separator: " · ")
        }
        return alias
    }

    var body: some View {
        Button(action: present) {
            PickerRowLabel(
                title: title,
                value: ModelCatalog.displayName(resolvedId, in: models),
                detail: detail
            )
        }
        .tint(.primary)
        .accessibilityHint("Opens the model list.")
        .sheet(isPresented: $isPresented) {
            ModelPickerSheet(
                title: title,
                models: models,
                selection: selection,
                defaultOption: defaultOption,
                zdr: zdr,
                onSelect: onSelect
            )
        }
    }

    private func present() {
        isPresented = true
    }
}
