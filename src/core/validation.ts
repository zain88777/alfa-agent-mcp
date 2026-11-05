/**
 * Input validation utilities for tool handlers
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate required string parameter
 */
export function validateString(
  value: unknown,
  paramName: string,
  minLength = 0
): void {
  if (typeof value !== "string") {
    throw new ValidationError(
      `Parameter '${paramName}' must be a string, received ${typeof value}`
    );
  }
  if (value.length < minLength) {
    throw new ValidationError(
      `Parameter '${paramName}' must be at least ${minLength} characters`
    );
  }
}

/**
 * Validate required object parameter
 */
export function validateObject(value: unknown, paramName: string): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(
      `Parameter '${paramName}' must be an object, received ${typeof value}`
    );
  }
}

/**
 * Validate optional string parameter
 */
export function validateOptionalString(
  value: unknown,
  paramName: string,
  minLength = 0
): void {
  if (value !== undefined && value !== null) {
    validateString(value, paramName, minLength);
  }
}

/**
 * Validate required number parameter
 */
export function validateNumber(
  value: unknown,
  paramName: string,
  min?: number,
  max?: number
): void {
  if (typeof value !== "number") {
    throw new ValidationError(
      `Parameter '${paramName}' must be a number, received ${typeof value}`
    );
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(
      `Parameter '${paramName}' must be at least ${min}`
    );
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(
      `Parameter '${paramName}' must be at most ${max}`
    );
  }
}

/**
 * Validate required boolean parameter
 */
export function validateBoolean(value: unknown, paramName: string): void {
  if (typeof value !== "boolean") {
    throw new ValidationError(
      `Parameter '${paramName}' must be a boolean, received ${typeof value}`
    );
  }
}

/**
 * Validate array parameter
 */
export function validateArray(
  value: unknown,
  paramName: string,
  elementType?: string
): void {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `Parameter '${paramName}' must be an array, received ${typeof value}`
    );
  }
  if (elementType) {
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== elementType) {
        throw new ValidationError(
          `Parameter '${paramName}[${i}]' must be ${elementType}, received ${typeof value[i]}`
        );
      }
    }
  }
}

/**
 * Validate that at least one of the provided fields exist
 */
export function validateAnyOf(
  input: Record<string, unknown>,
  fieldNames: string[]
): void {
  if (!fieldNames.some(name => input[name] !== undefined)) {
    throw new ValidationError(
      `At least one of these parameters is required: ${fieldNames.join(", ")}`
    );
  }
}

/**
 * Validate mutually exclusive parameters
 */
export function validateNotBoth(
  input: Record<string, unknown>,
  field1: string,
  field2: string
): void {
  if (input[field1] !== undefined && input[field2] !== undefined) {
    throw new ValidationError(
      `Parameters '${field1}' and '${field2}' are mutually exclusive`
    );
  }
}
