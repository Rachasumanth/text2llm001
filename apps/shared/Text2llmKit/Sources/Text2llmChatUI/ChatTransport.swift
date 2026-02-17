import Foundation

public enum Text2llmChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(Text2llmChatEventPayload)
    case agent(Text2llmAgentEventPayload)
    case seqGap
}

public protocol Text2llmChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> Text2llmChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [Text2llmChatAttachmentPayload]) async throws -> Text2llmChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> Text2llmChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<Text2llmChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension Text2llmChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "Text2llmChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> Text2llmChatSessionsListResponse {
        throw NSError(
            domain: "Text2llmChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
