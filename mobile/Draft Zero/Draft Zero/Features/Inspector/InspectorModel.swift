import Foundation
import Observation

/// Everything the inspector edits for one story, held above its segments so
/// switching segments never drops an edit in progress. Each control follows
/// the server while mounted and never overwrites what the writer is changing.
@Observable
final class InspectorModel {
    let workspace: StoryWorkspace
    let memory: AutosavingField<String>
    let authorsNote: AutosavingField<String>
    let summarize: ServerSyncedValue<Bool>
    let imageModel: ServerSyncedValue<String?>
    let settings: StoryModelSettings
    let atmosphere: AtmosphereControls
    let nextContext: NextContextLoader

    init(workspace: StoryWorkspace, story: Story) {
        self.workspace = workspace
        let version = story.updatedAt
        memory = Self.prose(story.memory, version: version, key: "memory", workspace: workspace) { $0.memory }
        authorsNote = Self.prose(story.authorsNote, version: version, key: "authorsNote", workspace: workspace) { $0.authorsNote }
        summarize = ServerSyncedValue(story.summarize, version: version)
        imageModel = ServerSyncedValue(story.imageModelId, version: version)
        settings = StoryModelSettings(workspace: workspace, story: story)
        atmosphere = AtmosphereControls(workspace: workspace, story: story)
        nextContext = NextContextLoader(storyId: workspace.storyId, api: workspace.api)
    }

    private static func prose(
        _ value: String,
        version: String,
        key: String,
        workspace: StoryWorkspace,
        field: @escaping (Story) -> String
    ) -> AutosavingField<String> {
        AutosavingField(
            value,
            version: version,
            onFailure: .keepEdit,
            read: { [weak workspace] in
                workspace?.story.map { (field($0), $0.updatedAt) }
            },
            persist: { [weak workspace] text in
                await workspace?.updateMeta([key: .string(text)]) ?? false
            }
        )
    }

    /// True while the writer is typing in one of the prose fields.
    var isTyping: Bool { memory.isFocused || authorsNote.isFocused }

    /// Offers the story as the server now holds it to every control.
    func apply() {
        guard let story = workspace.story else { return }
        memory.pull()
        authorsNote.pull()
        summarize.receive(story.summarize, version: story.updatedAt)
        imageModel.receive(story.imageModelId, version: story.updatedAt)
        settings.apply()
        atmosphere.apply()
    }

    /// Sends every waiting edit, for leaving the screen or the app.
    func flush() async {
        await memory.flush()
        await authorsNote.flush()
        await settings.flush()
        await atmosphere.flush()
    }

    /// Bound by the Keep summarizing switch; setting it saves.
    var keepsSummarizing: Bool {
        get { summarize.value }
        set { write(summarize, newValue, patch: ["summarize": .bool(newValue)]) }
    }

    /// The story's image model, or nil to follow the app default.
    func chooseImageModel(_ modelId: String?) {
        var batch = SyncedWriteBatch()
        batch.stage(imageModel, modelId)
        guard !batch.isEmpty else { return }
        let staged = batch
        Task {
            let succeeded = await workspace.setImageModel(modelId)
            apply()
            staged.finish(succeeded)
        }
    }

    /// Saves the narrator prompt; blank goes back to the built-in one.
    func saveNarrator(_ text: String) async -> Bool {
        let override = NarratorPrompt.isOverride(text) ? text : ""
        return await workspace.updateMeta(["systemPrompt": .string(override)])
    }

    private func write(_ field: ServerSyncedValue<Bool>, _ next: Bool, patch: JSONObject) {
        var batch = SyncedWriteBatch()
        batch.stage(field, next)
        guard !batch.isEmpty else { return }
        let staged = batch
        Task {
            let succeeded = await workspace.updateMeta(patch)
            apply()
            staged.finish(succeeded)
        }
    }
}
