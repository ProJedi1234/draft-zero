import Charts
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

            let spends = profile.perEntry.compactMap { spend in
                Double(spend.costUsd ?? "").map { (spend.position, $0) }
            }
            if spends.count > 1 {
                Section("Per passage") {
                    Chart(spends, id: \.0) { position, cost in
                        BarMark(x: .value("Passage", position), y: .value("Cost", cost))
                            .foregroundStyle(.tint)
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis {
                        AxisMarks { value in
                            AxisValueLabel {
                                if let cost = value.as(Double.self) { Text(Format.usd(cost)) }
                            }
                        }
                    }
                    .frame(height: 120)
                    .accessibilityLabel("Cost per passage, \(spends.count) passages")
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
