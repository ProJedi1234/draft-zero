import Foundation

/// The line under a story's title. A story doing something says so, and that
/// replaces the genre and date; the word count stays, since it is the one fact
/// about the manuscript rather than about right now. Mirrors the web's cards.
enum StoryMeta {
    static func line(
        for story: StoryRecord,
        mark: LibraryStore.RunMark?,
        runStartedAt: String?,
        now: Date = .now
    ) -> String {
        let head = switch mark {
        case .working: writing(since: runStartedAt, now: now)
        case .done: "new passage"
        case .failed: "stopped"
        case nil: [story.genre, Format.relativeDate(story.updatedAt, now: now)]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        }
        return withWords(head, story)
    }

    /// The Continue card's line: what the story is doing, or when it last moved.
    static func continueLine(
        for story: StoryRecord,
        mark: LibraryStore.RunMark?,
        runStartedAt: String?,
        now: Date = .now
    ) -> String {
        let head = mark == .working
            ? writing(since: runStartedAt, now: now)
            : Format.relativeDate(story.updatedAt, now: now)
        return withWords(head, story)
    }

    private static func writing(since start: String?, now: Date) -> String {
        guard let start else { return "writing" }
        return "writing · \(Format.elapsed(since: start, now: now))"
    }

    private static func withWords(_ head: String, _ story: StoryRecord) -> String {
        guard story.wordCount > 0 else { return head }
        return head.isEmpty ? Format.wordCount(story.wordCount) : "\(head) · \(Format.wordCount(story.wordCount))"
    }
}
