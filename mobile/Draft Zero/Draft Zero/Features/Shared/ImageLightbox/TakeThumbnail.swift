import SwiftUI

/// One take in the filmstrip: a square crop, ringed while it is the one on
/// screen and badged while it is the one the story uses.
struct TakeThumbnail: View {
    let take: ImageTake
    let number: Int
    let count: Int
    let url: URL
    let isShown: Bool
    let isActive: Bool
    var action: () -> Void

    @ScaledMetric(relativeTo: .body) private var scaledSide = 52.0

    private var side: Double { min(scaledSide, 72) }

    var body: some View {
        Button(action: action) {
            ServerImage(url: url, aspectRatio: 1, contentMode: .fill, accessibilityLabel: take.prompt)
                .frame(width: side, height: side)
                .clipShape(.rect(cornerRadius: Theme.smallCornerRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: Theme.smallCornerRadius)
                        .strokeBorder(.white, lineWidth: isShown ? 2.5 : 0)
                }
                .overlay(alignment: .bottomTrailing) {
                    if isActive {
                        Image(systemName: "checkmark.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .tint)
                            .font(.footnote)
                            .padding(3)
                            .accessibilityHidden(true)
                    }
                }
                .opacity(isShown ? 1 : 0.6)
                .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Take \(number) of \(count)")
        .accessibilityValue(isActive ? "In the story" : "")
        .accessibilityAddTraits(isShown ? .isSelected : [])
    }
}
