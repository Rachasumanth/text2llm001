import CoreLocation
import Foundation
import Text2llmKit
import UIKit

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: Text2llmCameraSnapParams) async throws -> (format: String, base64: String, width: Int, height: Int)
    func clip(params: Text2llmCameraClipParams) async throws -> (format: String, base64: String, durationMs: Int, hasAudio: Bool)
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: Text2llmLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: Text2llmLocationGetParams,
        desiredAccuracy: Text2llmLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> Text2llmDeviceStatusPayload
    func info() -> Text2llmDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: Text2llmPhotosLatestParams) async throws -> Text2llmPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: Text2llmContactsSearchParams) async throws -> Text2llmContactsSearchPayload
    func add(params: Text2llmContactsAddParams) async throws -> Text2llmContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: Text2llmCalendarEventsParams) async throws -> Text2llmCalendarEventsPayload
    func add(params: Text2llmCalendarAddParams) async throws -> Text2llmCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: Text2llmRemindersListParams) async throws -> Text2llmRemindersListPayload
    func add(params: Text2llmRemindersAddParams) async throws -> Text2llmRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: Text2llmMotionActivityParams) async throws -> Text2llmMotionActivityPayload
    func pedometer(params: Text2llmPedometerParams) async throws -> Text2llmPedometerPayload
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
