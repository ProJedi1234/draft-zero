import Foundation

/// A read file waiting on the writer's go-ahead; drives the import sheet.
struct PendingImport: Identifiable {
    let id = UUID()
    let content: ImportContent
}
