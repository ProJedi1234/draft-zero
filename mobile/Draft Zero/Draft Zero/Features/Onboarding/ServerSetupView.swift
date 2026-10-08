import SwiftUI

/// The first screen: which Draft Zero server this device talks to.
struct ServerSetupView: View {
    @Environment(AppModel.self) private var app
    @State private var address = ""
    @State private var isConnecting = false
    @State private var error: String?
    @FocusState private var addressFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "text.book.closed")
                            .font(.system(size: 44))
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        Text("Draft Zero")
                            .font(.system(.largeTitle, design: .serif))
                            .bold()
                        Text("Connect to the Draft Zero server you run yourself. Stories, lore and pictures stay on it; this device is a window onto them.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                }
                .listRowBackground(Color.clear)

                Section {
                    TextField("argos.lan:3000", text: $address)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($addressFocused)
                        .submitLabel(.go)
                        .onSubmit(connect)
                } header: {
                    Text("Server address")
                } footer: {
                    if let error {
                        Text(error).foregroundStyle(.red)
                    } else {
                        Text("A host and port, like 192.168.1.20:3000, or a full URL. Plain http is fine on your own network.")
                    }
                }

                Section {
                    Button(action: connect) {
                        HStack {
                            Text(isConnecting ? "Connecting…" : "Connect")
                            Spacer()
                            if isConnecting { ProgressView() }
                        }
                    }
                    .disabled(isConnecting || AppModel.serverURL(from: address) == nil)
                }
            }
            .navigationTitle("Welcome")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { addressFocused = true }
        }
    }

    private func connect() {
        guard let url = AppModel.serverURL(from: address), !isConnecting else { return }
        isConnecting = true
        error = nil
        Task {
            do {
                try await app.connect(to: url)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't reach that server."
            }
            isConnecting = false
        }
    }
}

#Preview {
    ServerSetupView()
        .environment(AppModel())
}
