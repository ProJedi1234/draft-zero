import SwiftUI

/// A small capsule marking an entry's state; carries its meaning in words, not colour.
struct LorebookEntryBadge: View {
    let title: String
    let systemImage: String
    let isProminent: Bool

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption)
            .labelStyle(.titleAndIcon)
            .foregroundStyle(isProminent ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(isProminent ? AnyShapeStyle(.tint.quaternary) : AnyShapeStyle(.fill.tertiary), in: .capsule)
    }
}
