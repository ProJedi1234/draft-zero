import SwiftUI

/// Every figure the ledger has, in grouped sections.
struct UsageList: View {
    let payload: UsagePayload
    var onOpenStory: (String) -> Void

    var body: some View {
        List {
            Section {
                SpendSummaryRow(summary: payload.summary, showsPictures: payload.hasImages)
            } header: {
                Text("Right Now")
            } footer: {
                if payload.summary.unpricedCalls > 0 {
                    Text("A + marks a total that leaves out ^[\(payload.summary.unpricedCalls) generation](inflect: true) the provider never priced.")
                }
            }

            Section {
                SpendChart(bars: payload.bars)
                LabeledContent("Last \(payload.windowDays) days") {
                    Text(Format.usdFloor(payload.windowUsd, unpriced: payload.windowUnpricedCalls))
                        .monospacedDigit()
                }
            } header: {
                Text("Over Time")
            } footer: {
                Text("Days start at 00:00 \(payload.zoneLabel).")
            }

            UsageListSection(title: "By Story", elements: payload.byStory, emptyText: "Nothing generated yet.") { spend in
                StorySpendRow(spend: spend, onOpen: onOpenStory)
            }
            UsageListSection(title: "By Model", elements: payload.byModel, emptyText: "Nothing generated yet.") { spend in
                ModelSpendRow(spend: spend, peak: payload.modelPeak)
            }
            if payload.hasImages {
                UsageListSection(title: "By Image Model", elements: payload.byImageModel, emptyText: "No pictures yet.") { spend in
                    ImageModelSpendRow(spend: spend, peak: payload.imageModelPeak)
                }
            }
        }
    }
}
