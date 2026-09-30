import SwiftUI

/// Edits a passage. A player turn is edited as what the writer typed, in first
/// person, and re-translated; any passage can also be rewritten as prose.
struct PassageEditorSheet: View {
    let entry: StoryEntry
    let workspace: StoryWorkspace

    enum Target: Hashable {
        case move
        case prose
    }

    @Environment(\.dismiss) private var dismiss
    @State private var target: Target
    @State private var kind: ActionKind
    @State private var rawText: String
    @State private var prose: String
    @State private var saving = false
    @FocusState private var focused: Bool

    init(entry: StoryEntry, workspace: StoryWorkspace) {
        self.entry = entry
        self.workspace = workspace
        let isMove = entry.actionKind != nil && entry.inputText != nil
        _target = State(initialValue: isMove ? .move : .prose)
        _kind = State(initialValue: entry.actionKind ?? .do)
        _rawText = State(initialValue: entry.inputText ?? "")
        _prose = State(initialValue: entry.text)
    }

    private var isMove: Bool { entry.actionKind != nil && entry.inputText != nil }

    var body: some View {
        NavigationStack {
            Form {
                if isMove {
                    Picker("Edit", selection: $target) {
                        Text("Your Move").tag(Target.move)
                        Text("Prose").tag(Target.prose)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }

                if target == .move {
                    Section {
                        Picker("Move", selection: $kind) {
                            Label("Do", systemImage: ComposerMode.do.systemImage).tag(ActionKind.do)
                            Label("Say", systemImage: ComposerMode.say.systemImage).tag(ActionKind.say)
                        }
                        .pickerStyle(.segmented)
                        TextField(kind == .say ? "What do you say?" : "What do you do?", text: $rawText, axis: .vertical)
                            .font(Theme.proseFont)
                            .lineLimit(3...12)
                            .focused($focused)
                    } footer: {
                        Text("In first person, as you typed it.")
                    }
                    Section("Lands on the page as") {
                        Text(preview.isEmpty ? "—" : preview)
                            .font(Theme.proseFont)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        TextField("Passage", text: $prose, axis: .vertical)
                            .font(Theme.proseFont)
                            .lineLimit(6...40)
                            .focused($focused)
                    } footer: {
                        if isMove {
                            Text("Saving the prose directly unlinks it from what you typed.")
                        }
                    }
                }
            }
            .navigationTitle(isMove ? "Edit Your \(kind.label)" : "Edit Passage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(saving || !canSave)
                        .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .interactiveDismissDisabled(isDirty)
            .onAppear { focused = true }
        }
    }

    private var preview: String { ActionVoice.translate(kind, rawText) }

    private var canSave: Bool {
        target == .move ? !preview.isEmpty : !prose.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isDirty: Bool {
        rawText != (entry.inputText ?? "") || prose != entry.text || kind != (entry.actionKind ?? .do)
    }

    private func save() {
        saving = true
        Task {
            let saved = target == .move
                ? await workspace.editAction(entry, rawText: rawText, kind: kind)
                : await workspace.editEntryText(entry, text: prose)
            saving = false
            if saved { dismiss() }
        }
    }
}
