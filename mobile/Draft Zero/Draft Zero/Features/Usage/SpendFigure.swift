import SwiftUI

/// One window's spend, with the picture slice beneath it. A trailing "+" says
/// the figure is a floor because some calls were never priced.
struct SpendFigure: View {
    let label: LocalizedStringKey
    let total: String
    let unpriced: Int
    /// Nil hides the picture line, for ledgers that never drew one.
    let pictures: String?
    let pictureUnpriced: Int

    private var totalText: String { Format.usdFloor(total, unpriced: unpriced) }
    private var picturesText: String? {
        pictures.map { Format.usdFloor($0, unpriced: pictureUnpriced) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(totalText)
                .font(.title2.bold())
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            if let picturesText {
                Label(picturesText, systemImage: "photo")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(spokenValue)
    }

    private var spokenValue: String {
        var spoken = unpriced > 0 ? "at least \(Format.usd(total))" : Format.usd(total)
        if let pictures {
            spoken += ", \(pictureUnpriced > 0 ? "at least " : "")\(Format.usd(pictures)) of it on pictures"
        }
        return spoken
    }
}
