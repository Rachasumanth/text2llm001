import Foundation
import Testing
@testable import text2llm

@Suite(.serialized)
struct Text2llmConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("text2llm-config-\(UUID().uuidString)")
            .appendingPathComponent("text2llm.json")
            .path

        await TestIsolation.withEnvValues(["TEXT2LLM_CONFIG_PATH": override]) {
            #expect(Text2llmConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("text2llm-config-\(UUID().uuidString)")
            .appendingPathComponent("text2llm.json")
            .path

        await TestIsolation.withEnvValues(["TEXT2LLM_CONFIG_PATH": override]) {
            Text2llmConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(Text2llmConfigFile.remoteGatewayPort() == 19999)
            #expect(Text2llmConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(Text2llmConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(Text2llmConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("text2llm-config-\(UUID().uuidString)")
            .appendingPathComponent("text2llm.json")
            .path

        await TestIsolation.withEnvValues(["TEXT2LLM_CONFIG_PATH": override]) {
            Text2llmConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            Text2llmConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = Text2llmConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("text2llm-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "TEXT2LLM_CONFIG_PATH": nil,
            "TEXT2LLM_STATE_DIR": dir,
        ]) {
            #expect(Text2llmConfigFile.stateDirURL().path == dir)
            #expect(Text2llmConfigFile.url().path == "\(dir)/text2llm.json")
        }
    }
}
