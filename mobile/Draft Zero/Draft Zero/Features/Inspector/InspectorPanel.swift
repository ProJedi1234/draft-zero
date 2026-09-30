import SwiftUI

/// The inspector's shell: a pinned header over the chosen segment, and the
/// wiring that keeps every control following the server while it is shown.
struct InspectorPanel: View {
    let model: InspectorModel

    @Environment(AppModel.self) private var app
    @Environment(\.inspectorIsSheet) private var isSheet
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("inspectorSection") private var section: InspectorSection = .prompt

    var body: some View {
        let settings = model.settings

        InspectorSectionContent(model: model, section: section, isOffline: isOffline)
            .safeAreaBar(edge: .top) {
                // Gone while a phone keyboard is up: nobody switches segments
                // mid-sentence, and the space above the keyboard is scarce.
                if !(isSheet && model.isTyping) {
                    InspectorHeader(model: model, section: $section)
                }
            }
            .onChange(of: model.workspace.story?.updatedAt, initial: true) {
                model.apply()
            }
            .onChange(of: settings.windowCeilingKey) {
                settings.fixUpContextWindow()
            }
            .task(id: settings.modelId) {
                await settings.endpoints.load(settings.modelId, api: app.api)
            }
            .task {
                await settings.loadPolicies()
            }
            .task(id: NextContextKey(workspace: model.workspace)) {
                await model.nextContext.load()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { flush() }
            }
            .onDisappear(perform: flush)
    }

    private var isOffline: Bool {
        if case .offline = app.effectiveConnection { true } else { false }
    }

    private func flush() {
        Task { await model.flush() }
    }
}
