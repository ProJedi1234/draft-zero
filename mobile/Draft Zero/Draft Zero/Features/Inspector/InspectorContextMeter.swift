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
                Label("Context", systemImage: "exclamationmark.triangle")
                    .accessibilityLabel(failure)
            } else {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                    Text("Context")
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Measuring the context")
            }
        }
        .font(.subheadline)
        .buttonStyle(.glass)
        .fixedSize()
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
