import SwiftUI

/// Which lorebook entries are in context right now, and why. Recomputed from
/// the same scan the server runs, so each row can say which key pulled it in.
/// Read-only: editing lives in the lorebook.
struct InspectorLoreSection: View {
    let workspace: StoryWorkspace

    @Environment(AppModel.self) private var app
    @Environment(\.inspectorIsSheet) private var isSheet
    @AppStorage("inspectorOpen") private var inspectorOpen = false

    var body: some View {
        let matches = workspace.story.map { LoreScan.activeEntries(in: workspace.lorebook, story: $0) } ?? []

        if matches.isEmpty {
            ContentUnavailableView {
                Label("No Lore in Context", systemImage: "book.closed")
            } description: {
                Text(workspace.lorebook.isEmpty
                    ? "This story has no lorebook entries yet."
                    : "Entries appear here when their keys turn up in memory, the author’s note or the last few passages.")
            } actions: {
                Button("Open Lorebook", action: openLorebook)
                    .buttonStyle(.bordered)
            }
        } else {
            List {
                Section {
                    ForEach(matches) { match in
                        InspectorLoreRow(match: match)
                    }
                } header: {
                    Text("^[\(matches.count) entry](inflect: true) in context")
                } footer: {
                    Text("Keys are looked for in memory, the author’s note and the last four passages, then in the entries those bring in. Higher priority survives trimming longer.")
                }
                Section {
                    Button("Open Lorebook", systemImage: "book.closed", action: openLorebook)
                }
            }
        }
    }

    /// On iPhone the inspector is a sheet over the story, so it gets out of the way first.
    private func openLorebook() {
        if isSheet { inspectorOpen = false }
        app.libraryPath.append(.lorebook(workspace.storyId))
    }
}
