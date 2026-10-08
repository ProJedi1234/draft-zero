import SwiftUI

/// A story's spend. It opens the story unless the story is gone: the ledger
/// keeps a deleted story's line, but there is nowhere to send a tap.
struct StorySpendRow: View {
    let spend: UsagePayload.StorySpend
    var onOpen: (String) -> Void

    var body: some View {
        if let storyId = spend.storyId, !spend.isDeleted {
            Button {
                onOpen(storyId)
            } label: {
                HStack(spacing: 8) {
                    content
                    Image(systemName: "chevron.right")
                        .font(.footnote.bold())
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the story")
        } else {
            content
        }
    }

    private var content: some View {
        LabeledContent {
            Text(Format.usd(spend.costUsd))
                .monospacedDigit()
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(spend.title)
                    .font(Theme.proseFont)
                    .foregroundStyle(spend.isDeleted ? .secondary : .primary)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var detail: String {
        let calls = "\(spend.calls) \(spend.calls == 1 ? "call" : "calls")"
        return spend.isDeleted ? "Deleted · \(calls)" : calls
    }
}
