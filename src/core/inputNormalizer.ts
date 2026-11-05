/**
 * Utility to normalize and unwrap tool input parameters.
 * Handles various input formats from the MCP SDK or other callers.
 */

/**
 * Safely unwrap input that may be wrapped under { input: ... } or other nested structures
 */
export function normalizeInput<T extends Record<string, unknown>>(input: T): T;
export function normalizeInput<T extends Record<string, unknown>>(input: unknown): T;
export function normalizeInput<T extends Record<string, unknown>>(input: unknown): T {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return {} as T;
  }

  // If input is already the right type, return it
  if (typeof input === "object") {
    // Check if input has an "input" property (MCP SDK wrapping)
    if ("input" in input && input.input !== null && typeof input.input === "object") {
      return input.input as T;
    }
    
    // Return as-is if it looks like the right structure
    return input as T;
  }

  // Fallback for unexpected types
  return {} as T;
}

/**
 * Extract a specific field from potentially wrapped input
 */
export function getInputField<T>(input: unknown, fieldName: string, defaultValue: T): T {
  const normalized = normalizeInput(input);
  return (normalized?.[fieldName] as T) ?? defaultValue;
}

/**
 * Validate that input has required fields
 */
export function validateInputFields(
  input: unknown,
  requiredFields: string[]
): boolean {
  const normalized = normalizeInput(input);
  return requiredFields.every(field => field in normalized && normalized[field] != null);
}
