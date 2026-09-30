import Foundation

/// Everything that changes what the next passage would be sent, so the meter
/// re-measures when any of it moves. A followed profile edited elsewhere
/// changes the resolved settings without touching the story's version.
struct NextContextKey: Hashable {
    var storyVersion: String
    var settings: GenerationSettings?
    var loreCount: Int
    var loreVersion: String?

    init(workspace: StoryWorkspace) {
        storyVersion = workspace.story?.updatedAt ?? ""
        settings = workspace.story?.settings
        loreCount = workspace.lorebook.count
        loreVersion = workspace.lorebook.map(\.updatedAt).max()
    }
}
