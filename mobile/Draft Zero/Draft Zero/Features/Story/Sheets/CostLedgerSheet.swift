import Charts
import SwiftUI

/// What this story has cost: the total (a floor when calls went unpriced),
/// spend by model, and spend per passage in manuscript order.
struct CostLedgerSheet: View {
    let workspace: StoryWorkspace

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let profile = workspace.costProfile {
                    CostLedgerList(profile: profile, openUsage: openUsage)
                } else {
                    ContentUnavailableView("No Spend Yet", systemImage: "dollarsign.circle")
                }
            }
            .navigationTitle("Cost")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func openUsage() {
        dismiss()
        app.selectedTab = .usage
    }
}
