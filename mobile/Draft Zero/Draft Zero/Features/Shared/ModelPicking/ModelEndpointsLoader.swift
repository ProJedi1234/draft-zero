import Foundation
import Observation

/// The upstream endpoints serving one model, for the provider picker and for
/// anything that clamps to a pinned endpoint's window.
///
/// Holds the model each list belongs to, so a late answer for a model the
/// writer has already left is dropped instead of offering the wrong providers.
@Observable
final class ModelEndpointsLoader {
    private(set) var modelId: String?
    private(set) var isLoading = false
    private var loaded: [ModelEndpoint] = []
    @ObservationIgnored private var cache: [String: [ModelEndpoint]] = [:]

    /// The list for `modelId`, or empty while it loads, fails, or belongs to another model.
    func endpoints(for modelId: String) -> [ModelEndpoint] {
        self.modelId == modelId ? loaded : []
    }

    /// True once an answer for `modelId` is in, empty or not.
    func hasLoaded(_ modelId: String) -> Bool {
        self.modelId == modelId && !isLoading
    }

    /// Loads once per model per loader; call it from `.task(id: modelId)`.
    func load(_ modelId: String, api: APIClient?) async {
        if let cached = cache[modelId] {
            self.modelId = modelId
            loaded = cached
            isLoading = false
            return
        }
        guard let api else { return }
        self.modelId = modelId
        loaded = []
        isLoading = true
        do {
            let endpoints = try await api.modelEndpoints(modelId: modelId)
            guard self.modelId == modelId else { return }
            cache[modelId] = endpoints
            loaded = endpoints
            isLoading = false
        } catch is CancellationError {
            // A cancelled load leaves nothing cached, so the next visit asks again.
            if self.modelId == modelId { isLoading = false }
        } catch {
            // Silence is the message: Auto still works, and the row says there is no choice.
            guard self.modelId == modelId else { return }
            loaded = []
            isLoading = false
        }
    }
}
