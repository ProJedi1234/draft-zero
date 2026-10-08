import SwiftUI

/// Opens one story: owns its workspace for as long as the screen is shown.
struct StoryScreen: View {
    let storyId: String

    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var workspace: StoryWorkspace?

    var body: some View {
        Group {
            if let workspace {
                StoryWorkspaceView(workspace: workspace)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .onAppear(perform: open)
        .onDisappear { workspace?.stop() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: workspace?.wake()
            case .background: workspace?.willBackground()
            default: break
            }
        }
    }

    private func open() {
        if let workspace {
            workspace.start()
            return
        }
        guard let api = app.api else { return }
        let created = StoryWorkspace(storyId: storyId, app: app, api: api)
        workspace = created
        created.start()
    }
}
