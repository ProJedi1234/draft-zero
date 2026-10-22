import SwiftUI

extension View {
    /// Tints controls in the story's hue, so a tinted room's buttons belong to
    /// it. An untinted story keeps the app's accent.
    func storyActionTint(_ tint: StoryTintValue) -> some View {
        modifier(StoryActionTint(tint: tint))
    }
}

private struct StoryActionTint: ViewModifier {
    let tint: StoryTintValue

    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.tint(StoryPalette.action(tint, scheme: colorScheme) ?? .accentColor)
    }
}
