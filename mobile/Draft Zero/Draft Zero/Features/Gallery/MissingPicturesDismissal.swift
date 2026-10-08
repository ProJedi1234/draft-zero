import Foundation

/// When the gallery's missing-pictures alert shows. Dismissing remembers the
/// ids it covered, and the alert returns only when a picture outside that set
/// goes missing. Mirrors components/gallery/missing-pictures.tsx.
nonisolated enum MissingPicturesDismissal {
    /// The stored form: ids joined by newlines, which `@AppStorage` can hold.
    static func encode(_ ids: [String]) -> String {
        ids.joined(separator: "\n")
    }

    static func decode(_ stored: String) -> Set<String> {
        Set(stored.split(separator: "\n").map(String.init))
    }

    static func shouldAlert(missing: [GalleryImage], dismissed stored: String) -> Bool {
        let dismissed = decode(stored)
        return missing.contains { !dismissed.contains($0.id) }
    }
}
