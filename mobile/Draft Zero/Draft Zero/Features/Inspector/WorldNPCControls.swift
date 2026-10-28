import Foundation
import Observation

@Observable
final class WorldNPCControls {
    let mind: AutosavingField<String>
    var memory = ""
    var importance = 3
    var isAdding = false

    init(npc: WorldNPC, world: WorldModel) {
        let id = npc.id
        mind = AutosavingField(
            npc.mind, version: world.version, onFailure: .keepEdit,
            read: { [weak world] in
                guard let world, let npc = world.state?.npcs.first(where: { $0.id == id }) else { return nil }
                return (npc.mind, world.version)
            },
            persist: { [weak world] text in
                await world?.patch([["type": "set-mind", "loreEntryId": .string(id), "mind": .string(text)]]) ?? false
            }
        )
    }

    func addMemory(npcId: String, world: WorldModel) {
        guard !isAdding else { return }
        isAdding = true
        let op: JSONObject = [
            "type": "add-memory", "loreEntryId": .string(npcId),
            "memory": .object(["id": .string(UUID().uuidString), "text": .string(memory), "importance": .number(Double(importance))]),
        ]
        Task {
            if await world.patch([op]) { memory = ""; importance = 3 }
            isAdding = false
        }
    }
}
