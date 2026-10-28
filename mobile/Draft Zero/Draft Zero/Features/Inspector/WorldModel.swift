import Foundation
import Observation

@Observable
final class WorldModel {
    private(set) var state: WorldState?
    private(set) var failure: String?
    private(set) var revision = 0
    private(set) var pendingStrikes: Set<String> = []
    private(set) var controls: [String: WorldNPCControls] = [:]
    private(set) var clock: WorldClockControls?
    let storyId: String
    private let api: APIClient
    let notices: NoticeCenter
    @ObservationIgnored private var request = 0
    @ObservationIgnored private var writeTail: Task<Bool, Never>?

    var version: String { String(format: "%020d", revision) }

    init(storyId: String, api: APIClient, notices: NoticeCenter) {
        self.storyId = storyId
        self.api = api
        self.notices = notices
    }

    func load() async {
        request += 1
        let own = request
        do {
            let state = try await api.world(storyId: storyId)
            guard !Task.isCancelled, own == request else { return }
            receive(state)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, own == request else { return }
            failure = error.localizedDescription
        }
    }

    func patch(_ ops: [JSONObject]) async -> Bool {
        let previous = writeTail
        let next = Task {
            if let previous { _ = await previous.value }
            request += 1
            let own = request
            do {
                let state = try await api.patchWorld(storyId: storyId, ops: ops)
                // A read that started meanwhile may hold newer state, so re-read
                // instead of letting this response overwrite it.
                if own == request { receive(state) } else { await load() }
                return true
            } catch {
                notices.error(error, fallback: "Couldn't save the world.")
                return false
            }
        }
        writeTail = next
        return await next.value
    }

    func strike(_ memory: WorldMemory, npcId: String) {
        guard pendingStrikes.insert(memory.id).inserted else { return }
        // Undo cancels the write, preserving the memory's original day and passage.
        let task = Task {
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled else { return }
            _ = await patch([["type": "strike-memory", "loreEntryId": .string(npcId), "memoryId": .string(memory.id)]])
            pendingStrikes.remove(memory.id)
        }
        notices.info("Memory struck.", actionTitle: "Undo") {
            task.cancel()
            self.pendingStrikes.remove(memory.id)
        }
    }

    func flush() async {
        for control in controls.values { await control.mind.flush() }
    }

    private func receive(_ state: WorldState) {
        self.state = state
        failure = nil
        revision += 1
        if clock == nil {
            clock = WorldClockControls(minutes: state.minutes, version: version) { [weak self] ops in
                await self?.patch(ops) ?? false
            }
        }
        clock?.receive(minutes: state.minutes, version: version)
        for npc in state.npcs {
            if controls[npc.id] == nil { controls[npc.id] = WorldNPCControls(npc: npc, world: self) }
            controls[npc.id]?.mind.pull()
        }
    }
}
