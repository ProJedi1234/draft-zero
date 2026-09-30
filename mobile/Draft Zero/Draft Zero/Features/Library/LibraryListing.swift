import Foundation

/// What the library shows for a search: the story to continue, and the list
/// under it. Searching turns the page into results, so Continue steps aside
/// and the held-out story becomes findable by name again.
struct LibraryListing {
    /// The most recently updated story, when not searching.
    let continueStory: StoryRecord?
    /// Every story the list shows, newest first.
    let stories: [StoryRecord]
    /// Matches while searching; the whole library otherwise.
    let count: Int
    let isSearching: Bool

    init(stories all: [StoryRecord], query: String) {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        isSearching = !needle.isEmpty
        if isSearching {
            continueStory = nil
            stories = all.filter { Self.matches($0, needle) }
            count = stories.count
        } else {
            continueStory = all.first
            stories = Array(all.dropFirst())
            count = all.count
        }
    }

    static func matches(_ story: StoryRecord, _ needle: String) -> Bool {
        story.title.localizedStandardContains(needle)
            || story.genre.localizedStandardContains(needle)
            || story.description.localizedStandardContains(needle)
    }
}
