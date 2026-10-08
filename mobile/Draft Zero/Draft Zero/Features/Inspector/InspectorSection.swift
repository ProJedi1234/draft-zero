import Foundation

/// The inspector's three segments, in the order a writer asks: what the model
/// reads, what runs it, and what got pulled in.
enum InspectorSection: String, CaseIterable, Identifiable {
    case prompt
    case model
    case lore

    var id: String { rawValue }

    var title: String {
        switch self {
        case .prompt: "Prompt"
        case .model: "Model"
        case .lore: "Lore"
        }
    }
}
