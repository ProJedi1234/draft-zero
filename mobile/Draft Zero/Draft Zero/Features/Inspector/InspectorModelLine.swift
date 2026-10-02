import SwiftUI

/// "Claude Sonnet Latest" over "Default · Auto · off", with a shield when
/// nothing may be retained. Truncates rather than wraps, because the Model
/// segment spells out every part.
struct InspectorModelLine: View {
    let profileName: String
    let parts: SettingsSummary.Parts
    let zdr: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(parts.model)
                    .font(.headline)
                if zdr {
                    Image(systemName: "checkmark.shield")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Text([profileName, parts.provider, parts.thinking].joined(separator: " · "))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var text = "Model: \(parts.model), \(parts.provider), thinking \(parts.thinking)"
        if zdr { text += ", zero data retention" }
        return "\(text). Profile: \(profileName)."
    }
}
