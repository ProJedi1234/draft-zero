import Foundation

/// One story's lorebook rows as this device knows them, merged with the web
/// store's rules (lib/store/store.ts): last writer wins on `updatedAt`, a
/// delete leaves a tombstone that outranks older upserts, and a complete read
/// only sweeps rows it could have seen.
nonisolated struct LorebookLedger: Sendable, Equatable {
    struct Held: Sendable, Equatable {
        var entry: LorebookEntry
        /// Stamped at adoption, so a snapshot issued earlier cannot sweep it.
        var ingestSeq: Int
    }

    struct Tombstone: Sendable, Equatable {
        /// The delete's clock, or nil while this device's own delete is in flight
        /// and every upsert must lose.
        var version: String?
    }

    private(set) var rows: [String: Held] = [:]
    private(set) var tombstones: [String: Tombstone] = [:]
    private(set) var ingestSeq = 0

    var entries: [LorebookEntry] { rows.values.map(\.entry) }
    var ids: Set<String> { Set(rows.keys) }

    func entry(_ id: String) -> LorebookEntry? {
        rows[id]?.entry
    }

    /// A sync event or a write's reply. Adopted only when strictly newer.
    @discardableResult
    mutating func upsert(_ entry: LorebookEntry) -> Bool {
        if isBuried(entry) { return false }
        if let held = rows[entry.id], entry.updatedAt <= held.entry.updatedAt { return false }
        adopt(entry)
        return true
    }

    /// A delete event, or this device's confirmed delete.
    mutating func delete(_ id: String, version: String) {
        rows[id] = nil
        if let existing = tombstones[id]?.version, existing > version { return }
        tombstones[id] = Tombstone(version: version)
    }

    /// Hides a row while this device's delete is in flight; returns it for a rollback.
    mutating func beginDelete(_ id: String) -> LorebookEntry? {
        let removed = rows.removeValue(forKey: id)?.entry
        tombstones[id] = Tombstone(version: nil)
        return removed
    }

    /// Puts back a row whose delete failed.
    mutating func cancelDelete(_ id: String, restoring entry: LorebookEntry?) {
        tombstones[id] = nil
        if let entry { adopt(entry) }
    }

    /// A complete read of the story's lore. Rows adopt at `>=`; held rows the read
    /// did not return are swept unless learned after `issuedAt` or protected.
    /// Returns the ids swept.
    @discardableResult
    mutating func applySnapshot(
        _ snapshot: [LorebookEntry],
        issuedAt issueSeq: Int,
        protecting protectedIds: Set<String> = []
    ) -> Set<String> {
        for entry in snapshot where !isBuried(entry) {
            if let held = rows[entry.id], entry.updatedAt < held.entry.updatedAt { continue }
            if rows[entry.id]?.entry == entry { continue }
            adopt(entry)
        }
        let returned = Set(snapshot.map(\.id))
        var swept: Set<String> = []
        for (id, held) in rows where !returned.contains(id) {
            if protectedIds.contains(id) || held.ingestSeq > issueSeq { continue }
            swept.insert(id)
        }
        for id in swept {
            delete(id, version: rows[id]?.entry.updatedAt ?? "")
        }
        return swept
    }

    private func isBuried(_ entry: LorebookEntry) -> Bool {
        guard let tombstone = tombstones[entry.id] else { return false }
        guard let version = tombstone.version else { return true }
        return version >= entry.updatedAt
    }

    private mutating func adopt(_ entry: LorebookEntry) {
        ingestSeq += 1
        rows[entry.id] = Held(entry: entry, ingestSeq: ingestSeq)
        if tombstones[entry.id]?.version != nil { tombstones[entry.id] = nil }
    }
}
