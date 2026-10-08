import SwiftUI

/// The server's OpenRouter key: where it lives, and a check that it works.
struct OpenRouterSection: View {
    @Environment(AppModel.self) private var app
    @State private var check = KeyCheck.idle

    var body: some View {
        Section {
            Button(action: verify) {
                HStack {
                    Text("Verify Key")
                    Spacer()
                    if check.isRunning {
                        ProgressView()
                    }
                }
            }
            .disabled(check.isRunning)
            switch check {
            case .answered(let verified, let message):
                ResultLabel(
                    message: message,
                    systemImage: verified ? "checkmark.seal.fill" : "exclamationmark.triangle.fill",
                    color: verified ? .green : .orange
                )
            case .failed(let message):
                ResultLabel(message: message, systemImage: "xmark.octagon.fill", color: .red)
            case .idle, .running:
                EmptyView()
            }
        } header: {
            Text("OpenRouter")
        } footer: {
            Text("Generation runs on the OPENROUTER_API_KEY set in the server's environment. This app never sees it. Without one, the server writes with its offline mock model, which costs nothing.")
        }
    }

    private func verify() {
        guard let api = app.api else { return }
        check = .running
        Task {
            do {
                let answer = try await api.verifyOpenRouterKey()
                check = .answered(verified: answer.verified, message: answer.message)
            } catch is CancellationError {
                check = .idle
            } catch {
                check = .failed((error as? LocalizedError)?.errorDescription ?? "Couldn't verify the key.")
            }
        }
    }
}
