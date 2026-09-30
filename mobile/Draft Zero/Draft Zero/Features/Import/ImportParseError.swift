import Foundation

/// Why a picked file can't be previewed. `recognised` separates "this file
/// isn't mine" from "this is mine, and it's broken", which is how the picker
/// decides which reader's complaint to show (see lib/import/aidungeon.ts).
nonisolated struct ImportParseError: LocalizedError, Equatable, Sendable {
    var recognised: Bool
    var message: String

    var errorDescription: String? { message }
}
