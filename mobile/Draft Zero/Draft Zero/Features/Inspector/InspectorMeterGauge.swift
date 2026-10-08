import SwiftUI

/// "◔ 1.1k / 8k": a ring filled to the share of the window in use, then the
/// count. The smallest stops can't hold the narrator alone, so the ring pins
/// full and turns orange while the count shows the overflow.
struct InspectorMeterGauge: View {
    let used: Int
    let budget: Int
    let isUpdating: Bool

    @ScaledMetric(relativeTo: .subheadline) private var ringSize = 15

    var body: some View {
        HStack(spacing: 6) {
            if isUpdating {
                ProgressView()
                    .controlSize(.mini)
                    .frame(width: ringSize, height: ringSize)
            } else {
                ring
            }
            Text("\(InspectorText.approxTokens(used)) / \(GenerationLimits.contextWindowLabel(budget))")
                .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Context")
        .accessibilityValue("About \(InspectorText.approxTokens(used)) of \(GenerationLimits.contextWindowLabel(budget)) tokens\(isOver ? ", over the window" : "")")
    }

    private var isOver: Bool { used > budget }

    private var ring: some View {
        let fraction = Double(min(used, budget)) / Double(max(budget, 1))
        let lineWidth = ringSize / 5

        return ZStack {
            Circle()
                .inset(by: lineWidth / 2)
                .stroke(.quaternary, lineWidth: lineWidth)
            Circle()
                .inset(by: lineWidth / 2)
                .trim(from: 0, to: fraction)
                .stroke(isOver ? Color.orange : Color.accentColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: ringSize, height: ringSize)
    }
}
