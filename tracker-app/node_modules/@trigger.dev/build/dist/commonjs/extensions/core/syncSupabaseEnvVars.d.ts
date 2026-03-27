import { BuildExtension } from "@trigger.dev/core/v3/build";
export declare const SUPABASE_ENV_VARS: string[];
export declare function syncSupabaseEnvVars(options?: {
    projectId?: string;
    /**
     * Supabase Management API access token for authentication.
     * It's recommended to use the SUPABASE_ACCESS_TOKEN environment variable instead of hardcoding this value.
     */
    supabaseAccessToken?: string;
    branch?: string;
    envVarPrefix?: string;
}): BuildExtension;
