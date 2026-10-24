import Testing
@testable import Draft_Zero

struct ManuscriptItemTests {
    private func entry(_ source: StoryEntry.Source, _ index: Int) -> ManuscriptItem {
        .entry(StoryEntry(
            id: "e\(index)", position: index, source: source, text: "", actionKind: nil, inputText: nil,
            variantGroupId: "g\(index)", variantIndex: 0, variantCount: 1, variantProfilesMixed: false,
            generation: nil, costUsd: nil, reasoningTokens: nil, callStatus: nil, createdAt: ""
        ))
    }

    private func image(_ index: Int) -> ManuscriptItem {
        .image(StoryImage(
            id: "i\(index)", position: index, imageGroupId: "ig\(index)", imageIndex: 0, imageCount: 1,
            takes: [], prompt: "", sourcePrompt: nil, promptLoreIds: [], modelId: "", aspectRatio: .square,
            seed: 0, mediaType: "", costUsd: nil, callStatus: nil, slotCostUsd: nil, slotUnpricedCalls: 0,
            createdAt: ""
        ))
    }

    @Test func aMoveOpensATurnAndItsReplyStaysWithIt() {
        #expect(entry(.user, 2).startsTurn(following: [entry(.generated, 0)]))
        #expect(!entry(.generated, 4).startsTurn(following: [entry(.generated, 0), entry(.user, 2)]))
    }

    @Test func aPictureBetweenAMoveAndItsReplyKeepsThemTogether() {
        let earlier = [entry(.generated, 0), entry(.user, 2), image(3)]
        #expect(!entry(.generated, 4).startsTurn(following: earlier))
        #expect(ManuscriptItem.endsOnMove(earlier))
    }

    @Test func anUnpromptedPassageOpensATurn() {
        #expect(entry(.generated, 2).startsTurn(following: [entry(.generated, 0)]))
        #expect(entry(.generated, 4).startsTurn(following: [entry(.generated, 0), image(2)]))
    }

    @Test func picturesNeverOpenATurn() {
        #expect(!image(4).startsTurn(following: [entry(.generated, 0), entry(.user, 2)]))
    }

    @Test func theFirstPassageNeedsNoBreak() {
        #expect(!entry(.user, 0).startsTurn(following: []))
        #expect(!entry(.generated, 0).startsTurn(following: []))
    }
}
