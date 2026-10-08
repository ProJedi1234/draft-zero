import SwiftUI

/// The colours a tinted story paints its room with, for one colour scheme.
/// Each recipe is the web's (app/globals.css): light mode tints the paper,
/// dark mode tints the shadow, and every recipe equals the neutral palette at
/// zero strength.
struct StoryPalette: Equatable {
    let background: Color
    let card: Color
    let secondary: Color
    let mutedForeground: Color
    let border: Color
    let accent: Color
    let ambientGlow: Color
    let ambientEdge: Color
    /// A saturated sample of the hue, for swatches and marks.
    let swatch: Color
    let isTinted: Bool

    init(tint: StoryTintValue, scheme: ColorScheme) {
        let c = tint.chroma
        let h = tint.hue ?? 0
        isTinted = c > 0
        swatch = OKLCH.color(scheme == .dark ? 0.72 : 0.62, 0.14 * max(c, 0.001), h)
        if scheme == .dark {
            background = OKLCH.color(0.145 + 0.035 * c, 0.05 * c, h)
            card = OKLCH.color(0.205 + 0.03 * c, 0.058 * c, h)
            secondary = OKLCH.color(0.269 + 0.02 * c, 0.075 * c, h)
            mutedForeground = OKLCH.color(0.708, 0.1 * c, h)
            border = OKLCH.color(1 - 0.16 * c, 0.13 * c, h, opacity: 0.1)
            accent = OKLCH.color(0.922 - 0.182 * c, 0.16 * c, h, opacity: 0.4 + 0.3 * c)
            ambientGlow = OKLCH.color(0.145 + 0.105 * c, 0.11 * c, h)
            ambientEdge = OKLCH.color(0.145 - 0.05 * c, 0.05 * c, h)
        } else {
            background = OKLCH.color(1 - 0.075 * c, 0.07 * c, h)
            card = OKLCH.color(1 - 0.062 * c, 0.06 * c, h)
            secondary = OKLCH.color(0.97 - 0.078 * c, 0.088 * c, h)
            mutedForeground = OKLCH.color(0.556, 0.11 * c, h)
            border = OKLCH.color(0.922 - 0.075 * c, 0.105 * c, h)
            accent = OKLCH.color(0.205 + 0.295 * c, 0.105 * c, h, opacity: 0.4 + 0.35 * c)
            ambientGlow = OKLCH.color(1 - 0.03 * c, 0.055 * c, h)
            ambientEdge = OKLCH.color(1 - 0.17 * c, 0.11 * c, h)
        }
    }

    /// A card's own wash in a list of stories: a faint glow of its hue.
    static func cardWash(_ tint: StoryTintValue, scheme: ColorScheme) -> Color {
        let c = tint.chroma
        let h = tint.hue ?? 0
        return scheme == .dark
            ? OKLCH.color(0.72, 0.14 * c, h, opacity: 0.2 * c)
            : OKLCH.color(0.55, 0.13 * c, h, opacity: 0.16 * c)
    }
}
