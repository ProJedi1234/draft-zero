import Foundation

nonisolated enum WorldClock {
    static func day(_ minutes: Int) -> Int { minutes / 1440 + 1 }

    static func label(_ minutes: Int) -> String {
        let bucket = ["night", "morning", "afternoon", "evening"][(minutes % 1440) / 360]
        return "Day \(day(minutes)) · \(bucket)"
    }

    static func time(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes % 1440 / 60, minutes % 60)
    }

    static func absoluteMinutes(day: Int, time: String) -> Int? {
        let parts = time.split(separator: ":", omittingEmptySubsequences: false)
        guard day >= 1, day <= 9_007_199_254_740_991 / 1440, parts.count == 2,
              parts.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isNumber) }),
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        return (day - 1) * 1440 + hour * 60 + minute
    }
}
