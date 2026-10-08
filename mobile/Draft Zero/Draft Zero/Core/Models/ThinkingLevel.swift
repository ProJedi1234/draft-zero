import Foundation

/// How hard a model thinks before writing, or not at all. Mirrors
/// `ThinkingLevel` in lib/types.ts.
nonisolated enum ThinkingLevel: String, Codable, Sendable, CaseIterable, Identifiable {
    case off, minimal, low, medium, high, xhigh, max

    var id: String { rawValue }

    var label: String {
        switch self {
        case .off: "Off"
        case .minimal: "Minimal"
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        case .xhigh: "Extra high"
        case .max: "Max"
        }
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ThinkingLevel(rawValue: raw) ?? .off
    }
}
