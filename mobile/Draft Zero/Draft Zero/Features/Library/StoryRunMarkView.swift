import SwiftUI

/// What a story's latest run is doing, as a mark beside its title. Hidden from
/// VoiceOver: the meta line already says it in words.
struct StoryRunMarkView: View {
    let mark: LibraryStore.RunMark?

    @ScaledMetric(relativeTo: .footnote) private var size = 9.0

    var body: some View {
        Group {
            switch mark {
            case .working:
                RunDots()
            case .done:
                Circle()
                    .fill(.tint)
                    .frame(width: size, height: size)
            case .failed:
                Circle()
                    .strokeBorder(.red, lineWidth: 1.5)
                    .frame(width: size, height: size)
            case nil:
                EmptyView()
            }
        }
        .accessibilityHidden(true)
    }
}
