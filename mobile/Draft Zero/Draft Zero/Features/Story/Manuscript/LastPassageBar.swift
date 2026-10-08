import SwiftUI

/// Under the newest generated passage: its takes, what wrote it, what it
/// cost, and Retry.
struct LastPassageBar: View {
    let entry: StoryEntry
    let busy: Bool
    let workspace: StoryWorkspace
    let showContext: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if entry.variantCount > 1 {
                TakeSwitcher(
                    index: entry.variantIndex,
                    count: entry.variantCount,
                    disabled: busy,
                    step: step
                )
            }
            if let provenance {
                Text(provenance)
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if entry.costUsd != nil {
                Button(Format.usd(entry.costUsd), action: showContext)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Cost \(Format.usd(entry.costUsd)). Show what it was shown")
            }
            RetryMenu(workspace: workspace, disabled: busy)
        }
        .font(.footnote)
        .buttonStyle(.borderless)
    }

    /// Named only when the slot's takes disagree about what wrote them.
    private var provenance: String? {
        guard let generation = entry.generation, entry.variantProfilesMixed else { return nil }
        return generation.profileName ?? Format.shortModelId(generation.modelId)
    }

    private func step(_ offset: Int) {
        Task { await workspace.stepVariant(entry, by: offset) }
    }
}
