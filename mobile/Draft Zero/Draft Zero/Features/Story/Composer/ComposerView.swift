import SwiftUI

/// The composer, floating over the manuscript: where the writer types a move,
/// or briefs a picture, and every move is made.
struct ComposerView: View {
    let workspace: StoryWorkspace

    @AppStorage("composerReturnSends") private var returnSends = true
    @State private var lastInputIsLane = false
    @State private var briefLineBreakRequest = 0
    @State private var laneLineBreakRequest = 0

    var body: some View {
        @Bindable var composer = workspace.composer
        let deriving = workspace.derivation.deriving
        let isImage = composer.mode == .image

        VStack(alignment: .leading, spacing: 10) {
            if isImage && composer.imageAssisted {
                LoreChipsRow(
                    matches: composer.loreMatches(in: workspace.lorebook),
                    excluded: composer.excludedLoreIds,
                    disabled: deriving,
                    toggle: composer.toggleLore
                )
            }

            ComposerTextInput(
                text: $composer.text,
                placeholder: composer.placeholder,
                accessibilityLabel: fieldLabel(for: composer),
                disabled: isImage && deriving,
                returnSends: returnSends,
                focusRequest: composer.focusRequest,
                lineBreakRequest: briefLineBreakRequest,
                onFocus: { lastInputIsLane = false },
                onTab: { if !isImage { composer.swapWritingMode() } },
                onContinue: {
                    if !isImage { workspace.generation.continueStory() }
                    else { workspace.sendFromComposer() }
                },
                send: workspace.sendFromComposer
            )
            .overlay(alignment: .topLeading) {
                if composer.text.isEmpty {
                    Text(composer.placeholder)
                        .font(Theme.proseFont)
                        .foregroundStyle(.tertiary)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }

            if isImage && composer.laneVisible {
                DevelopedPromptLane(composer: composer, deriving: deriving, returnSends: returnSends,
                                    lineBreakRequest: laneLineBreakRequest, onFocus: { lastInputIsLane = true },
                                    send: workspace.sendFromComposer)
            }

            if isImage {
                ImageOptionsRow(composer: composer, disabled: deriving || workspace.illustration.isBusy)
            }

            ComposerActionBar(workspace: workspace, insertLineBreak: {
                if lastInputIsLane && isImage && composer.laneVisible { laneLineBreakRequest += 1 }
                else { briefLineBreakRequest += 1 }
            })
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: Theme.readingWidth + 40)
        .frame(maxWidth: .infinity)
        .onChange(of: composer.laneReadyAnnouncement) {
            AccessibilityNotification.Announcement("Image prompt ready. Send to draw.").post()
        }
    }

    private func fieldLabel(for composer: ComposerModel) -> String {
        switch composer.mode {
        case .image: composer.imageAssisted ? "Image — say what the picture is" : "Image — describe the picture"
        case .do, .say: "\(composer.mode.label) — write your next move"
        }
    }
}
