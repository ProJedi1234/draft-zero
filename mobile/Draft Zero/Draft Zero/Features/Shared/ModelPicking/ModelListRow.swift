import SwiftUI

/// One model in the catalog list: its name, what an alias points at, whether
/// it thinks, its window and its per-1M prices.
struct ModelListRow: View {
    let model: OpenRouterModel
    let isSelected: Bool
    /// Ruled out by the retention policy: shown greyed so it can still be found.
    let isBlocked: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(model.name)
                        if model.reasoning != nil {
                            Image(systemName: "brain")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("Thinks before writing")
                        }
                    }
                    if let target = model.aliasTarget {
                        Text("Points to \(target)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Text("\(Format.contextLength(model.contextLength)) context · \(model.pricing.prompt) in · \(model.pricing.completion) out per 1M")
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                SelectionCheckmark(isSelected: isSelected)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .disabled(isBlocked)
        .id(model.id)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
