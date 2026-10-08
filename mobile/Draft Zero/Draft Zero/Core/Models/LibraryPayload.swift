import Foundation

/// What the library reads beyond the story list, from GET /api/library.
nonisolated struct LibraryPayload: Codable, Sendable {
    /// The tail of each story's newest passage, keyed by story id.
    var excerpts: [String: String]
    var railImages: [GalleryImage]
    /// Text and image runs alike.
    var activeRuns: [ActiveRun]
}
