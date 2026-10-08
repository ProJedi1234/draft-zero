import SwiftUI

/// The next request's context, section by section: the breakdown a finished
/// passage shows, composed now instead of read back afterwards.
struct NextContextSheet: View {
    let loader: NextContextLoader

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let context = loader.context {
                    ContextBreakdownList(context: context, entry: nil)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("Next Passage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: close)
                }
            }
        }
    }

    private func close() {
        dismiss()
    }
}
