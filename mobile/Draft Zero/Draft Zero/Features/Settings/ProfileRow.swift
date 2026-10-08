import SwiftUI

/// One profile: the default's star, its name and retention mark, the bundle
/// in one line, and how many stories follow it. Tapping edits; the context
/// menu and swipe offer the rest.
struct ProfileRow: View {
    let profile: ModelProfile
    let summary: String
    let followers: Int
    let isDefault: Bool
    /// Routed only through providers that keep nothing, whoever requires it.
    let zdr: Bool
    let onEdit: () -> Void
    let onDuplicate: () -> Void
    let onMakeDefault: () -> Void
    let onDelete: () -> Void

    @State private var isConfirmingDelete = false

    var body: some View {
        Button(action: onEdit) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "star.fill")
                    .font(.footnote)
                    .foregroundStyle(.yellow)
                    .opacity(isDefault ? 1 : 0)
                    .accessibilityLabel("Default")
                    .accessibilityHidden(!isDefault)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(profile.name)
                        if zdr {
                            Image(systemName: "checkmark.shield")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("Zero data retention")
                        }
                    }
                    Text(summary)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Text(ProfileText.followers(followers))
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
            }
            .contentShape(.rect)
        }
        .tint(.primary)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Edits the profile.")
        .contextMenu {
            Button("Edit", systemImage: "pencil", action: onEdit)
            Button("Make Default", systemImage: "star", action: onMakeDefault)
                .disabled(isDefault)
            Button("Duplicate", systemImage: "plus.square.on.square", action: onDuplicate)
            Divider()
            Button("Delete…", systemImage: "trash", role: .destructive, action: confirmDelete)
                .disabled(isDefault)
        }
        .swipeActions(edge: .trailing) {
            if !isDefault {
                Button("Delete", systemImage: "trash", action: confirmDelete)
                    .tint(.red)
            }
            Button("Duplicate", systemImage: "plus.square.on.square", action: onDuplicate)
                .tint(.indigo)
        }
        .swipeActions(edge: .leading) {
            if !isDefault {
                Button("Make Default", systemImage: "star", action: onMakeDefault)
                    .tint(.yellow)
            }
        }
        .confirmationDialog("Delete “\(profile.name)”?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
            Button("Delete Profile", role: .destructive, action: onDelete)
        } message: {
            Text(ProfileText.deleteConsequence(followers: followers))
        }
    }

    private func confirmDelete() {
        isConfirmingDelete = true
    }
}
