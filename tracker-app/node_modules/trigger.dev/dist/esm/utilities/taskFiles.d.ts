import { ResolvedConfig } from "@trigger.dev/core/v3";
import { TaskFile } from "../types.js";
export declare function createTaskFileImports(taskFiles: TaskFile[]): string;
export declare function gatherTaskFiles(config: ResolvedConfig): Promise<Array<TaskFile>>;
export declare function resolveTriggerDirectories(projectDir: string, dirs: string[]): string[];
export declare function findTriggerDirectories(dirPath: string): Promise<string[]>;
