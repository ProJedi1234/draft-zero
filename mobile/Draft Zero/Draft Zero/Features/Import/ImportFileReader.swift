import Foundation

/// Reads a picked file and works out which of the three formats it is. The
/// writer never has to say: an archive is sniffed by its magic bytes, and the
/// two JSON formats are offered to each reader in turn until one claims it.
nonisolated enum ImportFileReader {
    /// The JSON formats' ceiling on the server; a backup's is `BackupReader.maxBytes`.
    static let maxJSONBytes = 1024 * 1024

    /// Reads a security-scoped URL from the file importer, off the main actor.
    @concurrent
    static func read(_ url: URL) async throws -> ImportContent {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }

        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > BackupReader.maxBytes {
            throw ImportParseError(recognised: false, message: "That file is too large to import.")
        }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw ImportParseError(recognised: false, message: "That file couldn't be read. Try picking it again.")
        }
        return try content(of: data).get()
    }

    static func content(of data: Data) -> Result<ImportContent, ImportParseError> {
        // No fallback to the JSON readers: nothing starting "PK" parses as either,
        // and offering it would replace the archive reader's real error.
        if ZipArchive.isZip(data) {
            return BackupReader.parse(data).map { .backup(zip: data, preview: $0) }
        }
        guard data.count <= maxJSONBytes else {
            return .failure(ImportParseError(recognised: false, message: "That file is too large to be an export."))
        }

        var text = String(decoding: data, as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }

        let cardsError: ImportParseError
        switch StoryCardsReader.parse(text) {
        case .success(let preview):
            return .success(.storyCards(json: text, preview: preview))
        case .failure(let error):
            cardsError = error
        }
        // A card file that failed to read is not offered to the scenario
        // reader, which would accept it on its `prompt` and drop every card.
        if cardsError.recognised { return .failure(cardsError) }

        switch ScenarioReader.parse(text) {
        case .success(let preview):
            return .success(.scenario(json: text, preview: preview))
        case .failure(let scenarioError):
            let looksLikeCards = !scenarioError.recognised
                && text.drop(while: \.isWhitespace).hasPrefix("[")
            return .failure(looksLikeCards ? cardsError : scenarioError)
        }
    }
}
