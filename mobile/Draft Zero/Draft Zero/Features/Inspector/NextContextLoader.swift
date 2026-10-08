import Foundation
import Observation

/// What the next passage would be sent, for the status strip's meter. Keeps
/// the last answer on screen while a fresh one loads, so the meter doesn't
/// blink every time the story saves.
@Observable
final class NextContextLoader {
    private(set) var context: EntryContext?
    private(set) var isLoading = false
    private(set) var failure: String?

    @ObservationIgnored private let storyId: String
    @ObservationIgnored private let api: APIClient

    init(storyId: String, api: APIClient) {
        self.storyId = storyId
        self.api = api
    }

    /// Call from `.task(id:)`, keyed on whatever changes the context.
    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let next = try await api.nextContext(storyId: storyId)
            context = next
            failure = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            failure = (error as? LocalizedError)?.errorDescription ?? "Couldn't measure the context."
        }
    }
}
