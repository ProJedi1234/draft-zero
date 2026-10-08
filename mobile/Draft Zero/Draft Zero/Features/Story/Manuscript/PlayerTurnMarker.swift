import SwiftUI

/// The rule down the leading edge of the writer's own moves, in the story's accent.
struct PlayerTurnMarker: ViewModifier {
    let tint: StoryTintValue

    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(.leading, 14)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(tint.hue == nil ? Color.accentColor.opacity(0.5) : StoryPalette(tint: tint, scheme: colorScheme).accent)
                    .frame(width: 3)
            }
    }
}
