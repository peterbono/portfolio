import { type BuildLogger, BuildContext, BuildExtension, BuildLayer, RegisteredPlugin, ResolvedConfig } from "@trigger.dev/core/v3/build";
import { BuildManifest, BuildTarget } from "@trigger.dev/core/v3/schemas";
import * as esbuild from "esbuild";
export interface InternalBuildContext extends BuildContext {
    getLayers(): BuildLayer[];
    clearLayers(): void;
    getPlugins(): RegisteredPlugin[];
    appendExtension(extension: BuildExtension): void;
    prependExtension(extension: BuildExtension): void;
    getExtensions(): BuildExtension[];
}
export declare function notifyExtensionOnBuildStart(context: InternalBuildContext): Promise<void>;
export declare function notifyExtensionOnBuildComplete(context: InternalBuildContext, manifest: BuildManifest): Promise<BuildManifest>;
export declare function createBuildContext(target: BuildTarget, config: ResolvedConfig, options?: {
    logger?: BuildLogger;
}): InternalBuildContext;
export declare function resolvePluginsForContext(context: InternalBuildContext): esbuild.Plugin[];
