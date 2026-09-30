import SwiftUI

/// The atmosphere picker's only voice: a check that fails looks exactly like
/// one that kept the colour, so it has to say which happened.
struct AtmosphereIndicator: View {
    let status: SyncWireEvent.Atmosphere?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingMessage = false

    var body: some View {
        if let status, status.phase != .kept {
            Button(label(for: status.phase), systemImage: symbol(for: status.phase)) {
                showingMessage = status.message != nil
            }
            .labelStyle(.iconOnly)
            .symbolEffect(.pulse, isActive: status.phase == .checking && !reduceMotion)
            .foregroundStyle(status.phase == .failed || status.phase == .stopped ? .orange : .secondary)
            .popover(isPresented: $showingMessage) {
                Text(status.message ?? "")
                    .padding()
                    .presentationCompactAdaptation(.popover)
            }
            .help(label(for: status.phase))
        }
    }

    private func label(for phase: SyncWireEvent.Atmosphere.Phase) -> String {
        switch phase {
        case .checking: "Reading the scene's atmosphere"
        case .kept: "Atmosphere unchanged"
        case .painted: "Atmosphere repainted"
        case .failed: "Atmosphere check failed"
        case .stopped: "Atmosphere checks stopped"
        }
    }

    private func symbol(for phase: SyncWireEvent.Atmosphere.Phase) -> String {
        switch phase {
        case .checking, .kept: "sparkles"
        case .painted: "paintpalette"
        case .failed, .stopped: "exclamationmark.triangle"
        }
    }
}
