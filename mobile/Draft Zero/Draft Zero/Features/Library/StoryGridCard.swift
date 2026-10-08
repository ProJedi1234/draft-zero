import SwiftUI

/// A story in the regular-width grid, on its own tinted card.
struct StoryGridCard: View {
    let story: StoryRecord
    let excerpt: String?
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?

    var body: some View {
        NavigationLink(value: AppRoute.story(story.id)) {
            StoryRow(story: story, excerpt: excerpt, mark: mark, run: run, excerptLines: 3)
                .padding()
                .frame(maxHeight: .infinity, alignment: .top)
                .background {
                    StoryCardSurface(tint: story.tint)
                }
                .contentShape(.contextMenuPreview, .rect(cornerRadius: Theme.cornerRadius))
        }
        .buttonStyle(.plain)
        .storyActions(story)
    }
}
