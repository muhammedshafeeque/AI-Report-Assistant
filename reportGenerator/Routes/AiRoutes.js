import express from "express";
import { generateReport, generateReportNonStreaming } from "../Controls/ReportController.js";

const router = express.Router();

// Streaming endpoint
router.post("/generate-report-stream", generateReport);

// Keep the original endpoint for backward compatibility
router.post("/generate-report", generateReportNonStreaming);

export default router;
