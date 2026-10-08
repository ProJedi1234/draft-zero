import SwiftUI

/// The story's rolling recap, read-only: it is rewritten every time the window
/// slides, so an edit here would last one passage. The switch decides whether
/// it keeps being rewritten.
struct InspectorSummarySheet: View {
    let model: InspectorModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var model = model
        let summary = model.workspace.story?.summary ?? ""

        NavigationStack {
            Form {
                Section {
                    Toggle("Keep summarizing", isOn: $model.keepsSummarizing)
                } footer: {
                    Text("Once a story outgrows its context window, its opening stops being sent, and this recap goes in its place, rewritten as older passages fall out. Turn it off and the recap freezes where it is: it is still sent, but it stops costing anything and stops learning what happens next.")
                }
                Section {
                    if summary.isEmpty {
                        Text("Nothing yet. This story still fits its context window, so the model can see all of it and there is nothing to stand in for.")
                            .foregroundStyle(.secondary)
                    } else {
                        Text(summary)
                            .font(Theme.proseFont)
                            .lineSpacing(Theme.proseLineSpacing)
                            .textSelection(.enabled)
                    }
                } header: {
                    Text("Current Recap")
                } footer: {
                    Text("Written by the model, so it can't be edited here. A fact it keeps losing belongs in Memory, which is yours and never overwritten.")
                }
            }
            .navigationTitle("Story So Far")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: close)
                }
            }
        }
    }

    private func close() {
        dismiss()
    }
}
