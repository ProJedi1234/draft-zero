import SwiftUI

struct InspectorWorldSection: View {
    let world: WorldModel
    let isKeyboardUp: Bool

    var body: some View {
        Section {
            if let failure = world.failure {
                Text(failure).foregroundStyle(.secondary)
                Button("Retry") { Task { await world.load() } }
            }
            if let state = world.state {
                if let clock = world.clock {
                    WorldClockEditor(minutes: state.minutes, controls: clock, isKeyboardUp: isKeyboardUp)
                }
                if state.npcs.isEmpty {
                    Text("No living NPCs. Turn on Living NPC for a character in the lore editor.")
                        .foregroundStyle(.secondary)
                }
            } else if world.failure == nil {
                ProgressView("Loading world…")
            }
        } header: {
            Text("World")
        }
        if let state = world.state {
            ForEach(state.npcs) { npc in
                if let controls = world.controls[npc.id] {
                    WorldNPCSection(npc: npc, controls: controls, world: world, isKeyboardUp: isKeyboardUp)
                }
            }
        }
    }
}
