export type WarningsCheckReturn = {
    ok: true;
    warnings: string[];
} | {
    ok: false;
    summary: string;
    errors: string[];
    warnings: string[];
};
export type LogParserOptions = Array<{
    regex: RegExp;
    message: string;
    shouldFail?: boolean;
}>;
export declare function saveLogs(shortCode: string, logs: string): Promise<string>;
export declare function printErrors(errors?: string[]): void;
export declare function printWarnings(warnings?: string[]): void;
export declare function checkLogsForErrors(logs: string): void;
export declare function checkLogsForWarnings(logs: string): WarningsCheckReturn;
