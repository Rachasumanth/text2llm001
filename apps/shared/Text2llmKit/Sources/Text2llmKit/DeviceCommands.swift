import Foundation

public enum Text2llmDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum Text2llmBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum Text2llmThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum Text2llmNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum Text2llmNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct Text2llmBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: Text2llmBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: Text2llmBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct Text2llmThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: Text2llmThermalState

    public init(state: Text2llmThermalState) {
        self.state = state
    }
}

public struct Text2llmStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct Text2llmNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: Text2llmNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [Text2llmNetworkInterfaceType]

    public init(
        status: Text2llmNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [Text2llmNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct Text2llmDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: Text2llmBatteryStatusPayload
    public var thermal: Text2llmThermalStatusPayload
    public var storage: Text2llmStorageStatusPayload
    public var network: Text2llmNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: Text2llmBatteryStatusPayload,
        thermal: Text2llmThermalStatusPayload,
        storage: Text2llmStorageStatusPayload,
        network: Text2llmNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct Text2llmDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
