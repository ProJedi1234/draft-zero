import Foundation

/// Parses the server's ISO-8601 timestamps, with or without fractional seconds.
/// Versions stay strings everywhere else: string order is chronological order.
nonisolated enum ISODate {
    static func parse(_ string: String) -> Date? {
        if let date = try? Date(string, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) {
            return date
        }
        if let date = try? Date(string, strategy: .iso8601) {
            return date
        }
        // Postgres text timestamps ("2026-09-01 12:00:00.123+00") use a space.
        let normalized = string.replacing(" ", with: "T", maxReplacements: 1)
        if normalized != string {
            return parse(normalized)
        }
        return nil
    }
}
