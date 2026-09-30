import SwiftUI

/// The number beside the Stories heading.
struct StoryCountText: View {
    let count: Int

    var body: some View {
        Text(count, format: .number)
            .monospacedDigit()
            .accessibilityLabel("^[\(count) story](inflect: true)")
    }
}
