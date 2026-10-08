import SwiftUI

/// The live state of this device's link to the server, as a dot and a word.
struct ConnectionStatusLabel: View {
    let connection: AppModel.Connection

    var body: some View {
        HStack(spacing: 6) {
            switch connection {
            case .online:
                StatusDot(color: .green)
                Text("Connected")
            case .connecting:
                ProgressView()
                    .controlSize(.mini)
                Text("Connecting…")
            case .offline:
                StatusDot(color: .orange)
                Text("Offline")
            case .unconfigured:
                StatusDot(color: .secondary)
                Text("Not set up")
            }
        }
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }
}
