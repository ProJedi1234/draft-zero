import SwiftUI

/// The profile switcher's face: the name, what the bundle runs, and what it
/// costs; or, in Custom mode, a tag saying the settings are this story's.
struct InspectorProfileCard: View {
    let name: String
    let isDefault: Bool
    let summary: String?
    let pricing: String?
    /// The profile this session left for Custom, if any.
    let basedOn: String?
    let zdr: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if isDefault {
                    Image(systemName: "star.fill")
                        .font(.footnote)
                        .accessibilityLabel("Default profile")
                }
                Text(name)
                    .font(.headline)
                if zdr {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Zero data retention")
                }
                if summary == nil {
                    Text("This story")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(.quaternary, in: .capsule)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            if let summary {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let pricing {
                Text(pricing)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let basedOn {
                Text("Based on \(basedOn)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }
}
