import SwiftUI

/// One window's spend, split into text and pictures beneath it. A trailing "+"
/// says the figure is a floor because some calls were never priced.
struct SpendFigure: View {
    let label: LocalizedStringKey
    let total: String
    let unpriced: Int
    /// Nil hides the split, for ledgers that never drew a picture.
    let pictures: String?
    let pictureUnpriced: Int

    /// Pictures are a slice of the total, so text is what remains of it.
    private var text: String {
        guard let total = Decimal(string: total), let pictures = pictures.flatMap({ Decimal(string: $0) }) else { return total }
        return "\(max(total - pictures, 0))"
    }
    private var textUnpriced: Int { max(unpriced - pictureUnpriced, 0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(Format.usdFloor(total, unpriced: unpriced))
                .font(.title2.bold())
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            if let pictures {
                Grid(alignment: .leading, horizontalSpacing: 4, verticalSpacing: 2) {
                    part(Format.usdFloor(text, unpriced: textUnpriced), symbol: "text.alignleft", tint: .blue)
                    part(Format.usdFloor(pictures, unpriced: pictureUnpriced), symbol: "photo", tint: .orange)
                }
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue(spokenValue)
    }

    /// Tinted to match the chart's series, which is the legend for both.
    private func part(_ amount: String, symbol: String, tint: Color) -> some View {
        GridRow {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .gridColumnAlignment(.center)
            Text(amount)
        }
    }

    private var spokenValue: String {
        var spoken = spoken(total, unpriced: unpriced)
        if let pictures {
            spoken += ", \(self.spoken(text, unpriced: textUnpriced)) on text, \(self.spoken(pictures, unpriced: pictureUnpriced)) on pictures"
        }
        return spoken
    }

    private func spoken(_ amount: String, unpriced: Int) -> String {
        unpriced > 0 ? "at least \(Format.usd(amount))" : Format.usd(amount)
    }
}
