// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "Text2llmKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "Text2llmProtocol", targets: ["Text2llmProtocol"]),
        .library(name: "Text2llmKit", targets: ["Text2llmKit"]),
        .library(name: "Text2llmChatUI", targets: ["Text2llmChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "Text2llmProtocol",
            path: "Sources/Text2llmProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "Text2llmKit",
            dependencies: [
                "Text2llmProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/Text2llmKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "Text2llmChatUI",
            dependencies: [
                "Text2llmKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/Text2llmChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "Text2llmKitTests",
            dependencies: ["Text2llmKit", "Text2llmChatUI"],
            path: "Tests/Text2llmKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
