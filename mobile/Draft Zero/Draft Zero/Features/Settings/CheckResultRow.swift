import SwiftUI

/// The outcome of the connection probe, once there is one.
struct CheckResultRow: View {
    let check: ConnectionCheck

    var body: some View {
        switch check {
        case .healthy(let roundTrip):
            ResultLabel(message: ConnectionCheck.describe(roundTrip), systemImage: "checkmark.circle.fill", color: .green)
        case .failed(let message):
            ResultLabel(message: message, systemImage: "xmark.octagon.fill", color: .red)
        case .idle, .running:
            EmptyView()
        }
    }
}
