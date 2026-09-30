import Foundation

/// Controls written by one request, resolved together when it answers:
/// settled if the server took it, put back if not.
struct SyncedWriteBatch {
    private var finishers: [(Bool) -> Void] = []

    var isEmpty: Bool { finishers.isEmpty }

    /// Moves a control to `next`. A value the row already holds needs no resolving.
    mutating func stage<Value>(_ field: ServerSyncedValue<Value>, _ next: Value) {
        let previous = field.server
        guard field.write(next) else { return }
        finishers.append { succeeded in
            if succeeded {
                field.settle()
            } else {
                field.reset(to: previous)
            }
        }
    }

    func finish(_ succeeded: Bool) {
        for finisher in finishers {
            finisher(succeeded)
        }
    }
}
