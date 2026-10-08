import Foundation
import GRDB
import os

/// What this device keeps between launches: the library, the stories opened
/// most recently, and each composer as it was left. The native counterpart of
/// lib/store/persistence.ts.
///
/// Everything here except an unsent draft is a copy of server truth, so a
/// failed read or write costs one fetch and nothing more. Rows hold JSON whole
/// because nothing queries inside them. Writes queue in call order on the
/// database's own queue and are never awaited; reads queue behind them, so a
/// read always sees every write made before it.
nonisolated final class LocalStore: Sendable {
    /// What the library last showed.
    nonisolated struct Library: Sendable {
        var stories: [StoryRecord]
        var excerpts: [String: String]
        var railImages: [GalleryImage]
    }

    /// What this device kept of one story.
    nonisolated struct SavedStory: Sendable {
        /// The workspace response, byte for byte as the server sent it.
        var workspace: Data?
        var draft: LocalDraft?
    }

    nonisolated private struct LibraryExtras: Codable, Sendable {
        var excerpts: [String: String]
        var railImages: [GalleryImage]
    }

    /// Workspaces kept, most recently saved first. Matches WORKSPACE_CACHE_LIMIT on the web.
    static let workspaceLimit = 20

    private static let log = Logger(subsystem: "Draft Zero", category: "LocalStore")

    private let db: DatabaseQueue

    init(_ db: DatabaseQueue) throws {
        self.db = db
        try Self.migrator.migrate(db)
    }

    /// The app's store in Application Support, or nil when it can't be opened.
    /// Not Caches: the system may empty that, and an unsent draft lives here.
    static func openDefault() -> LocalStore? {
        do {
            let folder = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
            )
            return try open(at: folder.appending(path: "LocalStore.sqlite"))
        } catch {
            log.error("Couldn't open the local store: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    static func open(at file: URL) throws -> LocalStore {
        try LocalStore(DatabaseQueue(path: file.path(percentEncoded: false)))
    }

    static func inMemory() throws -> LocalStore {
        try LocalStore(DatabaseQueue())
    }

    private static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.execute(sql: """
                CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                CREATE TABLE story (id TEXT PRIMARY KEY NOT NULL, version TEXT NOT NULL, json BLOB NOT NULL);
                CREATE TABLE workspace (storyId TEXT PRIMARY KEY NOT NULL, savedAt REAL NOT NULL, json BLOB NOT NULL);
                CREATE TABLE draft (storyId TEXT PRIMARY KEY NOT NULL, json BLOB NOT NULL);
                """)
        }
        return migrator
    }

    // MARK: - Server

    /// Points the store at a server. Rows kept for any other server are erased.
    func bind(to server: URL) {
        write { db in
            let held = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'server'")
            guard held != server.absoluteString else { return }
            try Self.eraseRows(db)
            try db.execute(
                sql: "INSERT INTO meta (key, value) VALUES ('server', ?)",
                arguments: [server.absoluteString]
            )
        }
    }

    func erase() {
        write { db in try Self.eraseRows(db) }
    }

    private static func eraseRows(_ db: Database) throws {
        try db.execute(sql: "DELETE FROM meta; DELETE FROM story; DELETE FROM workspace; DELETE FROM draft;")
    }

    // MARK: - Library

    /// The library as it was last saved, or nil when nothing was.
    func library() async -> Library? {
        do {
            return try await db.read { db in
                let decoder = JSONDecoder()
                // A row an older build wrote may no longer decode; it is a miss, not an error.
                let stories = try Data.fetchAll(db, sql: "SELECT json FROM story")
                    .compactMap { try? decoder.decode(StoryRecord.self, from: $0) }
                let extras = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'library'")
                    .flatMap { try? decoder.decode(LibraryExtras.self, from: Data($0.utf8)) }
                if stories.isEmpty && extras == nil { return nil }
                return Library(
                    stories: stories,
                    excerpts: extras?.excerpts ?? [:],
                    railImages: extras?.railImages ?? []
                )
            }
        } catch {
            Self.log.error("Couldn't read the library: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    /// Replaces every story row with the server's whole list, and forgets the
    /// workspaces and drafts of stories no longer on it.
    func saveStories(_ records: [StoryRecord]) {
        write { db in
            try db.execute(sql: "DELETE FROM story")
            for record in records { try Self.put(record, db) }
            try db.execute(sql: """
                DELETE FROM workspace WHERE storyId NOT IN (SELECT id FROM story);
                DELETE FROM draft WHERE storyId NOT IN (SELECT id FROM story);
                """)
        }
    }

    /// Keeps a row unless the one held is newer.
    func upsertStory(_ record: StoryRecord) {
        write { db in try Self.put(record, db) }
    }

    /// Forgets a story: its row, its workspace and its draft.
    func deleteStory(_ storyId: String) {
        write { db in
            try db.execute(sql: "DELETE FROM story WHERE id = ?", arguments: [storyId])
            try db.execute(sql: "DELETE FROM workspace WHERE storyId = ?", arguments: [storyId])
            try db.execute(sql: "DELETE FROM draft WHERE storyId = ?", arguments: [storyId])
        }
    }

    func saveLibraryExtras(excerpts: [String: String], railImages: [GalleryImage]) {
        write { db in
            let json = try JSONEncoder().encode(LibraryExtras(excerpts: excerpts, railImages: railImages))
            try db.execute(
                sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('library', ?)",
                arguments: [String(decoding: json, as: UTF8.self)]
            )
        }
    }

    private static func put(_ record: StoryRecord, _ db: Database) throws {
        try db.execute(
            sql: """
                INSERT INTO story (id, version, json) VALUES (?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET version = excluded.version, json = excluded.json
                WHERE excluded.version >= story.version
                """,
            arguments: [record.id, record.updatedAt, try JSONEncoder().encode(record)]
        )
    }

    // MARK: - Stories

    func savedStory(_ storyId: String) async -> SavedStory {
        do {
            return try await db.read { db in
                let workspace = try Data.fetchOne(
                    db, sql: "SELECT json FROM workspace WHERE storyId = ?", arguments: [storyId]
                )
                let draft = try Data.fetchOne(db, sql: "SELECT json FROM draft WHERE storyId = ?", arguments: [storyId])
                    .flatMap { try? JSONDecoder().decode(LocalDraft.self, from: $0) }
                return SavedStory(workspace: workspace, draft: draft)
            }
        } catch {
            Self.log.error("Couldn't read a saved story: \(String(describing: error), privacy: .public)")
            return SavedStory()
        }
    }

    /// Keeps a workspace response, dropping the least recently saved past the limit.
    func saveWorkspace(_ storyId: String, json: Data, savedAt: Date = .now) {
        write { db in
            try db.execute(
                sql: "INSERT OR REPLACE INTO workspace (storyId, savedAt, json) VALUES (?, ?, ?)",
                arguments: [storyId, savedAt.timeIntervalSince1970, json]
            )
            try db.execute(
                sql: "DELETE FROM workspace WHERE storyId NOT IN (SELECT storyId FROM workspace ORDER BY savedAt DESC LIMIT ?)",
                arguments: [Self.workspaceLimit]
            )
        }
    }

    func deleteWorkspace(_ storyId: String) {
        write { db in
            try db.execute(sql: "DELETE FROM workspace WHERE storyId = ?", arguments: [storyId])
        }
    }

    func saveDraft(_ storyId: String, _ draft: LocalDraft) {
        write { db in
            try db.execute(
                sql: "INSERT OR REPLACE INTO draft (storyId, json) VALUES (?, ?)",
                arguments: [storyId, try JSONEncoder().encode(draft)]
            )
        }
    }

    // MARK: - Plumbing

    private func write(_ updates: @escaping @Sendable (Database) throws -> Void) {
        db.asyncWrite(updates) { _, result in
            if case .failure(let error) = result {
                Self.log.error("A local store write failed: \(String(describing: error), privacy: .public)")
            }
        }
    }
}
