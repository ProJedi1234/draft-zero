import Testing
@testable import Draft_Zero

struct PassageSpendDataTests {
    private func entries(_ costs: [String?], firstPosition: Int = 216) -> [StoryCostProfile.EntrySpend] {
        costs.enumerated().map { offset, cost in
            StoryCostProfile.EntrySpend(entryId: "e\(offset)", position: firstPosition + offset * 2, costUsd: cost)
        }
    }

    @Test func shortStoriesGetOneBarPerPassageInOrder() {
        let bars = PassageSpendData.bars(entries(["0.01", nil, "0.03"]))
        #expect(bars.map(\.index) == [0, 1, 2])
        #expect(bars.map(\.passages) == [1...1, 2...2, 3...3])
        #expect(bars.map(\.usd) == [0.01, nil, 0.03])
    }

    @Test func longStoriesFoldIntoAtMostTheCap() {
        let bars = PassageSpendData.bars(entries(Array(repeating: "0.5", count: 7)), maxBars: 3)
        #expect(bars.map(\.passages) == [1...3, 4...6, 7...7])
        #expect(bars.map(\.usd) == [1.5, 1.5, 0.5])
    }

    @Test func aBarIsUnpricedOnlyWhenEveryPassageInItIs() {
        let bars = PassageSpendData.bars(entries([nil, "0.25", nil, nil]), maxBars: 2)
        #expect(bars.map(\.usd) == [0.25, nil])
    }

    @Test func noEntriesMeansNoBars() {
        #expect(PassageSpendData.bars([]).isEmpty)
    }
}
