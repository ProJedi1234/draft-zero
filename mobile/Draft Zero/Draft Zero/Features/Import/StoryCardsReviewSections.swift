import SwiftUI

/// What an AI Dungeon card export will become. A card file is a world rather
/// than a story, so the lorebook leads.
struct StoryCardsReviewSections: View {
    let preview: StoryCardsPreview

    var body: some View {
        Section {
            LabeledContent("Lorebook", value: ImportDigest.entries(preview.lorebookEntries.count))
            LabeledContent("Categories", value: ImportDigest.categories(preview.lorebookEntries))
            LabeledContent("World", value: ImportDigest.words(preview.worldDescription))
            LabeledContent("Opening", value: ImportDigest.words(preview.prompt))
            LabeledContent("Memory", value: ImportDigest.words(preview.memory))
        } header: {
            Text("Contents")
        } footer: {
            if !preview.worldDescription.isEmpty {
                Text("The world description becomes the new story's memory.")
            }
        }
    }
}
