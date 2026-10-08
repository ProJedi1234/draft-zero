import SwiftUI

/// A text model's spend, its calls and tokens, and its share of the busiest model.
struct ModelSpendRow: View {
    let spend: UsagePayload.ModelSpend
    let peak: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent {
                Text(Format.usd(spend.costUsd))
                    .monospacedDigit()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.shortModelId(spend.modelId))
                        .font(.subheadline.monospaced())
                    Text("\(spend.calls) \(spend.calls == 1 ? "call" : "calls") · \(Format.tokens(spend.promptTokens)) in · \(Format.tokens(spend.completionTokens)) out")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            ShareBar(fraction: spend.share(of: peak))
        }
        .padding(.vertical, 2)
    }
}
