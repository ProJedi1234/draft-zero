import SwiftUI

/// The Continue card as the phone list's first row.
struct ContinueListRow: View {
    let story: StoryRecord
    let excerpt: String?
    let mark: LibraryStore.RunMark?
    let run: ActiveRun?

    @Environment(AppModel.self) private var app

    var body: some View {
        Button(action: open) {
            ContinueCard(story: story, excerpt: excerpt, mark: mark, run: run)
                // A list row button paints its label in the tint; this is prose.
                .foregroundStyle(Color.primary)
                .padding(.vertical, 16)
                .padding(.horizontal)
                .background {
                    StoryWash(tint: story.tint)
                }
                .contentShape(.rect)
        }
        .listRowInsets(EdgeInsets())
        .accessibilityHint("Opens the story")
        .storyActions(story)
    }

    private func open() {
        app.libraryPath.append(.story(story.id))
    }
}
