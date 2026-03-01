/**
 * Utility functions for provider-specific logic and capabilities.
 */

/**
 * Returns true if the provider requires reasoning to be wrapped in tags
 * (e.g. <think> and <final>) in the text stream, rather than using native
 * API fields for reasoning/thinking.
 */
export function isReasoningTagProvider(provider: string | undefined | null): boolean {
  if (!provider) {
    return false;
  }
  const normalized = provider.trim().toLowerCase();

  // Check for exact matches or known prefixes/substrings for reasoning providers
  if (
    normalized === "ollama" ||
    normalized === "minimax"
  ) {
    return true;
  }

  // Minimax uses tags because native reasoning streams are not available/reliable on some nodes
  if (normalized.includes("minimax")) {
    return true;
  }

  return false;
}
