import SwiftUI

/// A story in the phone list, washed in its hue from the cell's leading edge,
/// opening the story on tap with its actions on a long press or a swipe.
struct StoryListRow: View {
    let story: StoryRecord
    let excerpt: String?
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?

    var body: some View {
        NavigationLink(value: AppRoute.story(story.id)) {
            StoryRow(story: story, excerpt: excerpt, mark: mark, run: run)
                .padding(.vertical, 12)
                .padding(.leading)
                .background {
                    StoryWash(tint: story.tint)
                }
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] + 16 }
        }
        // The wash has to start at the cell's edge, so the row pads itself.
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 16))
        .storyActions(story)
    }
}
