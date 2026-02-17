import Foundation

public enum Text2llmCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum Text2llmCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum Text2llmCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum Text2llmCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct Text2llmCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: Text2llmCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: Text2llmCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: Text2llmCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: Text2llmCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct Text2llmCameraClipParams: Codable, Sendable, Equatable {
    public var facing: Text2llmCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: Text2llmCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: Text2llmCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: Text2llmCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
