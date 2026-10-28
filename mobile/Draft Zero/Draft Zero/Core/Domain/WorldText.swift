import Foundation

nonisolated enum WorldText {
    static func limited(_ text: String, to limit: Int) -> String {
        var count = 0
        return String(text.prefix { character in
            count += character.utf16.count
            return count <= limit
        })
    }
}
