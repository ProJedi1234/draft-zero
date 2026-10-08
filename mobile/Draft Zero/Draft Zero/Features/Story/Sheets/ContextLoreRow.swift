import SwiftUI

/// One lore entry in a composed context, and what brought it there.
struct ContextLoreRow: View {
    let lore: ComposedContext.LoreEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(lore.name).bold()
                Spacer()
                Text("Priority \(lore.priority)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                Text(LoreTrigger.describe(lore.triggeredBy))
                if let key = lore.matchedKey {
                    Text("· “\(key)”")
                }
                if lore.stable {
                    Text("· cached")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            Text(lore.content)
                .font(.footnote)
                .lineLimit(4)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}
