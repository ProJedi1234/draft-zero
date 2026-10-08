import SwiftUI

/// One notice, as a glass capsule. Tap to dismiss.
struct NoticeBanner: View {
    let notice: NoticeCenter.Notice
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: dismiss) {
                Label {
                    Text(notice.message)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } icon: {
                    Image(systemName: notice.style == .error ? "exclamationmark.triangle.fill" : "info.circle.fill")
                        .foregroundStyle(notice.style == .error ? .red : .accentColor)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Dismisses the message")

            if let title = notice.actionTitle, let action = notice.action {
                Button(title) {
                    action()
                    dismiss()
                }
                .bold()
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: 520)
        .glassEffect(.regular, in: .capsule)
    }
}
