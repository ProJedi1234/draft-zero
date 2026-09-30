import Foundation
import Observation

/// Mirrors a story's live prompt develop, whoever started it. A port of
/// `useImagePromptDerivation` in hooks/use-image-generation.ts.
///
/// A develop is a paid call, so it only ever starts from an explicit tap. It is
/// a detached run on the server; its settled prompt comes back as a `draft`
/// event the run itself publishes. `deriving` is true on every device while it
/// runs, which is what locks the brief everywhere.
@Observable
final class DerivationController {
    private(set) var deriving = false
    /// Which brief the live or most recent run is answering.
    private(set) var derivedBrief: String?
    /// The mutes that brief was asked under.
    private(set) var derivedExcludedLoreIds: [String]?

    @ObservationIgnored weak var composer: ComposerModel?
    @ObservationIgnored private let storyId: String
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let notices: NoticeCenter
    @ObservationIgnored private var watcher: Task<Void, Never>?
    /// True while this device launched the run being watched.
    @ObservationIgnored private var launched = false
    @ObservationIgnored private var watchedRunId: String?

    private static let retryBackoff: [Duration] = [.seconds(1), .seconds(2), .seconds(5)]

    init(storyId: String, api: APIClient, notices: NoticeCenter) {
        self.storyId = storyId
        self.api = api
        self.notices = notices
    }

    /// Launches a develop. An empty brief describes the story as it stands.
    func develop(brief: String, excludedLoreIds: [String]) {
        launched = true
        derivedBrief = brief
        derivedExcludedLoreIds = excludedLoreIds
        deriving = true
        composer?.derivationText("")
        Task {
            do {
                let runId = try await api.startDerive(storyId: storyId, brief: brief, excludedLoreIds: excludedLoreIds)
                // Our own launch's bus echo may already have attached us.
                if watchedRunId != runId { watch(runId) }
            } catch is CancellationError {
            } catch {
                launched = false
                // A refusal can mean another device won the race and we are
                // already watching its run; only fold the lane if we are not.
                guard watchedRunId == nil else { return }
                notices.error(error, fallback: "Couldn't write a prompt for this scene.")
                deriving = false
                composer?.derivationDiscarded(persist: true)
                composer?.derivationEnded(brief: derivedBrief, excludedLoreIds: derivedExcludedLoreIds)
            }
        }
    }

    func attach(_ runId: String?) {
        if let runId, watchedRunId == runId { return }
        watch(runId)
    }

    func detach() {
        watcher?.cancel()
        watcher = nil
    }

    private func watch(_ runId: String?) {
        watcher?.cancel()
        watchedRunId = runId
        watcher = Task { [weak self] in
            await self?.follow(runId)
        }
    }

    private func follow(_ runId: String?) async {
        var currentRunId = runId
        var text = ""
        var attempt = 0
        while !Task.isCancelled {
            let stream: AsyncThrowingStream<DeriveRunWireEvent, Error>?
            do {
                stream = try await api.subscribeDeriveRun(storyId: storyId, runId: currentRunId)
            } catch {
                if Task.isCancelled { return }
                try? await Task.sleep(for: Self.retryBackoff[min(attempt, Self.retryBackoff.count - 1)])
                attempt += 1
                continue
            }
            guard let stream else {
                // Nothing developing: unlock. A settled prompt arrived as a draft event.
                if !Task.isCancelled, !launched || runId != nil, deriving {
                    deriving = false
                    composer?.derivationEnded(brief: derivedBrief, excludedLoreIds: derivedExcludedLoreIds)
                }
                return
            }
            do {
                for try await event in stream {
                    if Task.isCancelled { return }
                    switch event {
                    case .frame(let frame):
                        currentRunId = frame.runId
                        watchedRunId = frame.runId
                        text = frame.text
                        derivedBrief = frame.brief
                        derivedExcludedLoreIds = frame.excludedLoreIds
                        deriving = true
                        composer?.derivationText(text)
                    case .text(let value):
                        text += value
                        composer?.derivationText(text)
                    case .end(let end):
                        let wasLaunched = launched
                        launched = false
                        watchedRunId = nil
                        if end.status == .error {
                            notices.error(end.error ?? "Couldn't write a prompt for this scene.")
                        }
                        // The end frame's text outranks anything accumulated across a re-attach.
                        if end.status == .ok, !end.text.isEmpty {
                            composer?.derivationSettled(end.text)
                        } else {
                            composer?.derivationDiscarded(persist: wasLaunched)
                        }
                        deriving = false
                        composer?.derivationEnded(brief: derivedBrief, excludedLoreIds: derivedExcludedLoreIds)
                        return
                    case .ping, .unknown:
                        continue
                    }
                }
            } catch {
                if Task.isCancelled { return }
            }
            attempt += 1
        }
    }
}
