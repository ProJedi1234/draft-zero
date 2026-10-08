import SwiftUI

/// The rounded card a story sits on outside a list: the grouped surface with
/// its tint washed over it.
struct StoryCardSurface: View {
    let tint: StoryTintValue

    var body: some View {
        RoundedRectangle(cornerRadius: Theme.cornerRadius)
            .fill(.background.secondary)
            .overlay {
                StoryWash(tint: tint)
                    .clipShape(.rect(cornerRadius: Theme.cornerRadius))
            }
    }
}
