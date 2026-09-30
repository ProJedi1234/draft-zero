import Foundation
import Observation

/// The story's atmosphere as three controls that follow the server on their
/// own: hue, strength and Auto are written by different gestures, and the
/// post-turn picker moves hue and strength while a press here may be travelling.
/// A port of the state in components/inspector/atmosphere-row.tsx.
@Observable
final class AtmosphereControls {
    let hue: ServerSyncedValue<Double?>
    let strength: AutosavingField<Double>
    let auto: ServerSyncedValue<Bool>

    @ObservationIgnored private let workspace: StoryWorkspace

    init(workspace: StoryWorkspace, story: Story) {
        self.workspace = workspace
        let version = story.updatedAt
        let hue = ServerSyncedValue(story.tintHue, version: version)
        self.hue = hue
        auto = ServerSyncedValue(story.tintAuto, version: version)
        strength = AutosavingField(
            story.tintStrength,
            version: version,
            debounce: .milliseconds(300),
            onFailure: .revert,
            read: { [weak workspace] in
                workspace?.story.map { ($0.tintStrength, $0.updatedAt) }
            },
            persist: { [weak workspace, weak hue] next in
                guard let workspace, let hue else { return false }
                return await workspace.setTint(StoryTintValue(hue: hue.server, strength: next))
            }
        )
    }

    /// Bound by the Auto switch; setting it saves.
    var isAuto: Bool {
        get { auto.value }
        set { setAuto(newValue) }
    }

    /// The tint the controls show, for swatch selection and the room preview.
    var tint: StoryTintValue {
        StoryTintValue(hue: hue.value, strength: strength.value)
    }

    func apply() {
        guard let story = workspace.story else { return }
        hue.receive(story.tintHue, version: story.updatedAt)
        auto.receive(story.tintAuto, version: story.updatedAt)
        strength.pull()
    }

    /// Paints the room by hand, which also takes the tint back from the picker.
    /// A swatch carries its own strength, except when re-pressing the hue the
    /// story already wears, which would silently discard tuning.
    func pick(_ named: StoryTintValue.Named?) {
        let nextHue = named?.hue
        let currentStrength = strength.sync.server
        let nextStrength = if let named, named.hue != hue.server { named.strength } else { currentStrength }
        strength.discardEdit()
        var batch = SyncedWriteBatch()
        batch.stage(hue, nextHue)
        batch.stage(auto, false)
        if nextHue != nil {
            batch.stage(strength.sync, nextStrength)
        }
        // Re-pressing the pinned swatch has nothing to persist.
        guard !batch.isEmpty else { return }
        let staged = batch
        let tint = nextHue.map { StoryTintValue(hue: $0, strength: nextStrength) }
        Task {
            let succeeded = await workspace.setTint(tint)
            apply()
            staged.finish(succeeded)
        }
    }

    /// Pins a colour the picker chose that matches no named swatch.
    func keepCurrent() {
        guard let current = hue.server else { return }
        var batch = SyncedWriteBatch()
        batch.stage(auto, false)
        guard !batch.isEmpty else { return }
        let staged = batch
        let tint = StoryTintValue(hue: current, strength: strength.sync.server)
        Task {
            let succeeded = await workspace.setTint(tint)
            apply()
            staged.finish(succeeded)
        }
    }

    /// Hands the colour to the picker, or keeps the one the story is wearing.
    private func setAuto(_ next: Bool) {
        guard next != auto.value else { return }
        var batch = SyncedWriteBatch()
        batch.stage(auto, next)
        let staged = batch
        Task {
            let succeeded = await workspace.setTintAuto(next)
            apply()
            staged.finish(succeeded)
        }
    }

    func flush() async {
        await strength.flush()
    }
}
