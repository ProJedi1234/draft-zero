import Foundation
import Observation
import SwiftUI

/// The settings screen's data: the payload from GET /api/settings, the
/// account's retention verdicts, the in-place editors, and the profile list's
/// writes. Follows the server through sync events without clobbering edits.
@Observable
final class SettingsStore {
    private(set) var payload: SettingsPayload?
    /// The profiles in the order shown; ahead of the server while a reorder travels.
    private(set) var profiles: [ModelProfile] = []
    private(set) var editors: SettingsEditors?
    private(set) var policies = AccountZdrPolicies.unknown
    private(set) var loadError: String?
    let activity = SaveActivity()

    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var notices: NoticeCenter?
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var refreshRequested = false
    @ObservationIgnored private var reordersInFlight = 0

    /// Binds the store to a server; a different server starts from scratch.
    func attach(api: APIClient?, notices: NoticeCenter) {
        self.notices = notices
        guard api?.baseURL != self.api?.baseURL else { return }
        self.api = api
        payload = nil
        profiles = []
        editors = nil
        policies = .unknown
        loadError = nil
    }

    var isLoaded: Bool { payload != nil }

    var defaultProfileId: String? {
        payload?.settings.defaultProfileId
    }

    func followers(of profileId: String) -> Int {
        payload?.followerCounts[profileId] ?? 0
    }

    /// The first load, and the one after returning to the screen.
    func load() async {
        async let verdicts: Void = loadPolicies()
        await refreshNow()
        await verdicts
    }

    private func loadPolicies() async {
        guard let api else { return }
        // Unknown locks nothing, so a failed probe needs no message.
        if let raw = try? await api.accountZdrPolicies() {
            policies = AccountZdrPolicies(raw)
        }
    }

    /// Coalesces a burst of change events into one read.
    func scheduleRefresh() {
        refreshRequested = true
        guard refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            while let store = self {
                try? await Task.sleep(for: .milliseconds(250))
                guard store.refreshRequested else { break }
                store.refreshRequested = false
                await store.refreshNow()
            }
            self?.refreshTask = nil
        }
    }

    func refreshNow() async {
        guard let api else { return }
        let settledBefore = activity.settledWrites
        do {
            let next = try await api.settingsPayload()
            // A write that landed mid-read may be missing from this answer; its
            // own change event brings a newer one.
            guard settledBefore == activity.settledWrites, !activity.isBusy else {
                scheduleRefresh()
                return
            }
            apply(next, api: api)
            loadError = nil
        } catch is CancellationError {
            return
        } catch {
            if payload == nil {
                loadError = (error as? LocalizedError)?.errorDescription ?? "Couldn't load settings."
            }
        }
    }

    private func apply(_ next: SettingsPayload, api: APIClient) {
        payload = next
        if reordersInFlight == 0 {
            profiles = next.profiles.sorted { $0.sortOrder < $1.sortOrder }
        }
        if let editors {
            editors.receive(next.settings)
        } else {
            editors = SettingsEditors(settings: next.settings, api: api, activity: activity)
        }
    }

    /// Global changes move settings, profiles and follower counts alike.
    func handle(_ event: SyncWireEvent) {
        switch event {
        case .change(storyId: .none):
            scheduleRefresh()
        case .entity(let entity) where entity.entity == "model-profile" || entity.entity == "app-settings":
            scheduleRefresh()
        default:
            break
        }
    }

    // MARK: - Profiles

    func moveProfiles(from source: IndexSet, to destination: Int) {
        let previous = profiles
        profiles.move(fromOffsets: source, toOffset: destination)
        let orderedIds = profiles.map(\.id)
        guard orderedIds != previous.map(\.id), let api else { return }
        reordersInFlight += 1
        Task {
            do {
                try await activity.track { try await api.reorderProfiles(orderedIds) }
                reordersInFlight -= 1
            } catch let error as APIError where error.isConflict {
                reordersInFlight -= 1
                notices?.info("The profile list changed on another device, so it was reloaded.")
                await refreshNow()
            } catch {
                reordersInFlight -= 1
                profiles = previous
                notices?.error(error, fallback: "Couldn't reorder the profiles.")
            }
        }
    }

    func makeDefault(_ profile: ModelProfile) {
        guard let api, profile.id != defaultProfileId else { return }
        Task {
            do {
                try await activity.track { try await api.setDefaultProfile(profile.id) }
                await refreshNow()
            } catch {
                notices?.error(error, fallback: "Couldn't change the default profile.")
            }
        }
    }

    func delete(_ profile: ModelProfile) {
        guard let api, profile.id != defaultProfileId else { return }
        let previous = profiles
        profiles.removeAll { $0.id == profile.id }
        Task {
            do {
                try await activity.track { try await api.deleteProfile(profile.id) }
                await refreshNow()
            } catch {
                profiles = previous
                notices?.error(error, fallback: "Couldn't delete the profile.")
            }
        }
    }

    /// Creates or updates from the editor, then promotes it if asked. Throws
    /// so the editor can keep the sheet open and say what went wrong.
    func save(_ draft: ProfileDraft, settings: ProfileSettings, target: ProfileEditorTarget) async throws {
        guard let api else { throw APIError.notConfigured }
        let name = draft.trimmedName
        let profileId: String
        if target.mode == .edit, let existing = target.profile {
            let patch = try JSONValue.encoding(settings)
            guard case .object(let fields) = patch else { throw APIError.decoding("Profile settings are not an object.") }
            try await activity.track { try await api.updateProfile(existing.id, name: name, settings: fields) }
            profileId = existing.id
        } else {
            profileId = try await activity.track { try await api.createProfile(name: name, settings: settings) }
        }
        if draft.makeDefault, profileId != defaultProfileId {
            do {
                try await activity.track { try await api.setDefaultProfile(profileId) }
            } catch {
                // The profile itself saved; only the promotion failed.
                notices?.error(error, fallback: "Saved, but couldn't make it the default.")
            }
        }
        await refreshNow()
    }
}
