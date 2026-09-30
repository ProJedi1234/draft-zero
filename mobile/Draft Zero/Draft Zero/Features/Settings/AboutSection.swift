import SwiftUI

/// Which build this is, for bug reports.
struct AboutSection: View {
    private let info = Bundle.main.infoDictionary ?? [:]

    var body: some View {
        Section("About") {
            LabeledContent("Version", value: info["CFBundleShortVersionString"] as? String ?? "—")
            LabeledContent("Build", value: info["CFBundleVersion"] as? String ?? "—")
        }
    }
}
