import SwiftUI

/// The lore a brief summons, between the words that summoned it and the
/// prompt it will shape. Tap a chip to leave that entry out of this develop.
/// Riders (always-on entries and the cascade) fold behind a count.
struct LoreChipsRow: View {
    let matches: [LoreMatcher.Match]
    let excluded: Set<String>
    let disabled: Bool
    let toggle: (String) -> Void

    @State private var showRiders = false

    var body: some View {
        let direct = matches.filter { $0.triggeredBy?.isDirect == true }
        let riders = matches.count - direct.count
        if !matches.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(showRiders ? matches : direct) { match in
                        LoreChip(
                            name: match.entry.name,
                            muted: excluded.contains(match.entry.id),
                            disabled: disabled
                        ) {
                            toggle(match.entry.id)
                        }
                    }
                    if riders > 0 {
                        Button(showRiders ? "Less" : "+\(riders)") {
                            withAnimation(Theme.quickAnimation) { showRiders.toggle() }
                        }
                        .font(.caption)
                        .buttonStyle(.borderless)
                        .accessibilityLabel(showRiders ? "Hide the entries that ride along" : "Show \(riders) more entries that ride along")
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }
}
