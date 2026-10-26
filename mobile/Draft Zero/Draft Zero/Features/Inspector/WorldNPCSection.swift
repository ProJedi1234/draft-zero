import SwiftUI

struct WorldNPCSection: View {
    let npc: WorldNPC
    @Bindable var controls: WorldNPCControls
    let world: WorldModel
    let isKeyboardUp: Bool

    var body: some View {
        Section {
            WorldMindField(field: controls.mind, isKeyboardUp: isKeyboardUp)
            VStack(alignment: .leading, spacing: 12) {
                Text("Memories").font(.subheadline)
                if npc.memories.isEmpty { Text("Nothing yet").foregroundStyle(.secondary) }
                ForEach(npc.memories.reversed().filter { !world.pendingStrikes.contains($0.id) }) { memory in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("day \(WorldClock.day(memory.minutes)) · \(String(repeating: "●", count: memory.importance))\(String(repeating: "○", count: 5 - memory.importance))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("day \(WorldClock.day(memory.minutes)), importance \(memory.importance) of 5")
                            Spacer()
                            Button("Strike") { world.strike(memory, npcId: npc.id) }
                                // Form's automatic row action would fire every Strike in this row.
                                .buttonStyle(.borderless)
                                .font(.caption)
                                .accessibilityLabel("Strike memory: \(memory.text)")
                        }
                        Text(memory.text)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Add memory").font(.subheadline)
                TextField("Add memory", text: $controls.memory, prompt: Text("What did they witness?"), axis: .vertical)
                    .lineLimit(2...6)
                    .disabled(controls.isAdding)
                    .accessibilityLabel("Add memory")
                Stepper("Importance: \(controls.importance)", value: $controls.importance, in: 1...5)
                    .disabled(controls.isAdding)
                Button("Add memory") { controls.addMemory(npcId: npc.id, world: world) }
                    .buttonStyle(.bordered)
                    .disabled(controls.isAdding || controls.memory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || controls.memory.utf16.count > 280)
            }
        } header: {
            Text(npc.name)
        }
        .onChange(of: controls.memory) {
            if controls.memory.utf16.count > 280 { controls.memory = WorldText.limited(controls.memory, to: 280) }
        }
    }
}
