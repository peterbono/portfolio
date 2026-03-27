export type ApiKeyType = {
    environment: "dev" | "prod";
    type: "server" | "public";
};
type Result = {
    success: true;
} | {
    success: false;
    type: ApiKeyType | undefined;
};
export declare function checkApiKeyIsDevServer(apiKey: string): Result;
export declare function getApiKeyType(apiKey: string): ApiKeyType | undefined;
export {};
