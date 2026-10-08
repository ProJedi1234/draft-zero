import SwiftUI

/// The story's inspector: a trailing column on iPad, a sheet on iPhone. Waits
/// for the story to load, then keeps one model of its controls for as long as
/// it is shown, so segment switches and server refreshes never drop an edit.
struct InspectorView: View {
    let workspace: StoryWorkspace

    @State private var model: InspectorModel?
    /// Opens tall on iPhone: the header alone fills half a medium sheet.
    @State private var detent: PresentationDetent = .large
    @State private var isSheet = true

    var body: some View {
        Group {
            if let model {
                InspectorPanel(model: model)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .environment(\.inspectorIsSheet, isSheet)
        // A trailing column starts right of the window's leading edge; a sheet spans it.
        .onGeometryChange(for: Bool.self) { proxy in
            proxy.frame(in: .global).minX < 1
        } action: { spansWindow in
            isSheet = spansWindow
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .onAppear(perform: prepare)
        .onChange(of: workspace.story?.id, prepare)
    }

    private func prepare() {
        guard model?.workspace !== workspace, let story = workspace.story else { return }
        model = InspectorModel(workspace: workspace, story: story)
    }
}
