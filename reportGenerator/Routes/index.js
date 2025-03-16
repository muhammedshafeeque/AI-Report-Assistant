import express from "express";
import aiRoutes from "./AiRoutes.js";
const router = express.Router();
router.use("/ai", aiRoutes);
export default router;
