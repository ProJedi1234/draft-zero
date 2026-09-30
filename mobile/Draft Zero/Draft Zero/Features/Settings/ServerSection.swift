import SwiftUI

/// Which server this device talks to, whether it is answering, and the way
/// back to setup. Shown even when nothing else loads, since a dead server is
/// exactly when a writer needs "Change Server".
struct ServerSection: View {
    @Environment(AppModel.self) private var app
    @State private var check = ConnectionCheck.idle
    @State private var isConfirmingChange = false

    var body: some View {
        Section {
            LabeledContent("Address") {
                Text(app.serverURL?.absoluteString ?? "None")
                    .textSelection(.enabled)
            }
            LabeledContent("Status") {
                ConnectionStatusLabel(connection: app.effectiveConnection)
            }
            if case .offline(let message) = app.effectiveConnection {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Button(action: runCheck) {
                HStack {
                    Text("Check Connection")
                    Spacer()
                    if check.isRunning {
                        ProgressView()
                    }
                }
            }
            .disabled(check.isRunning)
            CheckResultRow(check: check)
            Button("Change Server…", role: .destructive, action: confirmChange)
                .confirmationDialog("Change server?", isPresented: $isConfirmingChange, titleVisibility: .visible) {
                    Button("Disconnect", role: .destructive, action: disconnect)
                } message: {
                    Text("This device forgets \(app.serverURL?.host() ?? "this server") and goes back to setup. Your stories stay on the server.")
                }
        } header: {
            Text("Server")
        }
    }

    private func runCheck() {
        guard let api = app.api else { return }
        check = .running
        Task {
            let clock = ContinuousClock()
            let start = clock.now
            do {
                let healthy = try await api.health()
                check = healthy
                    ? .healthy(start.duration(to: clock.now))
                    : .failed("The server answered, but says it isn't healthy.")
            } catch is CancellationError {
                check = .idle
            } catch {
                check = .failed((error as? LocalizedError)?.errorDescription ?? "Couldn't reach the server.")
            }
        }
    }

    private func confirmChange() {
        isConfirmingChange = true
    }

    private func disconnect() {
        app.disconnect()
    }
}
