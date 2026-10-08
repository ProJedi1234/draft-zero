import SwiftUI

/// The top of an import review: what kind of file this is, what it's called,
/// and how its author described it.
struct ImportHeaderSection: View {
    let format: String
    let title: String
    var byline: String?
    var description: String
    /// Backups often carry their whole opening as a description; clamp those.
    var descriptionLineLimit: Int?
    let tags: [String]

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text(format)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Text(title)
                    .font(Theme.proseTitleFont)
                    .bold()
                    .contentTransition(.opacity)
                if let byline {
                    Text(byline)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(descriptionLineLimit)
                }
                if !tags.isEmpty {
                    TagFlowLayout {
                        ForEach(tags, id: \.self) { tag in
                            ImportTag(text: tag)
                        }
                    }
                    .padding(.top, 4)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Tags: \(tags.formatted(.list(type: .and)))")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowBackground(Color.clear)
        }
    }
}
