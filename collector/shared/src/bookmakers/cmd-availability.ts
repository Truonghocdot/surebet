export const CMD_AVAILABILITY_CONFIG = {
  boundarySelector: ".match.default-match, .match.copy-match",
  unavailableClassPatternSource:
    "\\b(?:disabled|locked|suspend(?:ed)?|closed|unavailable|inactive|is-hidden|hidden|hide|d-none|cursor-default)\\b",
  unavailableStylePatternSource:
    "(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden)",
  unavailableStatePatternSource:
    "^(?:disabled|locked|suspend(?:ed)?|closed|hidden|unavailable|inactive|off)$"
} as const;

const unavailableClassPattern = new RegExp(
  CMD_AVAILABILITY_CONFIG.unavailableClassPatternSource,
  "i"
);
const unavailableStylePattern = new RegExp(
  CMD_AVAILABILITY_CONFIG.unavailableStylePatternSource,
  "i"
);
const unavailableStatePattern = new RegExp(
  CMD_AVAILABILITY_CONFIG.unavailableStatePatternSource,
  "i"
);

export function isCmdOutcomeUnavailable(node: Element | null | undefined) {
  if (!node) {
    return true;
  }

  let current: Element | null = node;
  while (current) {
    if (
      current.hasAttribute("disabled") ||
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-disabled") === "true" ||
      current.getAttribute("aria-hidden") === "true" ||
      current.getAttribute("data-active") === "false" ||
      current.getAttribute("data-enabled") === "false" ||
      unavailableClassPattern.test(String(current.className || "")) ||
      unavailableStylePattern.test(current.getAttribute("style") || "") ||
      unavailableStatePattern.test(current.getAttribute("data-status") || "") ||
      unavailableStatePattern.test(current.getAttribute("data-state") || "")
    ) {
      return true;
    }

    if (current.matches(CMD_AVAILABILITY_CONFIG.boundarySelector)) {
      break;
    }
    current = current.parentElement;
  }

  return false;
}
