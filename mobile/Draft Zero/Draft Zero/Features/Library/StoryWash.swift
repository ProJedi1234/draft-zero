import SwiftUI

/// A card's faint glow of its story's hue, strongest at the leading edge.
/// Nothing at all for an untinted story.
struct StoryWash: View {
    let tint: StoryTintValue

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if tint.chroma > 0 {
            let wash = StoryPalette.cardWash(tint, scheme: colorScheme)
            LinearGradient(
                stops: [
                    .init(color: wash, location: 0),
                    .init(color: wash.opacity(0), location: 0.85),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            .accessibilityHidden(true)
        }
    }
}
