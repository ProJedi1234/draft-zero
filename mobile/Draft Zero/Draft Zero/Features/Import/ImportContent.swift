import Foundation

/// A picked file, read and recognised: the bytes the server will re-read, and
/// the preview shown before anything is written.
nonisolated enum ImportContent: Sendable {
    case scenario(json: String, preview: ScenarioPreview)
    case storyCards(json: String, preview: StoryCardsPreview)
    case backup(zip: Data, preview: BackupPreview)

    var title: String {
        switch self {
        case .scenario(_, let preview): preview.title
        case .storyCards(_, let preview): preview.title
        case .backup(_, let preview): preview.title
        }
    }

    var warnings: [String] {
        switch self {
        case .scenario(_, let preview): preview.warnings
        case .storyCards(_, let preview): preview.warnings
        case .backup(_, let preview): preview.warnings
        }
    }

    var tags: [String] {
        switch self {
        case .scenario(_, let preview): preview.tags
        case .storyCards(_, let preview): preview.tags
        case .backup(_, let preview): preview.tags
        }
    }

    /// What kind of file this turned out to be, for the sheet's eyebrow.
    var formatName: String {
        switch self {
        case .scenario: "NovelAI scenario"
        case .storyCards: "AI Dungeon story cards"
        case .backup: "AI Dungeon backup"
        }
    }
}
