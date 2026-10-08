import SwiftUI

/// The move the writer just sent, shown until its persisted row arrives. It
/// dims only while the server has yet to accept it.
struct EchoBlockView: View {
    let text: String
    let pending: Bool
    let tint: StoryTintValue

    var body: some View {
        ProseText(text: text)
            .modifier(PlayerTurnMarker(tint: tint))
            .opacity(pending ? 0.5 : 1)
            .animation(.easeOut(duration: 0.2), value: pending)
            .accessibilityHint(pending ? "Sending" : "")
    }
}
