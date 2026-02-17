// swift-tools-version: 6.2
// Package manifest for the text2llm macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "text2llm",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "Text2llmIPC", targets: ["Text2llmIPC"]),
        .library(name: "Text2llmDiscovery", targets: ["Text2llmDiscovery"]),
        .executable(name: "text2llm", targets: ["text2llm"]),
        .executable(name: "text2llm-mac", targets: ["Text2llmMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/Text2llmKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "Text2llmIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "Text2llmDiscovery",
            dependencies: [
                .product(name: "Text2llmKit", package: "Text2llmKit"),
            ],
            path: "Sources/Text2llmDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "text2llm",
            dependencies: [
                "Text2llmIPC",
                "Text2llmDiscovery",
                .product(name: "Text2llmKit", package: "Text2llmKit"),
                .product(name: "Text2llmChatUI", package: "Text2llmKit"),
                .product(name: "Text2llmProtocol", package: "Text2llmKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/text2llm.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Text2llmMacCLI",
            dependencies: [
                "Text2llmDiscovery",
                .product(name: "Text2llmKit", package: "Text2llmKit"),
                .product(name: "Text2llmProtocol", package: "Text2llmKit"),
            ],
            path: "Sources/Text2llmMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "Text2llmIPCTests",
            dependencies: [
                "Text2llmIPC",
                "text2llm",
                "Text2llmDiscovery",
                .product(name: "Text2llmProtocol", package: "Text2llmKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
