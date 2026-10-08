import SwiftUI

/// The ledger's contents: totals, a per-passage sparkline, and model shares.
struct CostLedgerList: View {
    let profile: StoryCostProfile
    let openUsage: () -> Void

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Format.usdFloor(profile.totalUsd, unpriced: profile.unpricedCalls))
                        .font(.system(.largeTitle, design: .rounded))
                        .bold()
                        .monospacedDigit()
                    Text("^[\(profile.calls) call](inflect: true) · \(Format.tokens(profile.promptTokens)) in · \(Format.tokens(profile.completionTokens)) out")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                if profile.unpricedCalls > 0 {
                    Label("^[\(profile.unpricedCalls) call](inflect: true) went unpriced, so the total is a floor.", systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if profile.abortedCalls > 0 {
                    Label("^[\(profile.abortedCalls) call](inflect: true) stopped mid-stream. They are still billed.", systemImage: "stop.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            let bars = PassageSpendData.bars(profile.perEntry)
            if bars.count > 1, bars.contains(where: { ($0.usd ?? 0) > 0 }) {
                Section {
                    PassageSpendChart(bars: bars)
                        .padding(.vertical, 8)
                        .accessibilityLabel("Cost per passage")
                } header: {
                    Text("Per passage")
                } footer: {
                    Text("^[\(profile.perEntry.count) passage](inflect: true), oldest first")
                }
            }

            if !profile.perModel.isEmpty {
                Section("By model") {
                    ForEach(profile.perModel) { share in
                        LabeledContent {
                            Text(Format.usd(share.costUsd)).monospacedDigit()
                        } label: {
                            Text(Format.shortModelId(share.modelId))
                            Text("^[\(share.calls) call](inflect: true)")
                        }
                    }
                }
            }

            Section {
                Button("All Usage", systemImage: "chart.bar", action: openUsage)
            }
        }
    }
}
