import SwiftUI

/// The Auto row: let OpenRouter route, and how fast that can be.
struct AutoProviderRow: View {
    let allowed: [ModelEndpoint]
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Auto")
                        Text(summary)
                            .font(.footnote)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "sparkles")
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                SelectionCheckmark(isSelected: isSelected)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .disabled(allowed.isEmpty)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// "Up to" because the fastest endpoint is a ceiling, not a promise.
    private var summary: String {
        if allowed.isEmpty { return "None available" }
        if let fastest = EndpointRouting.fastestThroughput(allowed) {
            return "Up to \(Format.throughput(fastest))"
        }
        return allowed.count == 1 ? "1 provider" : "\(allowed.count) providers"
    }
}
