import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-text2llm writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.text2llm.mac"
let gatewayLaunchdLabel = "ai.text2llm.gateway"
let onboardingVersionKey = "text2llm.onboardingVersion"
let onboardingSeenKey = "text2llm.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "text2llm.pauseEnabled"
let iconAnimationsEnabledKey = "text2llm.iconAnimationsEnabled"
let swabbleEnabledKey = "text2llm.swabbleEnabled"
let swabbleTriggersKey = "text2llm.swabbleTriggers"
let voiceWakeTriggerChimeKey = "text2llm.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "text2llm.voiceWakeSendChime"
let showDockIconKey = "text2llm.showDockIcon"
let defaultVoiceWakeTriggers = ["text2llm"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "text2llm.voiceWakeMicID"
let voiceWakeMicNameKey = "text2llm.voiceWakeMicName"
let voiceWakeLocaleKey = "text2llm.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "text2llm.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "text2llm.voicePushToTalkEnabled"
let talkEnabledKey = "text2llm.talkEnabled"
let iconOverrideKey = "text2llm.iconOverride"
let connectionModeKey = "text2llm.connectionMode"
let remoteTargetKey = "text2llm.remoteTarget"
let remoteIdentityKey = "text2llm.remoteIdentity"
let remoteProjectRootKey = "text2llm.remoteProjectRoot"
let remoteCliPathKey = "text2llm.remoteCliPath"
let canvasEnabledKey = "text2llm.canvasEnabled"
let cameraEnabledKey = "text2llm.cameraEnabled"
let systemRunPolicyKey = "text2llm.systemRunPolicy"
let systemRunAllowlistKey = "text2llm.systemRunAllowlist"
let systemRunEnabledKey = "text2llm.systemRunEnabled"
let locationModeKey = "text2llm.locationMode"
let locationPreciseKey = "text2llm.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "text2llm.peekabooBridgeEnabled"
let deepLinkKeyKey = "text2llm.deepLinkKey"
let modelCatalogPathKey = "text2llm.modelCatalogPath"
let modelCatalogReloadKey = "text2llm.modelCatalogReload"
let cliInstallPromptedVersionKey = "text2llm.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "text2llm.heartbeatsEnabled"
let debugPaneEnabledKey = "text2llm.debugPaneEnabled"
let debugFileLogEnabledKey = "text2llm.debug.fileLogEnabled"
let appLogLevelKey = "text2llm.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
