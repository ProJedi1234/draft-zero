import Foundation
import Observation
import SwiftUI

/// App-wide state: which server this device talks to, the sync channel, the
/// library, and where navigation is.
@Observable
final class AppModel {
    enum Connection: Equatable {
        /// No server has been chosen yet.
        case unconfigured
        case connecting
        case online
        case offline(String)
    }

    private static let serverURLKey = "serverURL"

    /// This launch's identity on the sync channel; our own echoes carry it.
    let origin = RandomID.origin()
    let sync = SyncChannel()
    let library = LibraryStore()
    let notices = NoticeCenter()
    /// What this device keeps between launches; nil when the store can't open.
    let local: LocalStore?

    private(set) var serverURL: URL?
    private(set) var api: APIClient?
    private(set) var connection: Connection = .unconfigured

    var selectedTab: AppTab = .library
    var libraryPath: [AppRoute] = []

    @ObservationIgnored private var librarySubscription: SyncSubscription?
    @ObservationIgnored private var reconnectSubscription: SyncSubscription?

    init(local: LocalStore? = LocalStore.openDefault()) {
        self.local = local
        if let saved = UserDefaults.standard.string(forKey: Self.serverURLKey),
           let url = URL(string: saved) {
            use(url)
        }
        applyLaunchArguments()
    }

    /// Test hooks: `-initialTab settings` selects a tab and `-openStory <id>`
    /// pushes a story, so a simulator run can land on any screen. A launch
    /// argument `-serverURL <url>` is read above through the argument domain.
    private func applyLaunchArguments() {
        let defaults = UserDefaults.standard
        if let tab = defaults.string(forKey: "initialTab").flatMap(AppTab.init(rawValue:)) {
            selectedTab = tab
        }
        if let storyId = defaults.string(forKey: "openStory") {
            libraryPath = [.story(storyId)]
            if defaults.bool(forKey: "openLorebook") {
                libraryPath.append(.lorebook(storyId))
            }
        }
    }

    // MARK: - Server

    /// Checks a server answers before saving it as this device's server.
    func connect(to url: URL) async throws {
        let candidate = APIClient(baseURL: url, origin: origin)
        guard try await candidate.health() else {
            throw APIError.http(status: 503, message: "That server isn't healthy.")
        }
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverURLKey)
        use(url)
    }

    /// Forgets the server and everything this device kept of it; the app returns to setup.
    func disconnect() {
        UserDefaults.standard.removeObject(forKey: Self.serverURLKey)
        local?.erase()
        sync.stop()
        librarySubscription = nil
        reconnectSubscription = nil
        api = nil
        serverURL = nil
        connection = .unconfigured
        libraryPath = []
        selectedTab = .library
    }

    private func use(_ url: URL) {
        let client = APIClient(baseURL: url, origin: origin)
        serverURL = url
        api = client
        connection = .connecting
        local?.bind(to: url)
        library.attach(api: client, local: local)
        librarySubscription = sync.subscribe { [weak self] event in
            self?.library.handle(event)
        }
        reconnectSubscription = sync.onReconnect { [weak self] in
            self?.library.scheduleRefresh()
        }
        sync.start(api: client)
        Task { await self.library.restore() }
        Task { await self.library.load() }
    }

    /// Normalises what someone types into a server address.
    static func serverURL(from input: String) -> URL? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "http://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text), url.host() != nil else { return nil }
        return url
    }

    // MARK: - Lifecycle

    func scenePhaseChanged(_ phase: ScenePhase) {
        guard api != nil else { return }
        switch phase {
        case .active:
            sync.wake()
            library.scheduleRefresh()
        case .background:
            sync.stop()
        default:
            break
        }
    }

    /// Mirrors the sync channel's state into the connection the UI shows.
    var effectiveConnection: Connection {
        guard api != nil else { return .unconfigured }
        switch sync.state {
        case .open: return .online
        case .idle, .connecting: return library.isLive ? .online : .connecting
        case .retrying(let attempt):
            return attempt >= 2 ? .offline("Can't reach the server. Retrying…") : .connecting
        }
    }

    // MARK: - Navigation

    func openStory(_ storyId: String) {
        selectedTab = .library
        libraryPath = [.story(storyId)]
    }

    func openLorebook(_ storyId: String) {
        selectedTab = .library
        if libraryPath.last == .story(storyId) {
            libraryPath.append(.lorebook(storyId))
        } else {
            libraryPath = [.story(storyId), .lorebook(storyId)]
        }
    }
}
