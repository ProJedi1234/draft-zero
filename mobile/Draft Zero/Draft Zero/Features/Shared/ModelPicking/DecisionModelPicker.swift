import SwiftUI

/// The atmosphere check's decision model: a form row that opens the System One
/// catalog. Separate from the text picker because choosing a decision model
/// there would send a story down a route with no messages to put it in.
struct DecisionModelPickerRow: View {
    let models: [DecisionModel]
    /// The chosen id, or nil for the built-in default.
    let selection: String?
    let zdr: Bool
    /// The local host's label, for the empty Local group; nil when there is none.
    let localHost: String?
    let onSelect: (String) -> Void

    @State private var isPresented = false

    private var resolvedId: String {
        selection ?? BuiltInModels.atmosphereDecision
    }

    var body: some View {
        let model = models.first { $0.id == resolvedId }
        Button(action: present) {
            PickerRowLabel(
                title: "Decision model",
                value: model?.name ?? resolvedId,
                detail: model.map(Self.detail)
            )
        }
        .tint(.primary)
        .accessibilityHint("Opens the decision model list.")
        .sheet(isPresented: $isPresented) {
            DecisionModelPickerSheet(
                models: models,
                selection: resolvedId,
                zdr: zdr,
                localHost: localHost,
                onSelect: onSelect
            )
        }
    }

    /// "TypeSafe · $0.042 per 1M in · 64K", or "Free · runs on metis".
    nonisolated static func detail(_ model: DecisionModel) -> String {
        if let local = model.local { return "Free · runs on \(local.host)" }
        var parts = [model.provider, "\(model.promptPrice) per 1M in"]
        if model.contextLength > 0 { parts.append(Format.contextLength(model.contextLength)) }
        if model.inputModalities.contains("image") { parts.append("image") }
        return parts.joined(separator: " · ")
    }

    private func present() {
        isPresented = true
    }
}

struct DecisionModelPickerSheet: View {
    let models: [DecisionModel]
    let selection: String
    let zdr: Bool
    let localHost: String?
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @AppStorage(ModelSource.storageKey) private var source: ModelSource = .all

    var body: some View {
        let hasLocal = localHost != nil || models.contains { $0.local != nil }
        let effective = hasLocal ? source : .all
        let visible = ModelCatalog.filter(ModelCatalog.filter(models, source: effective), query: query)
        let split = ModelCatalog.partition(visible, zdr: zdr)
        let groups = ModelCatalog.groupByProvider(split.allowed)
        let noLocal = !models.contains { $0.local != nil } && effective != .external

        NavigationStack {
            List {
                if hasLocal {
                    ModelSourcePicker(source: $source)
                }
                if noLocal, let localHost, query.isEmpty {
                    Section {
                        Text("No decision models on \(localHost) yet. Pull one with `ollama pull tev1` or `ollama pull nimble`.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } header: {
                        Text("Ollama · \(localHost)")
                    }
                }
                ForEach(groups) { group in
                    Section {
                        ForEach(group.entries) { model in
                            row(model, isBlocked: false)
                        }
                    } header: {
                        Text(group.provider)
                    }
                }
                if !split.blocked.isEmpty {
                    Section("No zero-retention provider") {
                        ForEach(split.blocked) { model in
                            row(model, isBlocked: true)
                        }
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search decision models")
            .navigationTitle("Decision model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: close)
                }
            }
        }
    }

    private func row(_ model: DecisionModel, isBlocked: Bool) -> some View {
        Button {
            choose(model.id)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.name)
                    if let local = model.local {
                        LocalModelDetail(local: local, extra: ["free"])
                    } else {
                        Text(DecisionModelPickerRow.detail(model))
                            .font(.footnote)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                SelectionCheckmark(isSelected: !isBlocked && model.id == selection)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .disabled(isBlocked)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(model.id == selection ? .isSelected : [])
    }

    private func choose(_ modelId: String) {
        if modelId != selection { onSelect(modelId) }
        dismiss()
    }

    private func close() {
        dismiss()
    }
}
