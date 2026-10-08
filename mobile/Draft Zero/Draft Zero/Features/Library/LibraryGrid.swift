import SwiftUI

/// The regular-width layout: the same three parts as the phone list, with
/// the stories in an adaptive grid of cards.
struct LibraryGrid: View {
    let listing: LibraryListing

    @Environment(AppModel.self) private var app
    @Environment(LibraryStore.self) private var library
    @ScaledMetric(relativeTo: .body) private var minimumColumn = 300.0

    /// Wide enough for three cards, narrow enough that a row still reads as one.
    private static let contentWidth = 1100.0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                if let story = listing.continueStory {
                    VStack(alignment: .leading, spacing: 12) {
                        LibrarySectionHeader("Continue")
                            .font(.title3.bold())
                        ContinueGridCard(
                            story: story,
                            excerpt: library.excerpts[story.id],
                            mark: library.runMark(for: story.id),
                            run: library.activeRun(for: story.id)
                        )
                    }
                }
                if !listing.isSearching, !library.railImages.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        LibrarySectionHeader("Recent Pictures") {
                            GalleryLinkButton()
                        }
                        .font(.title3.bold())
                        PictureRail(images: library.railImages, onOpenStory: openStory)
                    }
                }
                if !listing.stories.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        LibrarySectionHeader(listing.isSearching ? "Results" : "Stories") {
                            StoryCountText(count: listing.count)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                        .font(.title3.bold())
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimumColumn), spacing: 16)], spacing: 16) {
                            ForEach(listing.stories) { story in
                                StoryGridCard(
                                    story: story,
                                    excerpt: library.excerpts[story.id],
                                    mark: library.runMark(for: story.id),
                                    run: library.activeRun(for: story.id)
                                )
                            }
                        }
                    }
                }
            }
            .padding()
            .frame(maxWidth: Self.contentWidth)
            .frame(maxWidth: .infinity)
        }
    }

    private func openStory(_ storyId: String) {
        app.libraryPath.append(.story(storyId))
    }
}
