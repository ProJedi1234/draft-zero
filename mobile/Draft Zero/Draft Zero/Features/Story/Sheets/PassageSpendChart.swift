import Charts
import SwiftUI

/// Spend over manuscript order, one evenly spaced bar per passage or per run
/// of passages. Unpriced and free passages draw as a muted stub, never a gap.
struct PassageSpendChart: View {
    let bars: [PassageSpendBar]

    @ScaledMetric(relativeTo: .body) private var height = 120.0

    private var peak: Double { bars.compactMap(\.usd).max() ?? 0 }

    var body: some View {
        Chart(bars) { bar in
            mark(bar)
        }
        .chartXScale(domain: 0...Double(bars.count))
        .chartXAxis(.hidden)
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let usd = value.as(Double.self) {
                        Text("$\(usd.formatted(.number.precision(.significantDigits(1...2))))")
                    }
                }
            }
        }
        .frame(height: height)
    }

    private func mark(_ bar: PassageSpendBar) -> some ChartContent {
        let start: Double = Double(bar.index) + 0.15
        let end: Double = Double(bar.index) + 0.85
        let height: Double = max(bar.usd ?? 0, peak * 0.02)
        let style: AnyShapeStyle = bar.usd == nil ? AnyShapeStyle(Color.secondary.opacity(0.4)) : AnyShapeStyle(.tint)
        let value: String = bar.usd.map { Format.usd($0) } ?? "Unpriced"
        return RectangleMark(
            xStart: PlottableValue.value("Passage", start),
            xEnd: PlottableValue.value("Passage", end),
            yStart: PlottableValue.value("Cost", 0.0),
            yEnd: PlottableValue.value("Cost", height)
        )
        .cornerRadius(2)
        .foregroundStyle(style)
        .accessibilityLabel(label(bar))
        .accessibilityValue(value)
    }

    private func label(_ bar: PassageSpendBar) -> String {
        bar.passages.count == 1
            ? "Passage \(bar.passages.lowerBound)"
            : "Passages \(bar.passages.lowerBound) to \(bar.passages.upperBound)"
    }
}
