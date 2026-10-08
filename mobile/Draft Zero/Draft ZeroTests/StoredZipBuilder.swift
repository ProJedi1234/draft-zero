import Foundation

/// Builds an uncompressed zip in memory, so backup tests can describe an
/// archive inline instead of shipping one per case. CRCs are left at zero;
/// the reader under test doesn't check them.
enum StoredZipBuilder {
    static func zip(_ files: [(name: String, text: String)]) -> Data {
        var archive = Data()
        var directory = Data()
        for file in files {
            let name = Data(file.name.utf8)
            let body = Data(file.text.utf8)
            let offset = UInt32(archive.count)

            archive.append(le32(0x0403_4B50))
            archive.append(le16(20)); archive.append(le16(0)); archive.append(le16(0))
            archive.append(le16(0)); archive.append(le16(0))
            archive.append(le32(0)); archive.append(le32(UInt32(body.count))); archive.append(le32(UInt32(body.count)))
            archive.append(le16(UInt16(name.count))); archive.append(le16(0))
            archive.append(name); archive.append(body)

            directory.append(le32(0x0201_4B50))
            directory.append(le16(20)); directory.append(le16(20)); directory.append(le16(0)); directory.append(le16(0))
            directory.append(le16(0)); directory.append(le16(0))
            directory.append(le32(0)); directory.append(le32(UInt32(body.count))); directory.append(le32(UInt32(body.count)))
            directory.append(le16(UInt16(name.count))); directory.append(le16(0)); directory.append(le16(0))
            directory.append(le16(0)); directory.append(le16(0)); directory.append(le32(0))
            directory.append(le32(offset))
            directory.append(name)
        }
        let directoryOffset = UInt32(archive.count)
        archive.append(directory)
        archive.append(le32(0x0605_4B50))
        archive.append(le16(0)); archive.append(le16(0))
        archive.append(le16(UInt16(files.count))); archive.append(le16(UInt16(files.count)))
        archive.append(le32(UInt32(directory.count))); archive.append(le32(directoryOffset))
        archive.append(le16(0))
        return archive
    }

    /// A backup whose metadata carries `adventure` and `state`, plus action parts.
    static func backup(
        metadata: String = #"{"adventure":{"title":"Zach"},"state":{}}"#,
        parts: [(name: String, actions: String)]
    ) -> Data {
        zip([("metadata.json", metadata)] + parts.map { ($0.name, #"{"actions":\#($0.actions)}"#) })
    }

    private static func le16(_ value: UInt16) -> Data {
        withUnsafeBytes(of: value.littleEndian) { Data($0) }
    }

    private static func le32(_ value: UInt32) -> Data {
        withUnsafeBytes(of: value.littleEndian) { Data($0) }
    }
}
