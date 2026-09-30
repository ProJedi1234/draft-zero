import SwiftUI

/// What a NovelAI scenario will become, and a field for each of its blanks.
struct ScenarioReviewSections: View {
    let preview: ScenarioPreview
    @Binding var fields: [PlaceholderField]

    var body: some View {
        if !fields.isEmpty {
            Section {
                ForEach($fields) { $field in
                    PlaceholderFieldRow(field: $field)
                }
            } header: {
                Text("Fill In the Blanks")
            } footer: {
                Text("The scenario uses these throughout its text. Each starts at the author's default.")
            }
        }
        Section("Contents") {
            LabeledContent("Opening", value: ImportDigest.words(preview.prompt))
            LabeledContent("Memory", value: ImportDigest.words(preview.memory))
            LabeledContent("Author's Note", value: ImportDigest.words(preview.authorsNote))
            LabeledContent("Lorebook", value: ImportDigest.entries(preview.lorebookEntries.count))
            if !preview.genre.isEmpty {
                LabeledContent("Genre", value: preview.genre)
            }
        }
    }
}
