import SwiftUI

/// The library card's edge mark in its story's hue: the web's `.story-card`
/// spine, the same colour as the wash at a stronger alpha.
enum LibraryTint {
    static func spine(_ tint: StoryTintValue, scheme: ColorScheme) -> Color {
        let c = tint.chroma
        let h = tint.hue ?? 0
        return scheme == .dark
            ? OKLCH.color(0.72, 0.14 * c, h, opacity: 0.8 * c)
            : OKLCH.color(0.55, 0.13 * c, h, opacity: 0.75 * c)
    }
}
