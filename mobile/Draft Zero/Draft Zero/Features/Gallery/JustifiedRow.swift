import Foundation

/// One row of the wall: every picture at the row's height, at its own width.
nonisolated struct JustifiedRow: Identifiable, Hashable, Sendable {
    struct Item: Hashable, Sendable {
        /// Position in the list the rows were made from.
        var index: Int
        var width: Double
    }

    var items: [Item]
    var height: Double

    var id: Int { items.first?.index ?? -1 }
}
