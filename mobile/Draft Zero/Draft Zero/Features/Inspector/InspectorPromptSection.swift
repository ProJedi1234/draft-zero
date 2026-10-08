import SwiftUI

/// What the model reads: the two blocks of prose the writer keeps, the recap
/// the model keeps, the narrator prompt that frames them, and the room's colour.
struct InspectorPromptSection: View {
    let model: InspectorModel

    @State private var sheet: InspectorPromptSheet?
    @State private var isKeyboardUp = false
    @Environment(\.inspectorIsSheet) private var isSheet

    var body: some View {
        let story = model.workspace.story

        Form {
            InspectorProseSection(
                title: "Memory",
                placeholder: "Facts the model should always remember…",
                footer: "Always sent at the top of the context.",
                lines: 4...14,
                field: model.memory,
                isKeyboardUp: isSheet && isKeyboardUp
            )
            InspectorProseSection(
                title: "Author’s Note",
                placeholder: "Steer tone and style…",
                footer: "Sent just before the most recent words.",
                lines: 2...10,
                field: model.authorsNote,
                isKeyboardUp: isSheet && isKeyboardUp
            )
            Section {
                Button(action: showSummary) {
                    InspectorSheetRowLabel(
                        title: "Story So Far",
                        value: InspectorText.recapStatus(summarize: model.summarize.value, summary: story?.summary ?? "")
                    )
                }
                .tint(.primary)
                Button(action: showNarrator) {
                    InspectorSheetRowLabel(
                        title: "Narrator",
                        value: NarratorPrompt.isOverride(story?.systemPrompt) ? "Custom" : "Built-in"
                    )
                }
                .tint(.primary)
            } footer: {
                Text("The recap is written by the model; the narrator prompt tells it how to write.")
            }
            InspectorAtmosphereSection(controls: model.atmosphere, status: model.workspace.atmosphere)
        }
        .scrollDismissesKeyboard(.interactively)
        .task(watchKeyboard)
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .summary:
                InspectorSummarySheet(model: model)
            case .narrator:
                InspectorNarratorSheet(model: model)
            }
        }
    }

    /// The inspector's sheet never reports `@FocusState`, so there the keyboard
    /// stands in for it: up means one of these fields is being written in.
    private func watchKeyboard() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await track(UIResponder.keyboardWillShowNotification, as: true) }
            group.addTask { await track(UIResponder.keyboardWillHideNotification, as: false) }
        }
    }

    private func track(_ name: Notification.Name, as visible: Bool) async {
        for await _ in NotificationCenter.default.notifications(named: name) {
            isKeyboardUp = visible
        }
    }

    private func showSummary() {
        sheet = .summary
    }

    private func showNarrator() {
        sheet = .narrator
    }
}
