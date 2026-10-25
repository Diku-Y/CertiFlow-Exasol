import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/httpError";

export const notFoundHandler = (_req: Request, res: Response): void => {
    res.status(404).json({ message: "Route not found", code: "NOT_FOUND" });
};

export const errorHandler = (error: any, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) return;
    if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message, code: error.code, details: error.details });
        return;
    }
    if (error?.code === 11000) {
        res.status(409).json({ message: "That record already exists", code: "DUPLICATE" });
        return;
    }
    if (error?.type === "entity.parse.failed" || error instanceof SyntaxError) {
        res.status(400).json({ message: "Malformed JSON body", code: "BAD_REQUEST" });
        return;
    }
    if (error?.type === "entity.too.large") {
        res.status(413).json({ message: "Request body too large", code: "TOO_LARGE" });
        return;
    }
    console.error(`[${req.method} ${req.originalUrl}]`, error);
    res.status(500).json({ message: "Something went wrong on our side. Please try again.", code: "INTERNAL" });
};
