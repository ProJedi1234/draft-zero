import SwiftUI

/// The room's light: a glow from the top and a vignette at the edges, in the
/// story's hue. At zero strength every stop is the plain background.
struct StoryAmbientBackground: View {
    let tint: StoryTintValue

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let palette = StoryPalette(tint: tint, scheme: colorScheme)
        ZStack {
            palette.background
            RadialGradient(
                colors: [palette.ambientGlow, palette.background.opacity(0)],
                center: .top,
                startRadius: 0,
                endRadius: 520
            )
            EllipticalGradient(
                colors: [palette.background.opacity(0), palette.ambientEdge],
                center: .center,
                startRadiusFraction: 0.45,
                endRadiusFraction: 0.95
            )
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.5), value: tint)
    }
}
