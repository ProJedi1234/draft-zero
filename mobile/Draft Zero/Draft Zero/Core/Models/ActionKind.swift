import Foundation

/// The two moves a writer makes, typed in first person and stored in second.
nonisolated enum ActionKind: String, Codable, Sendable, Hashable {
    case say
    case `do`

    var label: String {
        switch self {
        case .say: "Say"
        case .do: "Do"
        }
    }
}
