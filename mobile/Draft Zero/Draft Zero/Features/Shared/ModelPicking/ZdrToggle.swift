import SwiftUI

/// "Route only through providers that keep nothing", as it appears app-wide,
/// per profile, per bundle and per story. A locked switch shows on because the
/// request goes out retention-free either way.
struct ZdrToggle: View {
    let title: String
    @Binding var isOn: Bool
    let lock: ZdrLock?
    let hint: String
    /// What the account already enforces for some groups, too partial to lock this.
    let accountNote: String?

    init(
        _ title: String = "Zero data retention",
        isOn: Binding<Bool>,
        lock: ZdrLock?,
        hint: String = "Only route to providers that keep nothing.",
        accountNote: String? = nil
    ) {
        self.title = title
        self._isOn = isOn
        self.lock = lock
        self.hint = hint
        self.accountNote = accountNote
    }

    var body: some View {
        Toggle(isOn: lock == nil ? $isOn : .constant(true)) {
            Text(title)
            Text(lock?.note ?? hint)
        }
        .disabled(lock != nil)
        if let accountNote, lock == nil {
            Text(accountNote)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        if lock == .account || (accountNote != nil && lock == nil) {
            Link(destination: OpenRouterLinks.privacySettings) {
                Label("OpenRouter Privacy Settings", systemImage: "arrow.up.forward.square")
            }
        }
    }
}
