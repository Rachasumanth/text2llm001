import Text2llmKit
import Text2llmProtocol
import Foundation

// Prefer the Text2llmKit wrapper to keep gateway request payloads consistent.
typealias AnyCodable = Text2llmKit.AnyCodable
typealias InstanceIdentity = Text2llmKit.InstanceIdentity

extension AnyCodable {
    var stringValue: String? { self.value as? String }
    var boolValue: Bool? { self.value as? Bool }
    var intValue: Int? { self.value as? Int }
    var doubleValue: Double? { self.value as? Double }
    var dictionaryValue: [String: AnyCodable]? { self.value as? [String: AnyCodable] }
    var arrayValue: [AnyCodable]? { self.value as? [AnyCodable] }

    var foundationValue: Any {
        switch self.value {
        case let dict as [String: AnyCodable]:
            dict.mapValues { $0.foundationValue }
        case let array as [AnyCodable]:
            array.map(\.foundationValue)
        default:
            self.value
        }
    }
}

extension Text2llmProtocol.AnyCodable {
    var stringValue: String? { self.value as? String }
    var boolValue: Bool? { self.value as? Bool }
    var intValue: Int? { self.value as? Int }
    var doubleValue: Double? { self.value as? Double }
    var dictionaryValue: [String: Text2llmProtocol.AnyCodable]? { self.value as? [String: Text2llmProtocol.AnyCodable] }
    var arrayValue: [Text2llmProtocol.AnyCodable]? { self.value as? [Text2llmProtocol.AnyCodable] }

    var foundationValue: Any {
        switch self.value {
        case let dict as [String: Text2llmProtocol.AnyCodable]:
            dict.mapValues { $0.foundationValue }
        case let array as [Text2llmProtocol.AnyCodable]:
            array.map(\.foundationValue)
        default:
            self.value
        }
    }
}
