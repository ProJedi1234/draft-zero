import SwiftUI

/// Today, this week and all time side by side, stacked once the type is too large.
struct SpendSummaryRow: View {
    let summary: UsagePayload.Summary
    let showsPictures: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) {
                today
                Divider()
                week
                Divider()
                allTime
            }
            VStack(alignment: .leading, spacing: 16) {
                today
                week
                allTime
            }
        }
        .padding(.vertical, 4)
    }

    private var today: SpendFigure {
        SpendFigure(
            label: "Today",
            total: summary.todayUsd,
            unpriced: summary.todayUnpricedCalls,
            pictures: showsPictures ? summary.todayImageUsd : nil,
            pictureUnpriced: summary.todayImageUnpricedCalls
        )
    }

    private var week: SpendFigure {
        SpendFigure(
            label: "This Week",
            total: summary.weekUsd,
            unpriced: summary.weekUnpricedCalls,
            pictures: showsPictures ? summary.weekImageUsd : nil,
            pictureUnpriced: summary.weekImageUnpricedCalls
        )
    }

    private var allTime: SpendFigure {
        SpendFigure(
            label: "All Time",
            total: summary.allTimeUsd,
            unpriced: summary.unpricedCalls,
            pictures: showsPictures ? summary.allTimeImageUsd : nil,
            pictureUnpriced: summary.allTimeImageUnpricedCalls
        )
    }
}
