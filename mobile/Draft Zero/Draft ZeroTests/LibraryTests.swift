import Foundation
import Testing
@testable import Draft_Zero

struct LibraryListingTests {
    private func story(_ id: String, _ title: String, genre: String = "", description: String = "") -> StoryRecord {
        StoryRecord(
            id: id, title: title, description: description, genre: genre,
            createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
            wordCount: 0, tintHue: nil, tintStrength: 0, tintAuto: false
        )
    }

    private var stories: [StoryRecord] {
        [
            story("a", "The Salt Cartographer", genre: "Fantasy"),
            story("b", "Ninefold Orchard", genre: "Folk horror", description: "Nine trees, nine winters."),
            story("c", "Café Noir", genre: "Noir"),
        ]
    }

    @Test func theNewestStoryLeadsAndIsHeldOutOfTheList() {
        let listing = LibraryListing(stories: stories, query: "")
        #expect(listing.continueStory?.id == "a")
        #expect(listing.stories.map(\.id) == ["b", "c"])
        #expect(listing.count == 3)
        #expect(!listing.isSearching)
    }

    @Test func searchingMatchesTitleGenreAndDescription() {
        #expect(LibraryListing(stories: stories, query: "salt").stories.map(\.id) == ["a"])
        #expect(LibraryListing(stories: stories, query: "HORROR").stories.map(\.id) == ["b"])
        #expect(LibraryListing(stories: stories, query: "winters").stories.map(\.id) == ["b"])
        #expect(LibraryListing(stories: stories, query: "cafe").stories.map(\.id) == ["c"])
    }

    @Test func searchingStepsContinueAsideAndCountsMatches() {
        let listing = LibraryListing(stories: stories, query: "  noir ")
        #expect(listing.isSearching)
        #expect(listing.continueStory == nil)
        #expect(listing.count == 1)
        #expect(LibraryListing(stories: stories, query: "zzz").stories.isEmpty)
    }
}

struct StoryMetaTests {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func story(genre: String, words: Int) -> StoryRecord {
        StoryRecord(
            id: "s", title: "T", description: "", genre: genre,
            createdAt: now.ISO8601Format(), updatedAt: now.ISO8601Format(),
            wordCount: words, tintHue: nil, tintStrength: 0, tintAuto: false
        )
    }

    @Test func idleShowsGenreDateAndWords() {
        #expect(StoryMeta.line(for: story(genre: "Noir", words: 1234), mark: nil, runStartedAt: nil, now: now)
            == "Noir · today · 1,234 words")
        #expect(StoryMeta.line(for: story(genre: "", words: 0), mark: nil, runStartedAt: nil, now: now) == "today")
        #expect(StoryMeta.line(for: story(genre: "", words: 1), mark: nil, runStartedAt: nil, now: now) == "today · 1 word")
    }

    @Test func aRunReplacesGenreAndDate() {
        let started = now.addingTimeInterval(-74).ISO8601Format()
        let noir = story(genre: "Noir", words: 10)
        #expect(StoryMeta.line(for: noir, mark: .working, runStartedAt: started, now: now) == "writing · 1m 14s · 10 words")
        #expect(StoryMeta.line(for: noir, mark: .working, runStartedAt: nil, now: now) == "writing · 10 words")
        #expect(StoryMeta.line(for: noir, mark: .done, runStartedAt: nil, now: now) == "new passage · 10 words")
        #expect(StoryMeta.line(for: noir, mark: .failed, runStartedAt: nil, now: now) == "stopped · 10 words")
    }

    @Test func continueLineKeepsTheDate() {
        let noir = story(genre: "Noir", words: 10)
        #expect(StoryMeta.continueLine(for: noir, mark: .done, runStartedAt: nil, now: now) == "today · 10 words")
    }
}

struct LibraryPresentationTests {
    @Test func excerptSnippetsFoldParagraphs() {
        #expect(LibraryExcerpt.snippet("…ending withheld.\n\nThe path narrowed.\n") == "…ending withheld. The path narrowed.")
    }

    @Test func runDotsHopThenRest() {
        #expect(RunDots.lift(at: 0) == 0)
        #expect(abs(RunDots.lift(at: 0.35 * RunDots.period) - 1) < 0.0001)
        #expect(RunDots.lift(at: 0.9 * RunDots.period) == 0)
        #expect(abs(RunDots.lift(at: -0.65 * RunDots.period) - RunDots.lift(at: 0.35 * RunDots.period)) < 0.0001)
    }
}
