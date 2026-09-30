import UniformTypeIdentifiers

/// The three things the Import menu offers. The choice only narrows the file
/// picker; the file's contents decide how it is read.
enum ImportKind: String, CaseIterable, Identifiable {
    case scenario
    case storyCards
    case backup

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scenario: "NovelAI Scenario"
        case .storyCards: "AI Dungeon Story Cards"
        case .backup: "AI Dungeon Backup"
        }
    }

    var subtitle: String {
        switch self {
        case .scenario: "A .scenario file, as a new story"
        case .storyCards: "A card export (.json), as a lorebook"
        case .backup: "A whole adventure (.zip)"
        }
    }

    var systemImage: String {
        switch self {
        case .scenario: "doc.text"
        case .storyCards: "rectangle.stack"
        case .backup: "archivebox"
        }
    }

    var contentTypes: [UTType] {
        switch self {
        case .scenario:
            if let scenario = UTType(filenameExtension: "scenario", conformingTo: .data) {
                [scenario, .json]
            } else {
                [.json]
            }
        case .storyCards:
            [.json]
        case .backup:
            [.zip]
        }
    }
}
