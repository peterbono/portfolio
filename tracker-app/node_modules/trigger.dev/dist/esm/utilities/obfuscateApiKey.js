export const obfuscateApiKey = (apiKey) => {
    const [prefix, slug, secretPart] = apiKey.split("_");
    return `${prefix}_${slug}_${"*".repeat(secretPart.length)}`;
};
//# sourceMappingURL=obfuscateApiKey.js.map