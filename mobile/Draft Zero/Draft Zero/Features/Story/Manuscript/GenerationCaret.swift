import SwiftUI

/// What the run is doing right now. Pending and thinking look alike to a
/// writer but are not: one might be a stall, the other is progress.
struct GenerationCaret: View {
    let status: GenerationController.Status

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 8) {
            switch status {
            case .pending:
                ProgressView()
                    .controlSize(.small)
                Text("Waiting for the model…")
            case .thinking:
                Image(systemName: "brain")
                    .symbolEffect(.pulse, isActive: !reduceMotion)
                Text("Thinking…")
            case .streaming:
                Image(systemName: "pencil.line")
                    .symbolEffect(.pulse, isActive: !reduceMotion)
                Text("Writing…")
            case .settling, .idle:
                EmptyView()
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}
