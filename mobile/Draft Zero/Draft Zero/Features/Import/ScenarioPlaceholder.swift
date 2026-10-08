import Foundation

/// An import-time fill-in declared in a NovelAI scenario's text, written
/// `${1#id[default]Title:Description}`. Every part after the id is optional.
nonisolated struct ScenarioPlaceholder: Sendable, Hashable, Identifiable {
    var id: String
    /// Display order; placeholders without a numeric prefix sort last.
    var order: Int
    var defaultValue: String
    var title: String
    var description: String
}
