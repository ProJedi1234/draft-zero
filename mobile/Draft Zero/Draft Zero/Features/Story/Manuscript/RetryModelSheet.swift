import SwiftUI

/// A row starts a retry immediately; the story keeps its generation settings.
struct RetryModelSheet: View {
    let workspace: StoryWorkspace

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let models = ModelCatalog.filter(workspace.models, query: query)
        let groups = ModelCatalog.groupByProvider(models)
        let profiles = workspace.profiles.filter(matches)

        NavigationStack {
            List {
                if !profiles.isEmpty {
                    Section("Presets") {
                        ForEach(profiles) { profile in
                            Button {
                                retry(profileId: profile.id)
                            } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(profile.name)
                                        Text(ModelCatalog.displayName(profile.settings.modelId, in: workspace.models))
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer(minLength: 8)
                                    SelectionCheckmark(isSelected: profile.id == workspace.story?.profileId)
                                }
                                .contentShape(.rect)
                            }
                            .tint(.primary)
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(profile.id == workspace.story?.profileId ? .isSelected : [])
                            .accessibilityHint("Retries with this preset for this take only.")
                        }
                    }
                }

                ForEach(groups) { group in
                    Section(group.provider) {
                        ForEach(group.entries) { model in
                            let blocked = (workspace.story?.settings.zdr ?? false) && !model.zdr
                            ModelListRow(
                                model: model,
                                isSelected: model.id == workspace.story?.settings.modelId,
                                isBlocked: blocked
                            ) {
                                retry(modelId: model.id)
                            }
                            .accessibilityHint(blocked
                                ? "Unavailable because zero data retention is on."
                                : "Retries with this model for this take only.")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .disabled(!workspace.generation.canRetry)
            .overlay {
                if models.isEmpty && profiles.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search presets and models")
            .navigationTitle("Retry with Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
        }
    }

    private func matches(_ profile: ModelProfile) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty || profile.name.localizedStandardContains(query)
            || profile.settings.modelId.localizedStandardContains(query) { return true }
        guard let model = workspace.models.first(where: { $0.id == profile.settings.modelId }) else { return false }
        return ModelCatalog.matches(model, query: query)
    }

    private func retry(profileId: String? = nil, modelId: String? = nil) {
        workspace.generation.retryLast(profileId: profileId, modelId: modelId)
        dismiss()
    }
}
