import SwiftUI

/// "Context ▓▓░░ ≈1.1k of 8k" in one row, stacked at large text sizes. The
/// smallest stops can't hold the narrator alone, so the bar pins full while
/// the readout shows the overflow.
struct InspectorMeterGauge: View {
    let used: Int
    let budget: Int
    let isUpdating: Bool

    var body: some View {
        let readout = "≈\(InspectorText.approxTokens(used)) of \(GenerationLimits.contextWindowLabel(budget))"

        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                title
                bar
                    .frame(minWidth: 80)
                figures(readout)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    title
                    Spacer(minLength: 0)
                    figures(readout)
                }
                bar
            }
            VStack(alignment: .leading, spacing: 6) {
                title
                figures(readout)
                bar
            }
        }
        .font(.subheadline)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Context")
        .accessibilityValue("About \(InspectorText.approxTokens(used)) of \(GenerationLimits.contextWindowLabel(budget)) tokens\(used > budget ? ", over the window" : "")")
    }

    private var title: some View {
        HStack(spacing: 6) {
            Text("Context")
                .fixedSize()
            if isUpdating {
                ProgressView()
                    .controlSize(.mini)
            }
        }
    }

    private var bar: some View {
        Gauge(value: Double(min(used, budget)), in: 0...Double(max(budget, 1))) {
            EmptyView()
        }
        .gaugeStyle(.linearCapacity)
        .tint(used > budget ? .orange : .accentColor)
    }

    private func figures(_ readout: String) -> some View {
        HStack(spacing: 6) {
            Text(readout)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .fixedSize()
            Image(systemName: "chevron.forward")
                .font(.caption.bold())
                .foregroundStyle(.tertiary)
        }
    }
}
