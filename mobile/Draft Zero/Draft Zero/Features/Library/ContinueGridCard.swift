import SwiftUI

/// The Continue card on its own surface, for the regular-width layout.
struct ContinueGridCard: View {
    let story: StoryRecord
    let excerpt: String?
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?

    @Environment(AppModel.self) private var app

    var body: some View {
        Button(action: open) {
            ContinueCard(story: story, excerpt: excerpt, mark: mark, run: run)
                .padding(20)
                .background {
                    StoryCardSurface(tint: story.tint)
                }
                .contentShape(.contextMenuPreview, .rect(cornerRadius: Theme.cornerRadius))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the story")
        .storyActions(story)
    }

    private func open() {
        app.libraryPath.append(.story(story.id))
    }
}
