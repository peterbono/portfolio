import { pathToFileURL } from "url";
export function normalizeImportPath(importPath) {
    return pathToFileURL(importPath).href;
}
//# sourceMappingURL=normalizeImportPath.js.map