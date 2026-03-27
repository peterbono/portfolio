import type { JSONSchema } from "@trigger.dev/core/v3";
export type Schema = unknown;
export type { JSONSchema };
export interface ConversionOptions {
    /**
     * Enables support for references in the schema.
     * This is required for recursive schemas, e.g. with `z.lazy`.
     * However, not all language models and providers support such references.
     * Defaults to `false`.
     */
    useReferences?: boolean;
}
export interface ConversionResult {
    /**
     * The JSON Schema representation (JSON Schema Draft 7)
     */
    jsonSchema: JSONSchema;
}
/**
 * Convert a schema from various validation libraries to JSON Schema
 *
 * This function attempts to convert schemas without requiring external dependencies to be bundled.
 * It will only succeed if:
 * 1. The schema has built-in JSON Schema conversion (ArkType, Zod 4, TypeBox)
 * 2. The required conversion library is available at runtime (zod-to-json-schema, @sodaru/yup-to-json-schema, etc.)
 *
 * @param schema The schema to convert
 * @param options Optional conversion options
 * @returns The conversion result or undefined if conversion is not possible
 */
export declare function schemaToJsonSchema(schema: Schema, options?: ConversionOptions): ConversionResult | undefined;
/**
 * Check if a schema can be converted to JSON Schema
 */
export declare function canConvertSchema(schema: Schema): boolean;
export declare function isZodSchema(schema: any): boolean;
