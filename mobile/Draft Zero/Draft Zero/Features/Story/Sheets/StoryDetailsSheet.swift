import SwiftUI

/// The story's title, genre and pitch, and the facts about it.
struct StoryDetailsSheet: View {
    let workspace: StoryWorkspace

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var genre = ""
    @State private var description = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                        .font(.system(.title3, design: .serif))
                    TextField("Genre", text: $genre)
                    TextField("A sentence or two about the story", text: $description, axis: .vertical)
                        .lineLimit(2...6)
                } footer: {
                    Text("Shown in the library and at the top of the manuscript.")
                }

                if let story = workspace.story {
                    Section("About") {
                        LabeledContent("Words", value: story.wordCount.formatted())
                        LabeledContent("Passages", value: (workspace.loadedEntries.count + (story.entriesBefore ?? 0)).formatted())
                        LabeledContent("Pictures", value: story.images.count.formatted())
                        if let created = ISODate.parse(story.createdAt) {
                            LabeledContent("Started") {
                                Text(created, format: .dateTime.day().month().year())
                            }
                        }
                        if let updated = ISODate.parse(story.updatedAt) {
                            LabeledContent("Last written") {
                                Text(updated, format: .relative(presentation: .named))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Story Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: seed)
        }
    }

    private func seed() {
        guard let story = workspace.story else { return }
        title = story.title
        genre = story.genre
        description = story.description
    }

    private func save() {
        guard let story = workspace.story else { return }
        var patch: JSONObject = [:]
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedTitle != story.title { patch["title"] = .string(trimmedTitle) }
        if genre != story.genre { patch["genre"] = .string(genre) }
        if description != story.description { patch["description"] = .string(description) }
        guard !patch.isEmpty else {
            dismiss()
            return
        }
        saving = true
        Task {
            let saved = await workspace.updateMeta(patch)
            saving = false
            if saved { dismiss() }
        }
    }
}
