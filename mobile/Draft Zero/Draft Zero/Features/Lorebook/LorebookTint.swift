import SwiftUI

/// The lorebook's share of the story's colour: a softer room than the story
/// screen's, since this is a reference page read in dense rows.
nonisolated enum LorebookTint {
    /// The ambient wash at half the story's strength.
    static func wash(_ tint: StoryTintValue) -> StoryTintValue {
        StoryTintValue(hue: tint.hue, strength: tint.strength * 0.5)
    }

    /// An accent in the story's hue; nil for an untinted story, which keeps the
    /// system accent. It both colours text on cards and fills selected rows
    /// under white text, so its lightness sits where the system blue does.
    static func accent(_ tint: StoryTintValue, scheme: ColorScheme) -> Color? {
        guard let hue = tint.hue, tint.chroma > 0 else { return nil }
        return OKLCH.color(scheme == .dark ? 0.62 : 0.5, 0.13 * max(tint.chroma, 0.5), hue)
    }
}
