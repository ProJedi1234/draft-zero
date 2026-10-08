import SwiftUI

/// One provider serving the model: speed, uptime, price, window, quantization.
struct EndpointListRow: View {
    let endpoint: ModelEndpoint
    let isSelected: Bool
    /// Ruled out by the retention policy: listed with the same numbers, greyed.
    let isBlocked: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(endpoint.providerName)
                        if let variant = Format.endpointVariant(endpoint.tag, quantization: endpoint.quantization) {
                            Text(variant.text)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .accessibilityLabel(variant.label)
                        }
                        if let quantization = endpoint.quantization {
                            Text(quantization)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("Quantized \(quantization)")
                        }
                    }
                    Text("\(endpoint.pricing.prompt) in · \(endpoint.pricing.completion) out per 1M · \(Format.contextLength(endpoint.contextLength)) context")
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    Text("\(Format.uptime(endpoint.uptime)) uptime")
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(isUnreliable ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                }
                Spacer(minLength: 8)
                Label(Format.throughput(endpoint.throughput), systemImage: "bolt.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                SelectionCheckmark(isSelected: isSelected)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .disabled(isBlocked)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// Uptime only earns a colour when it is a reason not to pick the row.
    private var isUnreliable: Bool {
        guard let uptime = endpoint.uptime else { return false }
        return uptime < 0.99
    }
}
