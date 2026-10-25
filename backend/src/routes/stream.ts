import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { addClient } from "../services/redis/events";

const router = Router();

/** Server-Sent Events: live alerts for staff, live balance / notification updates for customers. */
router.get("/", authenticate, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    res.write(`event: ready\ndata: {"ok":true}\n\n`);
    const remove = addClient(req.user!.id, req.user!.role, res);
    req.on("close", remove);
});

export default router;
