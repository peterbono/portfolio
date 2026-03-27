import { BuildTarget } from "@trigger.dev/core/v3";
import { ResolvedConfig } from "@trigger.dev/core/v3/build";
import * as chokidar from "chokidar";
type EntryPointManager = {
    entryPoints: string[];
    patterns: string[];
    ignorePatterns: string[];
    watcher?: chokidar.FSWatcher;
    stop: () => Promise<void>;
};
export declare function createEntryPointManager(dirs: string[], config: ResolvedConfig, target: BuildTarget, watch: boolean, onEntryPointsChange?: (entryPoints: string[]) => Promise<void>): Promise<EntryPointManager>;
export {};
