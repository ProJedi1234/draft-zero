import Foundation

/// A story's atmosphere: a hue in degrees, or none, and how far toward it the
/// palette travels (0...1).
nonisolated struct StoryTintValue: Sendable, Hashable {
    var hue: Double?
    var strength: Double

    static let none = StoryTintValue(hue: nil, strength: 0)

    /// The chroma budget multiplier. Zero whenever the story is untinted.
    var chroma: Double {
        guard hue != nil else { return 0 }
        return min(max(strength, 0), 1)
    }

    /// One of the eight named atmospheres the picker offers. Mirrors STORY_TINTS in lib/story-tint.ts.
    struct Named: Sendable, Hashable, Identifiable {
        var id: String
        var label: String
        var hue: Double
        var strength: Double
        var value: StoryTintValue { StoryTintValue(hue: hue, strength: strength) }
    }

    static let named: [Named] = [
        Named(id: "ember", label: "Ember", hue: 25, strength: 1),
        Named(id: "amber", label: "Amber", hue: 60, strength: 1),
        Named(id: "sun", label: "Sun-gold", hue: 85, strength: 1),
        Named(id: "verdant", label: "Verdant", hue: 150, strength: 0.9),
        Named(id: "lagoon", label: "Lagoon", hue: 200, strength: 0.85),
        Named(id: "abyss", label: "Abyss", hue: 255, strength: 0.85),
        Named(id: "iris", label: "Iris", hue: 300, strength: 0.9),
        Named(id: "rose", label: "Rose", hue: 350, strength: 0.95),
    ]

    /// The named atmosphere this tint is, if it matches one.
    var namedTint: Named? {
        guard let hue else { return nil }
        return Self.named.first { abs($0.hue - hue) < 0.5 }
    }
}
