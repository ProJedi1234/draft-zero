import Foundation

/// Records what an autosaved value sends, and fails on demand.
final class WriteLog<Value: Sendable> {
    struct Write {
        var next: Value
        var previous: Value
    }

    private(set) var writes: [Write] = []
    var failure: Error?

    func record(_ next: Value, _ previous: Value) async throws {
        if let failure { throw failure }
        writes.append(Write(next: next, previous: previous))
    }
}
