import SwiftUI

/// An entry's summary: category, name, priority, keys, the start of its content,
/// and whether it is switched off or always in context.
struct LorebookEntryRow: View {
    let entry: LorebookEntry
    /// Selected in the split layout, where the accent fills the row.
    var isSelected = false

    @ScaledMetric(relativeTo: .headline) private var iconWidth = 24

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: entry.category.systemImage)
                .foregroundStyle(.secondary)
                .frame(width: iconWidth)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(entry.name.isEmpty ? "Untitled Entry" : entry.name)
                        .font(.headline)
                        .foregroundStyle(entry.enabled ? .primary : .secondary)
                        .lineLimit(2)
                    Spacer(minLength: 8)
                    LorebookPriorityMark(priority: entry.priority)
                }
                if !entry.keys.isEmpty {
                    Text(entry.keys.joined(separator: ", "))
                        .font(.subheadline)
                        .foregroundStyle(keyStyle)
                        .lineLimit(1)
                }
                if !entry.content.isEmpty {
                    Text(entry.content)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if entry.alwaysActive || !entry.enabled {
                    HStack(spacing: 6) {
                        if entry.alwaysActive {
                            LorebookEntryBadge(title: "Always Active", systemImage: "pin.fill", isProminent: entry.enabled && !isSelected)
                        }
                        if !entry.enabled {
                            LorebookEntryBadge(title: "Disabled", systemImage: "pause.circle", isProminent: false)
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// Keys drawn in the accent would vanish into a selected row's fill.
    private var keyStyle: AnyShapeStyle {
        isSelected ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint)
    }

    private var accessibilityText: String {
        var parts = [entry.name.isEmpty ? "Untitled entry" : entry.name, entry.category.label]
        if !entry.keys.isEmpty { parts.append("Keys: \(entry.keys.joined(separator: ", "))") }
        parts.append("Priority \(entry.priority)")
        if entry.alwaysActive { parts.append("Always active") }
        if !entry.enabled { parts.append("Disabled") }
        if !entry.content.isEmpty { parts.append(String(entry.content.prefix(140))) }
        return parts.joined(separator: ". ")
    }
}
