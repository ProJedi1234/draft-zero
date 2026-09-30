import Foundation

/// A lorebook entry's narrative role. Rows that predate the enum may carry
/// other strings; they read as `concept`, as the web filter does.
nonisolated enum LorebookCategory: String, Codable, Sendable, CaseIterable, Identifiable {
    case character, `class`, location, faction, item, event, concept

    var id: String { rawValue }

    var label: String {
        switch self {
        case .character: "Character"
        case .class: "Class"
        case .location: "Location"
        case .faction: "Faction"
        case .item: "Item"
        case .event: "Event"
        case .concept: "Concept"
        }
    }

    var pluralLabel: String {
        switch self {
        case .character: "Characters"
        case .class: "Classes"
        case .location: "Locations"
        case .faction: "Factions"
        case .item: "Items"
        case .event: "Events"
        case .concept: "Concepts"
        }
    }

    var systemImage: String {
        switch self {
        case .character: "person"
        case .class: "shield.lefthalf.filled"
        case .location: "map"
        case .faction: "flag"
        case .item: "cube"
        case .event: "calendar"
        case .concept: "lightbulb"
        }
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LorebookCategory(rawValue: raw) ?? .concept
    }
}
