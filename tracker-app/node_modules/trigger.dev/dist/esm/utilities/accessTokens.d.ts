export declare function validateAccessToken(token: string): {
    success: true;
    type: "personal" | "organization";
} | {
    success: false;
};
export declare class NotPersonalAccessTokenError extends Error {
    constructor(message: string);
}
export declare class NotAccessTokenError extends Error {
    constructor(message: string);
}
