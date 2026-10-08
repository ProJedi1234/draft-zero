import Foundation
import Testing
@testable import Draft_Zero

struct LoreMatcherTests {
    private func entry(_ id: String, name: String, keys: [String], content: String = "", priority: Int = 50, alwaysActive: Bool = false, enabled: Bool = true) -> LorebookEntry {
        LorebookEntry(
            id: id, storyId: "s", name: name, category: .concept, keys: keys, content: content,
            enabled: enabled, alwaysActive: alwaysActive, priority: priority, createdAt: "", updatedAt: ""
        )
    }

    @Test func directMatchesCascadeAndAlwaysActive() {
        let entries = [
            entry("a", name: "Wren", keys: ["wren"], content: "She tends the lantern.", priority: 80),
            entry("b", name: "Lantern", keys: ["lantern"], priority: 60),
            entry("c", name: "Moons", keys: [], priority: 10, alwaysActive: true),
            entry("d", name: "Muted", keys: ["wren"], enabled: false),
        ]
        let matches = LoreMatcher.matchBrief(entries, brief: "Wren at the door")
        #expect(matches.map(\.entry.id) == ["a", "b", "c"])
        #expect(matches[0].triggeredBy == .source(.story))
        #expect(matches[1].depth == 1)
        #expect(matches[1].triggeredBy == .lore(id: "a", name: "Wren"))
        #expect(matches[2].triggeredBy == nil)
    }

    @Test func selectionHonoursMutesAndBudget() {
        let long = String(repeating: "x", count: LoreMatcher.briefLoreCharBudget)
        let entries = [
            entry("a", name: "A", keys: ["alpha"], content: long, priority: 90),
            entry("b", name: "B", keys: ["alpha"], content: "short", priority: 50),
        ]
        #expect(LoreMatcher.selectBrief(entries, brief: "alpha", excluding: []).map(\.entry.id) == ["a"])
        #expect(LoreMatcher.selectBrief(entries, brief: "alpha", excluding: ["a"]).map(\.entry.id) == ["b"])
    }
}

struct ImageStylesTests {
    @Test func composeAndSplitRoundTrip() {
        let sent = ImageStyles.compose(scene: "A lighthouse at dusk", style: "oil painting, visible brushwork.")
        #expect(sent == "A lighthouse at dusk Style: oil painting, visible brushwork.")
        let split = ImageStyles.split(sent)
        #expect(split.scene == "A lighthouse at dusk")
        #expect(split.style == "oil painting, visible brushwork")
        #expect(ImageStyles.compose(scene: split.scene, style: split.style) == sent)
    }

    @Test func unstyledPromptsSplitToThemselves() {
        #expect(ImageStyles.split("Just a scene.").scene == "Just a scene.")
        #expect(ImageStyles.split("Just a scene.").style == nil)
        #expect(ImageStyles.compose(scene: "Scene", style: nil) == "Scene")
    }
}

struct FormatTests {
    @Test(arguments: [
        ("0", "$0"), ("0.00005", "<$0.0001"), ("0.0042", "$0.0042"), ("0.125", "$0.125"),
        ("3.5", "$3.50"), ("1234.4", "$1,234"),
    ])
    func usd(input: String, expected: String) {
        #expect(Format.usd(input) == expected)
    }

    @Test(arguments: [
        ("google-vertex/europe", nil, "🇪🇺", "Europe"),
        ("google-vertex/global/priority", nil, "🌐 priority", "Global, priority"),
        ("amazon-bedrock/us-east-1", nil, "🇺🇸 east-1", "United States east-1"),
        ("azure/swedencentral", nil, "🇸🇪", "Sweden"),
        ("xai/zdr/us", nil, "zdr 🇺🇸", "zdr, United States"),
        ("deepinfra/turbo", "fp8", "turbo", "turbo"),
    ] as [(String, String?, String, String)])
    func endpointVariant(tag: String, quantization: String?, text: String, label: String) {
        let variant = Format.endpointVariant(tag, quantization: quantization)
        #expect(variant?.text == text)
        #expect(variant?.label == label)
    }

    @Test func bareOrQuantizationOnlyTagsHaveNoVariant() {
        #expect(Format.endpointVariant("anthropic") == nil)
        #expect(Format.endpointVariant("xiaomi/fp8", quantization: "fp8") == nil)
    }

    @Test func unknownCostIsADash() {
        #expect(Format.usd(nil as String?) == "—")
        #expect(Format.usdFloor("0.42", unpriced: 1) == "$0.420+")
        #expect(Format.usdFloor("0.42", unpriced: 0) == "$0.420")
    }

    @Test func tokensAndContext() {
        #expect(Format.tokens(1500) == "1.5k")
        #expect(Format.contextLength(131_072) == "131K")
        #expect(GenerationLimits.contextWindowLabel(131_072) == "128k")
        #expect(GenerationLimits.clampContextWindow(131_072, contextLength: 32_768) == 32_768)
    }
}
