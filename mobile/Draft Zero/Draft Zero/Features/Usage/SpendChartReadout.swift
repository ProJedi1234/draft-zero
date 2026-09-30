import SwiftUI

/// The day under the reader's finger, or a hint to touch the chart.
struct SpendChartReadout: View {
    let bar: UsagePayload.SpendBar?

    var body: some View {
        Group {
            if let bar, let day = SpendChartData.date(forDayKey: bar.day) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(day, format: .dateTime.weekday(.wide).month(.abbreviated).day())
                        .font(.subheadline.bold())
                    Text(detail(for: bar))
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Touch the chart to read a day.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(bar == nil)
    }

    private func detail(for bar: UsagePayload.SpendBar) -> String {
        var parts = [Format.usd(bar.costUsd), "\(bar.calls) \(bar.calls == 1 ? "generation" : "generations")"]
        if bar.imageValue > 0 {
            parts.append("\(Format.usd(bar.imageUsd)) pictures")
        }
        return parts.joined(separator: " · ")
    }
}
