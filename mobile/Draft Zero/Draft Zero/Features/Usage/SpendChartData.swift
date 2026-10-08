import Foundation

/// Turns the ledger's daily rows into what the chart draws and reads out.
nonisolated enum SpendChartData {
    /// The calendar day a "YYYY-MM-DD" key names, as noon on the device's
    /// calendar so any day-sized bin the chart cuts lands on that day.
    static func date(forDayKey key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// Two segments per day, text first so it sits at the base of the stack.
    /// Pictures are a slice of a day's spend, so text is what remains of it.
    static func points(_ bars: [UsagePayload.SpendBar], calendar: Calendar = .current) -> [SpendPoint] {
        bars.flatMap { bar -> [SpendPoint] in
            guard let day = date(forDayKey: bar.day, calendar: calendar) else { return [] }
            let pictures = min(max(bar.imageValue, 0), max(bar.value, 0))
            return [
                SpendPoint(day: day, dayKey: bar.day, series: .text, usd: max(bar.value, 0) - pictures),
                SpendPoint(day: day, dayKey: bar.day, series: .pictures, usd: pictures),
            ]
        }
    }

    /// The bar whose calendar day contains `date`.
    static func bar(on date: Date, in bars: [UsagePayload.SpendBar], calendar: Calendar = .current) -> UsagePayload.SpendBar? {
        bars.first { bar in
            self.date(forDayKey: bar.day, calendar: calendar).map { calendar.isDate($0, inSameDayAs: date) } ?? false
        }
    }

    /// True when nothing in the window cost anything.
    static func isEmpty(_ bars: [UsagePayload.SpendBar]) -> Bool {
        !bars.contains { $0.value > 0 }
    }
}
