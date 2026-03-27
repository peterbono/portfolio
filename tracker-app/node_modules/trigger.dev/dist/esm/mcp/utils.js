import { z } from "zod";
export function respondWithError(error) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: JSON.stringify({ error: enumerateError(error) }),
            },
        ],
    };
}
function enumerateError(error) {
    if (!error) {
        return error;
    }
    if (typeof error !== "object") {
        return error;
    }
    const newError = {};
    const errorProps = ["name", "message"];
    for (const prop of errorProps) {
        if (prop in error) {
            newError[prop] = error[prop];
        }
    }
    return newError;
}
export function toolHandler(shape, handler) {
    return async (input, extra) => {
        const parsedInput = z.object(shape).safeParse(input);
        if (!parsedInput.success) {
            return respondWithError(parsedInput.error);
        }
        function createProgressTracker(total) {
            return new ProgressTracker(total, extra.sendNotification, extra._meta?.progressToken);
        }
        return handler(parsedInput.data, { ...extra, createProgressTracker });
    };
}
class ProgressTracker {
    progress = 0;
    progressToken;
    total;
    message;
    sendNotification;
    constructor(total, sendNotification, progressToken) {
        this.message = "";
        this.progressToken = progressToken;
        this.progress = 0;
        this.total = total;
        this.sendNotification = sendNotification;
    }
    async updateProgress(progress, message) {
        this.progress = progress;
        if (message) {
            this.message = message;
        }
        await this.#sendNotification(progress, this.message);
    }
    async incrementProgress(increment, message) {
        this.progress += increment;
        // make sure the progress is never greater than the total
        this.progress = Math.min(this.progress, this.total);
        if (message) {
            this.message = message;
        }
        await this.#sendNotification(this.progress, this.message);
    }
    async complete(message) {
        this.progress = this.total;
        if (message) {
            this.message = message;
        }
        await this.#sendNotification(this.progress, this.message);
    }
    getProgress() {
        return this.progress;
    }
    async #sendNotification(progress, message) {
        if (!this.progressToken) {
            return;
        }
        await this.sendNotification({
            method: "notifications/progress",
            params: {
                progress,
                total: this.total,
                message: this.message,
                progressToken: this.progressToken,
            },
        });
    }
}
//# sourceMappingURL=utils.js.map