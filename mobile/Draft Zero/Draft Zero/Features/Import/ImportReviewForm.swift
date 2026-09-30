import SwiftUI

/// Shows what a file contains before anything is written.
struct ImportReviewForm: View {
    @Bindable var session: ImportSession

    var body: some View {
        Form {
            switch session.content {
            case .scenario(_, let preview):
                ImportHeaderSection(
                    format: session.content.formatName,
                    title: session.previewTitle,
                    byline: preview.author.isEmpty ? nil : "by \(preview.author)",
                    description: preview.description,
                    tags: preview.tags
                )
                ScenarioReviewSections(preview: preview, fields: $session.fields)
            case .storyCards(_, let preview):
                ImportHeaderSection(
                    format: session.content.formatName,
                    title: preview.title,
                    description: preview.description,
                    tags: preview.tags
                )
                StoryCardsReviewSections(preview: preview)
            case .backup(_, let preview):
                ImportHeaderSection(
                    format: session.content.formatName,
                    title: preview.title,
                    description: preview.description,
                    descriptionLineLimit: 3,
                    tags: preview.tags
                )
                BackupReviewSections(preview: preview)
            }
            ImportWarningsSection(title: "Before You Import", warnings: session.content.warnings)
        }
        .disabled(session.isImporting)
    }
}
