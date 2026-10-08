import SwiftUI

/// What the atmosphere picker last did. Its whole product is a colour, so a
/// refusal, a kept colour and a check that never ran look identical unless
/// something says which it was.
struct InspectorAtmosphereStatusRow: View {
    let status: SyncWireEvent.Atmosphere

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Label {
            Text(message)
        } icon: {
            Image(systemName: symbol)
                .symbolEffect(.pulse, isActive: status.phase == .checking && !reduceMotion)
        }
        .font(.subheadline)
        .foregroundStyle(isProblem ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
    }

    private var isProblem: Bool {
        status.phase == .failed || status.phase == .stopped
    }

    private var message: String {
        switch status.phase {
        case .checking: "Reading the scene…"
        case .kept: "Kept its colour after the last passage."
        case .painted: "Repainted after the last passage."
        case .failed: status.message ?? "The last check failed."
        case .stopped: status.message ?? "Stopped after repeated failures. Change the atmosphere model in Settings."
        }
    }

    private var symbol: String {
        switch status.phase {
        case .checking, .kept: "sparkles"
        case .painted: "paintpalette"
        case .failed, .stopped: "exclamationmark.triangle"
        }
    }
}
