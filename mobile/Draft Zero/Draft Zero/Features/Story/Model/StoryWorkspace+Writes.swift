import Foundation

/// Every write the story screen makes. Each ends in a fresh read, because the
/// server decides what the manuscript looks like afterwards (take order,
/// undo history, word counts, cost).
extension StoryWorkspace {
    // MARK: - Passages

    /// Rewrites a passage's prose. Clears its Say/Do pair, as the web editor does.
    func editEntryText(_ entry: StoryEntry, text: String) async -> Bool {
        await write("Couldn't save that passage.") { [api, storyId] in
            try await api.updateEntryText(entryId: entry.id, storyId: storyId, text: text)
        }
    }

    /// Re-edits a player turn from its first-person input; the server re-translates it.
    func editAction(_ entry: StoryEntry, rawText: String, kind: ActionKind) async -> Bool {
        await write("Couldn't save that move.") { [api, storyId] in
            try await api.updateActionEntry(entryId: entry.id, storyId: storyId, rawText: rawText, kind: kind)
        }
    }

    /// Soft-deletes a passage; undoable from the composer.
    func deleteEntry(_ entry: StoryEntry) async -> Bool {
        await write("Couldn't delete that passage.") { [api, storyId] in
            try await api.deleteEntry(entryId: entry.id, storyId: storyId)
        }
    }

    /// Sets aside every passage after this one, as one undo step.
    func rewind(to entry: StoryEntry) async -> Bool {
        await write("Couldn't rewind the story.") { [api, storyId] in
            try await api.rewind(toEntry: entry.id, storyId: storyId)
        }
    }

    /// Steps the newest passage to its previous or next take.
    func stepVariant(_ entry: StoryEntry, by offset: Int) async {
        _ = await write("Couldn't switch takes.") { [api, storyId] in
            _ = try await api.selectVariant(storyId: storyId, entryId: entry.id, offset: offset)
        }
    }

    /// Passages after this one, as the reader can count them.
    func followingCount(after entry: StoryEntry) -> Int {
        let entries = loadedEntries
        guard let index = entries.firstIndex(where: { $0.id == entry.id }) else { return 0 }
        return entries.count - 1 - index
    }

    /// What this passage would be sent now.
    func context(for entry: StoryEntry) async throws -> EntryContext? {
        try await api.entryContext(entryId: entry.id, storyId: storyId)
    }

    // MARK: - Pictures

    /// Redraws a picture as a new take of its slot, optionally with another image model.
    func retryImage(_ image: StoryImage, modelId: String? = nil) {
        illustration.generate(IllustrationController.Request(
            prompt: image.prompt,
            sourcePrompt: image.sourcePrompt,
            promptLoreIds: image.promptLoreIds,
            aspectRatio: image.aspectRatio,
            imageGroupId: image.imageGroupId,
            modelId: modelId
        ))
    }

    /// Puts a picture's prompt back in the composer, armed to redraw it.
    func editImagePrompt(_ image: StoryImage) {
        composer.aspectRatio = image.aspectRatio
        composer.restoreImagePrompt(prompt: image.prompt, sourcePrompt: image.sourcePrompt)
    }

    func stepImage(_ image: StoryImage, by offset: Int) async {
        _ = await write("Couldn't switch pictures.") { [api, storyId] in
            try await api.stepImage(storyId: storyId, imageGroupId: image.imageGroupId, offset: offset)
        }
    }

    func selectImageTake(_ image: StoryImage, takeId: String) async {
        _ = await write("Couldn't switch pictures.") { [api, storyId] in
            try await api.selectImage(storyId: storyId, imageGroupId: image.imageGroupId, imageId: takeId)
        }
    }

    /// Removes the whole slot, with an Undo rather than a confirmation: it is a soft delete.
    func deleteImage(_ image: StoryImage) async {
        let removed = await write("Couldn't remove that illustration.") { [api, storyId] in
            try await api.deleteIllustration(storyId: storyId, imageGroupId: image.imageGroupId)
        }
        guard removed else { return }
        notices.info("Illustration removed.", actionTitle: "Undo") { [weak self] in
            guard let self else { return }
            Task {
                _ = await self.write("Couldn't restore that illustration.") { [api = self.api, storyId = self.storyId] in
                    try await api.restoreIllustration(storyId: storyId, imageGroupId: image.imageGroupId)
                }
            }
        }
    }

    // MARK: - Story settings

    /// Title, description, genre, memory, author's note, narrator prompt, summarize.
    func updateMeta(_ patch: JSONObject) async -> Bool {
        await write("Couldn't save the story.") { [api, storyId, library] in
            let record = try await api.updateStoryMeta(storyId, patch: patch)
            library.upsert(record)
        }
    }

    /// A partial GenerationSettings patch. Changing the model resets the provider pin.
    func updateGenerationSettings(_ patch: JSONObject) async -> Bool {
        await write("Couldn't save the model settings.") { [api, storyId] in
            try await api.updateGenerationSettings(storyId, patch: patch)
        }
    }

    /// Follows a profile, or nil for Custom.
    func setProfile(_ profileId: String?) async -> Bool {
        await write("Couldn't switch profiles.") { [api, storyId] in
            try await api.setStoryProfile(storyId: storyId, profileId: profileId)
        }
    }

    /// Saves the story's settings as a new profile and follows it.
    func saveAsProfile(named name: String) async -> Bool {
        await write("Couldn't save that profile.") { [api, storyId] in
            _ = try await api.saveStoryAsProfile(storyId: storyId, name: name)
        }
    }

    /// Paints the room by hand, which also takes the tint back from the picker.
    func setTint(_ tint: StoryTintValue?) async -> Bool {
        await write("Couldn't change the atmosphere.") { [api, storyId, library] in
            let record = try await api.updateStoryTint(storyId, hue: tint?.hue, strength: tint?.strength, auto: false)
            library.upsert(record)
        }
    }

    /// Hands the tint back to the atmosphere picker, or takes it.
    func setTintAuto(_ auto: Bool) async -> Bool {
        await write("Couldn't change the atmosphere.") { [api, storyId, library] in
            let record = try await api.setStoryTintAuto(storyId, auto: auto)
            library.upsert(record)
        }
    }

    /// The story's image model, or nil to follow the app default.
    func setImageModel(_ modelId: String?) async -> Bool {
        await write("Couldn't change the image model.") { [api, storyId] in
            try await api.setStoryImageModel(storyId, imageModelId: modelId)
        }
    }

    // MARK: - Lore

    func createLore(_ entry: NewLorebookEntry) async -> LorebookEntry? {
        var created: LorebookEntry?
        _ = await write("Couldn't add that entry.") { [api, storyId] in
            created = try await api.createLorebookEntry(storyId: storyId, id: RandomID.make(), entry: entry)
        }
        return created
    }

    func updateLore(_ entryId: String, patch: JSONObject) async -> Bool {
        await write("Couldn't save that entry.") { [api] in
            _ = try await api.updateLorebookEntry(entryId, patch: patch)
        }
    }

    func deleteLore(_ entryId: String) async -> Bool {
        await write("Couldn't delete that entry.") { [api] in
            try await api.deleteLorebookEntry(entryId)
        }
    }

    // MARK: - Plumbing

    /// Runs a write, reports its failure, and reads the result back either way.
    @discardableResult
    func write(_ failure: String, _ operation: () async throws -> Void) async -> Bool {
        do {
            try await operation()
            await refreshNow()
            return true
        } catch is CancellationError {
            return false
        } catch {
            notices.error(error, fallback: failure)
            await refreshNow()
            return false
        }
    }
}
