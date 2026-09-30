import SwiftUI

/// The compact layout: the story to continue, the recent pictures, then every
/// other story as a list row with swipe actions.
struct LibraryList: View {
    let listing: LibraryListing

    @Environment(AppModel.self) private var app
    @Environment(LibraryStore.self) private var library

    var body: some View {
        List {
            if let story = listing.continueStory {
                Section {
                    ContinueListRow(
                        story: story,
                        excerpt: library.excerpts[story.id],
                        mark: library.runMark(for: story.id),
                        run: library.activeRun(for: story.id)
                    )
                } header: {
                    LibrarySectionHeader("Continue")
                }
            }
            if !listing.isSearching, !library.railImages.isEmpty {
                Section {
                    PictureRail(images: library.railImages, onOpenStory: openStory)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                } header: {
                    LibrarySectionHeader("Recent Pictures") {
                        GalleryLinkButton()
                    }
                }
            }
            if !listing.stories.isEmpty {
                Section {
                    ForEach(listing.stories) { story in
                        StoryListRow(
                            story: story,
                            excerpt: library.excerpts[story.id],
                            mark: library.runMark(for: story.id),
                            run: library.activeRun(for: story.id)
                        )
                    }
                } header: {
                    LibrarySectionHeader(listing.isSearching ? "Results" : "Stories") {
                        StoryCountText(count: listing.count)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func openStory(_ storyId: String) {
        app.libraryPath.append(.story(storyId))
    }
}
