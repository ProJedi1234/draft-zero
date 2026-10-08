import SwiftUI

/// The chosen segment. Its edits live in the model above, so switching away
/// from a half-typed field loses nothing.
struct InspectorSectionContent: View {
    let model: InspectorModel
    let section: InspectorSection
    /// Writes would fail and spring back, so the editing segments go inert.
    let isOffline: Bool

    var body: some View {
        switch section {
        case .prompt:
            InspectorPromptSection(model: model)
                .disabled(isOffline)
        case .model:
            InspectorModelSection(model: model)
                .disabled(isOffline)
        case .lore:
            InspectorLoreSection(workspace: model.workspace)
        }
    }
}
