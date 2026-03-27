export type RuntimeMinimumVersion = {
    major: number;
    minor: number;
};
/**
 * This function is used by the dev CLI to make sure that the runtime is compatible
 */
export declare function runtimeChecks(): void;
