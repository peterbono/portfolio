export function checkApiKeyIsDevServer(apiKey) {
    const type = getApiKeyType(apiKey);
    if (!type) {
        return { success: false, type: undefined };
    }
    if (type.environment === "dev" && type.type === "server") {
        return {
            success: true,
        };
    }
    return {
        success: false,
        type,
    };
}
export function getApiKeyType(apiKey) {
    if (apiKey.startsWith("tr_dev_")) {
        return {
            environment: "dev",
            type: "server",
        };
    }
    if (apiKey.startsWith("pk_dev_")) {
        return {
            environment: "dev",
            type: "public",
        };
    }
    // If they enter a prod key (tr_prod_), let them know
    if (apiKey.startsWith("tr_prod_")) {
        return {
            environment: "prod",
            type: "server",
        };
    }
    if (apiKey.startsWith("pk_prod_")) {
        return {
            environment: "prod",
            type: "public",
        };
    }
    return;
}
//# sourceMappingURL=getApiKeyType.js.map