import SwiftUI

/// One entry in context: what it is, how it arrived and which key matched,
/// how hard it holds on, and a glimpse of what it says. Without the arrival, an
/// entry pulled in by another entry reads as a mystery whose key appears
/// nowhere in the prose.
struct InspectorLoreRow: View {
    let match: LoreMatcher.Match

    var body: some View {
        let entry = match.entry
        let content = entry.content.trimmingCharacters(in: .whitespacesAndNewlines)

        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Label(entry.name, systemImage: entry.category.systemImage)
                    .font(.headline)
                Spacer(minLength: 8)
                Text(entry.category.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(InspectorText.loreArrival(match))
                .font(.subheadline)
            HStack(spacing: 10) {
                Text(InspectorText.loreRank(match))
                if match.stable {
                    Text("\(Image(systemName: "pin.fill")) Steady")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if !content.isEmpty {
                Text(content)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityHint(match.stable
            ? "Held by memory, the author's note or always-on, so it stays as the story scrolls."
            : "Triggered by recent text, so it comes and goes with the prose.")
    }
}
