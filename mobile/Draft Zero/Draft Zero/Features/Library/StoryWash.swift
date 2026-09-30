import SwiftUI

/// A card's faint glow of its story's hue, strongest at the leading edge, with
/// a thin spine along it. Nothing at all for an untinted story.
struct StoryWash: View {
    let tint: StoryTintValue

    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var spineWidth = 3.0

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
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(LibraryTint.spine(tint, scheme: colorScheme))
                    .frame(width: spineWidth)
            }
            .accessibilityHidden(true)
        }
    }
}
