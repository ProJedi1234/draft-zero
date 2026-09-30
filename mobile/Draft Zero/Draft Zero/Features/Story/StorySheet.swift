import Foundation

/// The sheets the story screen presents.
enum StorySheet: String, Identifiable {
    case details
    case cost

    var id: String { rawValue }
}
