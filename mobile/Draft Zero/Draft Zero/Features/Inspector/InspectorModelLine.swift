import SwiftUI

/// "Default · Claude Sonnet Latest · Auto · off" with a shield when nothing may
/// be retained. One line when it fits; stacked at large text sizes.
struct InspectorModelLine: View {
    let profileName: String
    let isDefaultProfile: Bool
    let parts: SettingsSummary.Parts
    let zdr: Bool

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                profile
                Text(parts.model)
                    .bold()
                    .lineLimit(1)
                Spacer(minLength: 8)
                routing
            }
            VStack(alignment: .leading, spacing: 2) {
                profile
                Text(parts.model)
                    .bold()
                    .fixedSize(horizontal: false, vertical: true)
                routing
            }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var profile: some View {
        HStack(spacing: 4) {
            if zdr {
                Image(systemName: "checkmark.shield")
            }
            if isDefaultProfile {
                Image(systemName: "star.fill")
                    .imageScale(.small)
            }
            Text(profileName)
                .lineLimit(1)
        }
        .foregroundStyle(.secondary)
    }

    private var routing: some View {
        Text("\(parts.provider) · \(parts.thinking)")
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    private var accessibilityText: String {
        var text = "Model: \(parts.model), \(parts.provider), thinking \(parts.thinking)"
        if zdr { text += ", zero data retention" }
        return "\(text). Profile: \(profileName)."
    }
}
