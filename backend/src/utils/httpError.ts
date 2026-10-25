export class AppError extends Error {
    status: number;
    code: string;
    details?: unknown;

    constructor(status: number, message: string, code = "ERROR", details?: unknown) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) => new AppError(400, message, code, details);
export const unauthorized = (message = "Authentication required", code = "UNAUTHORIZED") => new AppError(401, message, code);
export const forbidden = (message = "Access denied", code = "FORBIDDEN") => new AppError(403, message, code);
export const notFound = (message = "Not found", code = "NOT_FOUND") => new AppError(404, message, code);
export const conflict = (message: string, code = "CONFLICT") => new AppError(409, message, code);
export const tooMany = (message: string, retryAfterSeconds?: number) =>
    new AppError(429, message, "RATE_LIMITED", { retryAfterSeconds });
