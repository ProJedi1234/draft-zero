import Foundation
import Observation

/// Every picture on the gallery wall, kept fresh from the server and the sync
/// channel.
@Observable
final class GalleryModel {
    private(set) var images: [GalleryImage] = []
    private(set) var isLoaded = false
    private(set) var loadError: APIError?

    /// The pictures the wall shows: every one whose file still exists.
    var visible: [GalleryImage] { images.filter { $0.missing != true } }

    /// Pictures whose file is gone, which the toolbar alert lists instead.
    var missingImages: [GalleryImage] { images.filter { $0.missing == true } }

    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var subscriptions: [SyncSubscription] = []
    @ObservationIgnored private lazy var coalescer = RefreshCoalescer { [weak self] in
        await self?.reload()
    }

    /// Points the model at a server, dropping what a previous one showed.
    func attach(api: APIClient?) {
        self.api = api
        images = []
        isLoaded = false
        loadError = nil
    }

    /// Starts listening for changes; the screen calls this while it is visible.
    func start(sync: SyncChannel) {
        stop()
        subscriptions = [
            sync.subscribe { [weak self] event in self?.handle(event) },
            sync.onReconnect { [weak self] in self?.scheduleRefresh() },
        ]
    }

    func stop() {
        subscriptions.forEach { $0.release() }
        subscriptions = []
        coalescer.cancel()
    }

    func scheduleRefresh() {
        coalescer.request()
    }

    /// Reads the wall. A failure is kept only while there is nothing to show,
    /// so a refresh that fails leaves the pictures on screen.
    func reload() async {
        guard let api else { return }
        do {
            images = try await api.gallery()
            isLoaded = true
            loadError = nil
        } catch is CancellationError {
            return
        } catch {
            if !isLoaded {
                loadError = error as? APIError ?? .transport(error.localizedDescription)
            }
        }
    }

    func handle(_ event: SyncWireEvent) {
        switch event {
        case .change, .runEnded:
            scheduleRefresh()
        case .entity(let entity) where entity.entity == "story":
            scheduleRefresh()
        default:
            break
        }
    }

    /// Makes a take the slot's active one on the server, then folds it into
    /// the wall so the tile changes at once.
    func useTake(_ take: ImageTake, in slot: LightboxSlot) async throws {
        guard let api, let storyId = slot.storyId else { throw APIError.notConfigured }
        try await api.selectImage(storyId: storyId, imageGroupId: slot.id, imageId: take.id)
        if let index = images.firstIndex(where: { $0.imageGroupId == slot.id }),
           let updated = images[index].selecting(take) {
            images[index] = updated
        }
        scheduleRefresh()
    }
}
