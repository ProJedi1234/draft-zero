import SwiftUI

extension EnvironmentValues {
    /// The inspector is a sheet over the story (iPhone, narrow iPad) rather
    /// than a column beside it. The size class can't tell: the column reads
    /// compact too.
    @Entry var inspectorIsSheet = true
}
