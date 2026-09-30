import SwiftUI

/// How much of the window the next request would fill, measured by the server
/// from the story as saved. Also the way into that request's full breakdown,
/// answerable before a generation has spent anything.
struct InspectorContextMeter: View {
    let loader: NextContextLoader
    /// A profile switch is travelling, so the count is still the old profile's.
    let isStale: Bool

    @State private var isShowingBreakdown = false

    var body: some View {
        Button(action: showBreakdown) {
            if let context = loader.context {
                InspectorMeterGauge(
                    used: context.context.approxTokens,
                    budget: context.contextWindow,
                    isUpdating: isStale
                )
            } else if let failure = loader.failure {
                Label(failure, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Measuring the context…")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .disabled(loader.context == nil)
        .accessibilityHint("Shows the context for the next passage.")
        .sheet(isPresented: $isShowingBreakdown) {
            NextContextSheet(loader: loader)
        }
    }

    private func showBreakdown() {
        isShowingBreakdown = true
    }
}
