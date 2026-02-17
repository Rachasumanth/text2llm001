import Foundation

public enum Text2llmLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
