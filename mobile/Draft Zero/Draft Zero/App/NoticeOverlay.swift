import SwiftUI

/// Shows the current notice as a banner at the top of the window.
struct NoticeOverlay: ViewModifier {
    var isEnabled = true
    @Environment(NoticeCenter.self) private var notices
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if isEnabled, let notice = notices.current {
                NoticeBanner(notice: notice, dismiss: notices.dismiss)
                    .padding(.horizontal)
                    .padding(.top, 8)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                    .id(notice.id)
            }
        }
        .animation(.snappy, value: notices.current)
    }
}

extension View {
    func noticeOverlay(isEnabled: Bool = true) -> some View {
        modifier(NoticeOverlay(isEnabled: isEnabled))
    }
}
