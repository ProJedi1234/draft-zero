import SwiftUI

/// What an AI Dungeon backup will become. The manuscript leads: it is the one
/// number that says whether this is a world or a novel.
struct BackupReviewSections: View {
    let preview: BackupPreview

    var body: some View {
        Section("Contents") {
            LabeledContent("Story", value: ImportDigest.manuscript(passages: preview.passageCount, turns: preview.turnCount))
            LabeledContent("Lorebook", value: ImportDigest.entries(preview.lorebookEntries.count))
            LabeledContent("Categories", value: ImportDigest.categories(preview.lorebookEntries))
            LabeledContent("World", value: ImportDigest.words(preview.worldDescription))
            LabeledContent("Memory", value: ImportDigest.words(preview.memory))
            LabeledContent("Author's Note", value: ImportDigest.words(preview.authorsNote))
            LabeledContent("Summary", value: ImportDigest.words(preview.summary))
            LabeledContent("Narrator", value: ImportDigest.narrator(preview.instructions))
        }
    }
}
