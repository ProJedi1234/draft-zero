import SwiftUI

/// What a story-card merge added, what it left alone, and anything it warned about.
struct LorebookImportSummarySheet: View {
    let report: LorebookMergeReport

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Added") {
                        Text(report.added, format: .number)
                    }
                    LabeledContent {
                        Text(report.skipped, format: .number)
                    } label: {
                        Text("Skipped")
                        Text("Already in this lorebook by name, and left as they are.")
                    }
                }
                if !report.warnings.isEmpty {
                    Section("Warnings") {
                        ForEach(report.warnings, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.triangle")
                        }
                    }
                }
            }
            .navigationTitle(report.headline)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm, action: close)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func close() {
        dismiss()
    }
}
