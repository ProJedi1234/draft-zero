import Charts
import SwiftUI

/// Daily spend over the ledger's window, text and pictures stacked. Dragging a
/// finger across it reads out a day.
struct SpendChart: View {
    let bars: [UsagePayload.SpendBar]

    @State private var selectedDay: Date?
    @ScaledMetric(relativeTo: .body) private var height = 180.0

    private var points: [SpendPoint] { SpendChartData.points(bars) }
    private var selectedBar: UsagePayload.SpendBar? {
        selectedDay.flatMap { SpendChartData.bar(on: $0, in: bars) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SpendChartReadout(bar: selectedBar)
            Chart {
                ForEach(points) { point in
                    BarMark(
                        x: .value("Day", point.day, unit: .day),
                        y: .value("Spend", point.usd),
                        width: .ratio(0.7)
                    )
                    .foregroundStyle(by: .value("Kind", point.series.rawValue))
                    .opacity(isDimmed(point) ? 0.4 : 1)
                    .accessibilityLabel(Text(point.day, format: .dateTime.weekday(.wide).month(.wide).day()))
                    .accessibilityValue("\(Format.usd(point.usd)) on \(point.series.rawValue.lowercased())")
                }
            }
            .chartForegroundStyleScale([
                SpendPoint.Series.text.rawValue: Color.blue,
                SpendPoint.Series.pictures.rawValue: Color.orange,
            ])
            .chartXSelection(value: $selectedDay)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 7)) {
                    AxisTick()
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let usd = value.as(Double.self) {
                            Text(Format.usd(usd))
                        }
                    }
                }
            }
            .chartLegend(position: .bottom, alignment: .leading)
            .overlay {
                if SpendChartData.isEmpty(bars) {
                    Text("No spend in this window.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(height: height)
            .accessibilityLabel("Daily spend over the last \(bars.count) days")
        }
    }

    private func isDimmed(_ point: SpendPoint) -> Bool {
        guard let selectedDay else { return false }
        return !Calendar.current.isDate(point.day, inSameDayAs: selectedDay)
    }
}
