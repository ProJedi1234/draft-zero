import Foundation
import Testing
@testable import Draft_Zero

struct SpendChartDataTests {
    private func bar(_ day: String, value: Double, image: Double = 0, calls: Int = 1) -> UsagePayload.SpendBar {
        UsagePayload.SpendBar(day: day, costUsd: "\(value)", imageUsd: "\(image)", calls: calls, value: value, imageValue: image)
    }

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Pacific/Auckland") ?? .gmt
        return calendar
    }

    @Test func dayKeysBecomeNoonOnThatCalendarDay() throws {
        let date = try #require(SpendChartData.date(forDayKey: "2026-09-29", calendar: calendar))
        let parts = calendar.dateComponents([.year, .month, .day, .hour], from: date)
        #expect(parts.year == 2026 && parts.month == 9 && parts.day == 29 && parts.hour == 12)
        #expect(SpendChartData.date(forDayKey: "garbage", calendar: calendar) == nil)
    }

    @Test func picturesAreASliceOfTheDayAndTextIsTheRest() {
        let points = SpendChartData.points([bar("2026-09-28", value: 1.0, image: 0.25)], calendar: calendar)
        #expect(points.map(\.series) == [.text, .pictures])
        #expect(points.map(\.usd) == [0.75, 0.25])
    }

    @Test func aPictureSliceNeverExceedsItsDay() {
        let points = SpendChartData.points([bar("2026-09-28", value: 0.1, image: 0.4)], calendar: calendar)
        #expect(points.map(\.usd) == [0, 0.1])
    }

    @Test func daysWithoutSpendStillGetBothSegments() {
        let points = SpendChartData.points([bar("2026-09-28", value: 0, calls: 0)], calendar: calendar)
        #expect(points.count == 2)
        #expect(points.allSatisfy { $0.usd == 0 })
    }

    @Test func barsWithBadKeysAreLeftOut() {
        #expect(SpendChartData.points([bar("nope", value: 1)], calendar: calendar).isEmpty)
    }

    @Test func aTouchedInstantFindsItsDaysBar() throws {
        let bars = [bar("2026-09-27", value: 1), bar("2026-09-28", value: 2), bar("2026-09-29", value: 3)]
        let touched = try #require(calendar.date(from: DateComponents(year: 2026, month: 9, day: 28, hour: 3, minute: 15)))
        #expect(SpendChartData.bar(on: touched, in: bars, calendar: calendar)?.day == "2026-09-28")
        let outside = try #require(calendar.date(from: DateComponents(year: 2026, month: 10, day: 2)))
        #expect(SpendChartData.bar(on: outside, in: bars, calendar: calendar) == nil)
    }

    @Test func emptyWindowIsDetected() {
        #expect(SpendChartData.isEmpty([bar("2026-09-28", value: 0)]))
        #expect(!SpendChartData.isEmpty([bar("2026-09-28", value: 0), bar("2026-09-29", value: 0.01)]))
    }
}

struct UsagePayloadDisplayTests {
    @Test func fixtureHasNoPicturesUntilOneIsDrawn() throws {
        let payload = try FixtureLoader.decode(UsagePayload.self, from: "usage.json")
        #expect(payload.hasImages == false)
    }

    @Test func sharesAreRelativeToTheBusiestModel() {
        let busy = UsagePayload.ModelSpend(modelId: "a/b", costUsd: "4", calls: 1, promptTokens: 0, completionTokens: 0)
        let light = UsagePayload.ModelSpend(modelId: "a/c", costUsd: "1", calls: 1, promptTokens: 0, completionTokens: 0)
        #expect(busy.share(of: 4) == 1)
        #expect(light.share(of: 4) == 0.25)
        #expect(light.share(of: 0) == 0)
    }

    @Test func unpricedPicturesMarkTheFloor() {
        #expect(Format.usdFloor("0.5", unpriced: 2) == "$0.500+")
        #expect(Format.usdFloor("0.5", unpriced: 0) == "$0.500")
    }
}
