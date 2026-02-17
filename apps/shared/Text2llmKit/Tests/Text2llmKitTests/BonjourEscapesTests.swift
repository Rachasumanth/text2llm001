import Text2llmKit
import Testing

@Suite struct BonjourEscapesTests {
    @Test func decodePassThrough() {
        #expect(BonjourEscapes.decode("hello") == "hello")
        #expect(BonjourEscapes.decode("") == "")
    }

    @Test func decodeSpaces() {
        #expect(BonjourEscapes.decode("text2llm\\032Gateway") == "text2llm Gateway")
    }

    @Test func decodeMultipleEscapes() {
        #expect(BonjourEscapes.decode("A\\038B\\047C\\032D") == "A&B/C D")
    }

    @Test func decodeIgnoresInvalidEscapeSequences() {
        #expect(BonjourEscapes.decode("Hello\\03World") == "Hello\\03World")
        #expect(BonjourEscapes.decode("Hello\\XYZWorld") == "Hello\\XYZWorld")
    }

    @Test func decodeUsesDecimalUnicodeScalarValue() {
        #expect(BonjourEscapes.decode("Hello\\065World") == "HelloAWorld")
    }
}
