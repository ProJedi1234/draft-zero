import Observation
import UIKit

/// Mirrors a story's live illustration run, whoever started it. A port of
/// `useImageGeneration` in hooks/use-image-generation.ts.
///
/// The draw is a detached task on the server; leaving the story leaves it
/// running, and only `stop()` aborts it, from any device.
@Observable
final class IllustrationController {
    /// What the live edge of the manuscript shows while a picture is drawn.
    struct Job: Equatable {
        var runId: String
        var aspectRatio: ImageAspectRatio
        var prompt: String
        /// The sharpest partial so far.
        var preview: UIImage?
        /// Set once the row is committed; the job is held until the workspace carries it.
        var landedImageId: String?
        /// When this device first saw the draw, to recognise its row if the story refresh wins the race.
        var seenAt = Date.now

        static func == (lhs: Job, rhs: Job) -> Bool {
            lhs.runId == rhs.runId && lhs.aspectRatio == rhs.aspectRatio
                && lhs.preview === rhs.preview && lhs.landedImageId == rhs.landedImageId
        }
    }

    /// What the composer hands over when the writer sends a picture.
    struct Request {
        var prompt: String
        var sourcePrompt: String?
        var promptLoreIds: [String]
        var aspectRatio: ImageAspectRatio
        /// Set only by a retry: the slot the new draw joins.
        var imageGroupId: String?
        /// Set only by the retry menu: this draw's model.
        var modelId: String?
    }

    private(set) var job: Job?

    @ObservationIgnored weak var workspace: StoryWorkspace?
    @ObservationIgnored private let storyId: String
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let notices: NoticeCenter
    @ObservationIgnored private var watcher: Task<Void, Never>?
    /// The words behind a draw this device sent, handed back if nothing lands.
    @ObservationIgnored private var heldPrompt: (prompt: String, sourcePrompt: String?)?
    @ObservationIgnored private var settleFallback: Task<Void, Never>?

    private static let retryBackoff: [Duration] = [.seconds(1), .seconds(2), .seconds(5)]

    init(storyId: String, api: APIClient, notices: NoticeCenter) {
        self.storyId = storyId
        self.api = api
        self.notices = notices
    }

    var isBusy: Bool { job != nil }

    func generate(_ request: Request) {
        heldPrompt = (request.prompt, request.sourcePrompt)
        Task {
            do {
                let runId = try await api.startIllustration(
                    storyId: storyId,
                    prompt: request.prompt,
                    sourcePrompt: request.sourcePrompt,
                    promptLoreIds: request.promptLoreIds,
                    aspectRatio: request.aspectRatio,
                    imageGroupId: request.imageGroupId,
                    modelId: request.modelId
                )
                // Reserved before the first frame, so nothing moves when it arrives.
                job = Job(runId: runId, aspectRatio: request.aspectRatio, prompt: request.prompt)
                watch(runId)
            } catch is CancellationError {
            } catch {
                notices.error(error, fallback: "Couldn't generate that illustration.")
                restoreHeldPrompt()
            }
        }
    }

    /// Attach to a draw another device started, or probe with nil.
    func attach(_ runId: String?) {
        if let runId, job?.runId == runId { return }
        watch(runId)
    }

    /// Any device may stop a draw; the end frame clears the job everywhere.
    func stop() {
        let runId = job?.runId
        Task { [api, storyId, notices] in
            do {
                try await api.stopIllustration(storyId: storyId, runId: runId)
            } catch is CancellationError {
            } catch {
                notices.error(error, fallback: "Couldn't stop the illustration.")
            }
        }
    }

    func detach() {
        watcher?.cancel()
        watcher = nil
        settleFallback?.cancel()
    }

    /// Retires a job whose picture the workspace now carries. The refreshed story
    /// can arrive before the end frame names the row, so a new picture with this
    /// draw's prompt, made since the draw began, counts as landed too.
    func settle(images: [StoryImage]) {
        guard let job else { return }
        let landed = job.landedImageId.map { id in images.contains { $0.id == id } } ?? false
        let matched = job.landedImageId == nil && images.contains { image in
            image.prompt == job.prompt
                && (ISODate.parse(image.createdAt) ?? .distantPast) >= job.seenAt.addingTimeInterval(-5)
        }
        guard landed || matched else { return }
        self.job = nil
        settleFallback?.cancel()
    }

    private func watch(_ runId: String?) {
        watcher?.cancel()
        watcher = Task { [weak self] in
            await self?.follow(runId)
        }
    }

    private func follow(_ runId: String?) async {
        var currentRunId = runId
        var attempt = 0
        while !Task.isCancelled {
            let stream: AsyncThrowingStream<ImageRunWireEvent, Error>?
            do {
                stream = try await api.subscribeImageRun(storyId: storyId, runId: currentRunId)
            } catch {
                if Task.isCancelled { return }
                try? await Task.sleep(for: Self.retryBackoff[min(attempt, Self.retryBackoff.count - 1)])
                attempt += 1
                continue
            }
            guard let stream else {
                // Nothing drawing, and nothing lingering under that id.
                if !Task.isCancelled, job?.landedImageId == nil { job = nil }
                return
            }
            do {
                for try await event in stream {
                    if Task.isCancelled { return }
                    switch event {
                    case .frame(let frame):
                        currentRunId = frame.runId
                        job = Job(runId: frame.runId, aspectRatio: frame.aspectRatio, prompt: frame.prompt)
                        if let preview = frame.previewB64 {
                            await showPreview(preview, mediaType: frame.previewMediaType, runId: frame.runId)
                        }
                    case .partial(let b64, let mediaType):
                        if let runId = currentRunId {
                            await showPreview(b64, mediaType: mediaType, runId: runId)
                        }
                    case .end(let end):
                        finish(end)
                        return
                    case .ping, .unknown:
                        continue
                    }
                }
            } catch {
                if Task.isCancelled { return }
            }
            // Dropped without an end frame: re-attach to the same run.
            attempt += 1
        }
    }

    private func showPreview(_ base64: String, mediaType: String?, runId: String) async {
        guard let image = await ImageLoader.decodePreview(base64: base64, mediaType: mediaType) else { return }
        guard job?.runId == runId else { return }
        job?.preview = image
    }

    private func finish(_ end: ImageRunWireEvent.End) {
        if end.status == .ok, let imageId = end.imageId {
            // Held until the refreshed workspace carries the row, so the
            // picture never blinks out and back.
            heldPrompt = nil
            job?.landedImageId = imageId
            Task { await workspace?.refreshNow() }
            settleFallback?.cancel()
            settleFallback = Task { [weak self] in
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, let self, self.job?.landedImageId == imageId else { return }
                self.job = nil
            }
        } else {
            if end.status == .error {
                notices.error(end.error ?? "Couldn't generate that illustration.")
            }
            job = nil
            restoreHeldPrompt()
        }
    }

    private func restoreHeldPrompt() {
        guard let held = heldPrompt else { return }
        heldPrompt = nil
        workspace?.restoreImagePrompt(prompt: held.prompt, sourcePrompt: held.sourcePrompt)
    }
}
