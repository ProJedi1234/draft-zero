import SwiftUI

/// What an import created, with every note the server made about it.
struct ImportSummaryView: View {
    let summary: ImportSummary
    let fallbackTitle: String
    let onOpenStory: (String) -> Void

    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.green)
                        .accessibilityHidden(true)
                    Text(summary.title ?? fallbackTitle)
                        .font(Theme.proseTitleFont)
                        .bold()
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .listRowBackground(Color.clear)
            }
            Section {
                if let passages = summary.passageCount {
                    LabeledContent("Passages", value: passages.formatted())
                }
                LabeledContent("Lorebook Entries", value: summary.lorebookEntryCount.formatted())
                if let skipped = summary.skippedCount, skipped > 0 {
                    LabeledContent("Skipped", value: skipped.formatted())
                }
            } header: {
                Text("What Came In")
            } footer: {
                if summary.warnings.isEmpty {
                    Text("Nothing was left behind.")
                }
            }
            ImportWarningsSection(title: "Notes", warnings: summary.warnings)
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: openStory) {
                Text("Open Story")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .padding()
        }
    }

    private func openStory() {
        onOpenStory(summary.storyId)
    }
}
