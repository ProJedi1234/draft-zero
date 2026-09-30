import Foundation

/// What the composer is armed to do. `image` is not an action: it never
/// becomes a passage. Mirrors `ComposerMode` in lib/types.ts.
nonisolated enum ComposerMode: String, Codable, Sendable, CaseIterable, Identifiable {
    case `do`
    case say
    case image

    var id: String { rawValue }

    var label: String {
        switch self {
        case .do: "Do"
        case .say: "Say"
        case .image: "Image"
        }
    }

    var systemImage: String {
        switch self {
        case .do: "figure.walk"
        case .say: "quote.bubble"
        case .image: "photo.badge.plus"
        }
    }

    var placeholder: String {
        switch self {
        case .do: "What do you do?"
        case .say: "What do you say?"
        case .image: "What's the picture? A few words is plenty…"
        }
    }

    /// The action this mode sends, or nil for image mode.
    var actionKind: ActionKind? {
        switch self {
        case .do: .do
        case .say: .say
        case .image: nil
        }
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ComposerMode(rawValue: raw) ?? .do
    }
}
