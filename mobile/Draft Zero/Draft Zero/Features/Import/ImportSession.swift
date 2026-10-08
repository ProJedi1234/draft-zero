import Foundation
import Observation

/// One import from review to result: the placeholder answers, the write, and
/// its summary. Owned by the import sheet.
@Observable
final class ImportSession {
    enum Phase: Equatable {
        case reviewing
        case importing
        case imported(ImportSummary)
    }

    let content: ImportContent
    var fields: [PlaceholderField]
    private(set) var phase: Phase = .reviewing
    /// The server's refusal, shown over the review it refused.
    var failure: String?
    var isShowingFailure = false

    init(content: ImportContent) {
        self.content = content
        if case .scenario(_, let preview) = content {
            fields = preview.placeholders.map { PlaceholderField($0) }
        } else {
            fields = []
        }
    }

    var isImporting: Bool { phase == .importing }

    var placeholderValues: [String: String] {
        Dictionary(fields.map { ($0.id, $0.value) }, uniquingKeysWith: { first, _ in first })
    }

    /// The title as it will land, with the writer's answers filled in.
    var previewTitle: String {
        guard case .scenario(_, let preview) = content else { return content.title }
        let filled = ScenarioPlaceholders.fill(preview.title, values: placeholderValues)
        return ImportText.trimmed(filled).isEmpty ? preview.title : filled
    }

    /// Writes the import. The server re-reads the file rather than trusting
    /// this preview, so the request carries the raw bytes.
    func commit(using api: APIClient?) async {
        guard phase == .reviewing else { return }
        guard let api else {
            fail(APIError.notConfigured)
            return
        }
        phase = .importing
        do {
            let summary = switch content {
            case .scenario(let json, _):
                try await api.importScenario(json: json, placeholderValues: placeholderValues)
            case .storyCards(let json, _):
                try await api.importStoryCards(json: json)
            case .backup(let zip, _):
                try await api.importBackup(zip: zip)
            }
            phase = .imported(summary)
        } catch is CancellationError {
            phase = .reviewing
        } catch {
            fail(error)
        }
    }

    private func fail(_ error: Error) {
        phase = .reviewing
        failure = (error as? LocalizedError)?.errorDescription ?? "That import couldn't be completed. Nothing was saved."
        isShowingFailure = true
    }
}
