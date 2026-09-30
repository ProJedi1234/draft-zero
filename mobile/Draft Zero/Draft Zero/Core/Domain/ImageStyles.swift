import Foundation

/// Art direction, and the one place it is joined to a scene. A port of
/// lib/images/styles.ts.
nonisolated enum ImageStyles {
    struct Preset: Sendable, Hashable, Identifiable {
        var id: String
        var label: String
        /// The clause appended to the scene.
        var text: String
    }

    static let presets: [Preset] = [
        Preset(id: "photographic", label: "Photographic", text: "photographic, natural light, shallow depth of field"),
        Preset(id: "cinematic", label: "Cinematic film still", text: "cinematic film still, anamorphic, moody colour grade"),
        Preset(id: "oil", label: "Oil painting", text: "oil painting, visible brushwork, warm varnish"),
        Preset(id: "watercolour", label: "Watercolour", text: "watercolour, soft washes, paper grain"),
        Preset(id: "ink", label: "Ink sketch", text: "ink sketch, loose crosshatching, off-white paper"),
        Preset(id: "anime", label: "Anime", text: "anime, clean linework, cel shading"),
        Preset(id: "storybook", label: "Storybook illustration", text: "storybook illustration, flat colour, hand-drawn outlines"),
        Preset(id: "noir", label: "Noir", text: "black and white noir, hard key light, deep shadow"),
    ]

    /// The preset whose text this style is, if any.
    static func preset(for style: String?) -> Preset? {
        guard let style else { return nil }
        return presets.first { $0.text == style }
    }

    /// The scene plus the style, as one string for the image model.
    static func compose(scene: String, style: String?) -> String {
        let body = scene.trimmingCharacters(in: .whitespacesAndNewlines)
        var direction = (style ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        while let last = direction.last, last == "." || last == "。" {
            direction.removeLast()
        }
        if direction.isEmpty { return body }
        if body.isEmpty { return "Style: \(direction)." }
        return "\(body) Style: \(direction)."
    }

    /// The inverse of `compose`, as far as one is possible: only a final
    /// sentence beginning "Style: " is peeled off.
    static func split(_ prompt: String) -> (scene: String, style: String?) {
        let range = NSRange(prompt.startIndex..., in: prompt)
        guard let match = stylePattern.firstMatch(in: prompt, range: range),
              let whole = Range(match.range, in: prompt),
              let captured = Range(match.range(at: 1), in: prompt)
        else {
            return (prompt.trimmingCharacters(in: .whitespacesAndNewlines), nil)
        }
        let style = prompt[captured].trimmingCharacters(in: .whitespacesAndNewlines)
        return (
            String(prompt[..<whole.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines),
            style.isEmpty ? nil : style
        )
    }

    private static let stylePattern: NSRegularExpression = {
        do {
            return try NSRegularExpression(pattern: #"\s*Style:\s*([^.]*)\.\s*$"#)
        } catch {
            fatalError("Invalid style pattern: \(error)")
        }
    }()
}
