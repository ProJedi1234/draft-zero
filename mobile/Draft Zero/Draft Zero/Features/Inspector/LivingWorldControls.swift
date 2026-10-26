import Foundation
import Observation

@Observable
final class LivingWorldControls {
    let enabled: ServerSyncedValue<Bool>
    let pacing: AutosavingField<String>
    private let workspace: StoryWorkspace

    init(workspace: StoryWorkspace, story: Story) {
        self.workspace = workspace
        let enabled = ServerSyncedValue(story.features?.world?.enabled ?? false, version: story.updatedAt)
        self.enabled = enabled
        pacing = AutosavingField(
            story.features?.world?.pacing ?? "", version: story.updatedAt, onFailure: .keepEdit,
            read: { [weak workspace] in
                workspace?.story.map { ($0.features?.world?.pacing ?? "", $0.updatedAt) }
            },
            persist: { [weak workspace] text in
                await workspace?.updateMeta(Self.patch(enabled: enabled.value, pacing: text)) ?? false
            }
        )
    }

    var isEnabled: Bool {
        get { enabled.value }
        set {
            let previous = enabled.value
            guard enabled.write(newValue) else { return }
            Task {
                await pacing.flush()
                let succeeded = await workspace.updateMeta(Self.patch(enabled: newValue, pacing: pacing.value))
                apply()
                if succeeded { enabled.settle() } else { enabled.reset(to: previous) }
            }
        }
    }

    func apply() {
        guard let story = workspace.story else { return }
        enabled.receive(story.features?.world?.enabled ?? false, version: story.updatedAt)
        pacing.pull()
    }

    private static func patch(enabled: Bool, pacing: String) -> JSONObject {
        ["features": .object(["world": .object(["enabled": .bool(enabled), "pacing": .string(pacing)])])]
    }
}
