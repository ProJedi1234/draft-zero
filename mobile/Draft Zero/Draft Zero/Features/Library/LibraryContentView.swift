import SwiftUI

/// The loaded library: searchable, pulled to refresh, laid out for the width.
struct LibraryContentView: View {
    @Environment(LibraryStore.self) private var library
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""

    var body: some View {
        let listing = LibraryListing(stories: library.stories, query: query)
        Group {
            if listing.isSearching, listing.stories.isEmpty {
                ContentUnavailableView.search
            } else if sizeClass == .regular {
                LibraryGrid(listing: listing)
            } else {
                LibraryList(listing: listing)
            }
        }
        .searchable(text: $query, prompt: "Search stories")
        .refreshable {
            await library.refreshNow()
        }
    }
}
