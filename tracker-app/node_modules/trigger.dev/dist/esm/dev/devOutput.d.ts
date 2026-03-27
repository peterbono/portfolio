import { ResolvedConfig } from "@trigger.dev/core/v3/build";
import { DevCommandOptions } from "../commands/dev.js";
export type DevOutputOptions = {
    name: string | undefined;
    dashboardUrl: string;
    config: ResolvedConfig;
    args: DevCommandOptions;
};
export declare function startDevOutput(options: DevOutputOptions): () => void;
