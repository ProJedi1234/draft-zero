import SwiftUI

/// A picture model's spend, its picture count and average cost, and a marker
/// when some pictures were never priced.
struct ImageModelSpendRow: View {
    let spend: UsagePayload.ImageModelSpend
    let peak: Double

    private var average: String {
        spend.avgUsd.map { "\(Format.usd($0))/picture" } ?? "—"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent {
                Text(Format.usdFloor(spend.costUsd, unpriced: spend.unpricedImages))
                    .monospacedDigit()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.shortModelId(spend.modelId))
                        .font(.subheadline.monospaced())
                    Text("\(spend.images) \(spend.images == 1 ? "picture" : "pictures") · \(average)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if spend.unpricedImages > 0 {
                        Label("\(spend.unpricedImages) unpriced", systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
            }
            ShareBar(fraction: spend.share(of: peak))
        }
        .padding(.vertical, 2)
    }
}
