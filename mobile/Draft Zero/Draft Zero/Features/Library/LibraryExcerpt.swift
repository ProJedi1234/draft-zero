import Foundation

/// Prose fitted to a row: paragraph breaks that read well on the Continue
/// card waste a row's two lines on blank space. Used for excerpts and for
/// descriptions, which imports often fill with a whole opening.
enum LibraryExcerpt {
    static func snippet(_ excerpt: String) -> String {
        excerpt
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
