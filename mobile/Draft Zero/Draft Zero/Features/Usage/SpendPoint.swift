import Foundation

/// One stacked segment of a day's bar: the text spend or the picture spend.
nonisolated struct SpendPoint: Identifiable, Hashable, Sendable {
    enum Series: String, CaseIterable, Sendable {
        case text = "Text"
        case pictures = "Pictures"
    }

    var day: Date
    var dayKey: String
    var series: Series
    var usd: Double

    var id: String { "\(dayKey)-\(series.rawValue)" }
}
