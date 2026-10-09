import SwiftUI

/// The local Ollama host: whether it is answering, what it holds in memory,
/// and the window every local request is sent with. Read-only, because the
/// host and its window are server configuration.
struct LocalModelsSection: View {
    let status: LocalModelsStatus
    let models: [OpenRouterModel]
    let decisionModels: [DecisionModel]
    let summarizer: AppSettings.Summarizer
    let atmosphere: AppSettings.Atmosphere

    var body: some View {
        Section {
            LabeledContent("Status") {
                HStack(spacing: 6) {
                    Circle()
                        .fill(status.reachable ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(status.reachable ? "Answering" : "Not answering")
                }
            }
            if status.reachable {
                LabeledContent("Ollama", value: status.version ?? "unknown")
                LabeledContent("Models", value: "\(status.chatModels) chat · \(status.decisionModels) decision")
            }
            LabeledContent("Endpoint") {
                Text(status.baseUrl)
                    .font(.footnote.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            LabeledContent("In memory", value: inMemory)
            LabeledContent("Context window", value: "\(status.contextWindow.formatted()) tokens")
            if let warning = backgroundWarning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        } header: {
            Text("Local models")
        } footer: {
            Text("Served by Ollama on \(status.host). They cost nothing, and the prose never leaves your network. The context window is set on the server with OLLAMA_NUM_CTX; a request asking for a different one reloads the model.")
        }
    }

    private var inMemory: String {
        guard !status.loaded.isEmpty else { return "Nothing loaded" }
        return status.loaded.map(\.name).joined(separator: ", ")
    }

    /// Background jobs on a local model share its one slot with the story, so
    /// each one evicts the story's cached prompt.
    private var backgroundWarning: String? {
        var jobs: [(job: String, modelId: String)] = [("summarizer", summarizer.modelId ?? BuiltInModels.summarizer)]
        switch atmosphere.engine {
        case .llm: jobs.append(("atmosphere check", atmosphere.modelId ?? BuiltInModels.atmosphere))
        case .decision: jobs.append(("atmosphere check", atmosphere.decisionModelId ?? BuiltInModels.atmosphereDecision))
        }
        let local = jobs.filter { $0.modelId.hasPrefix(LocalModels.idPrefix) }
        guard !local.isEmpty else { return nil }
        let names = Array(Set(local.map { name(of: $0.modelId) })).sorted()
        let verb = local.count == 1 ? "runs" : "run"
        return "Your \(local.map(\.job).joined(separator: " and ")) \(verb) on \(names.joined(separator: " and ")). \(status.host) answers one request at a time, so each of these pushes a story out of the model's cache and the next passage re-reads it."
    }

    private func name(of modelId: String) -> String {
        decisionModels.first { $0.id == modelId }?.name ?? ModelCatalog.displayName(modelId, in: models)
    }
}
