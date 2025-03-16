import { ReportService } from '../Services/ReportService.js';

const reportService = new ReportService();

export const generateReport = async (req, res) => {
    try {
        const { prompt, conversationHistory } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ 
                error: 'Prompt is required' 
            });
        }

        // Set headers for streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Create a callback function to send updates to the client
        const sendUpdate = (update) => {
            res.write(`data: ${JSON.stringify(update)}\n\n`);
        };

        // Pass conversation history and the update callback to the report service
        await reportService.generateReportStream(prompt, conversationHistory || [], sendUpdate);
        
        // End the response when complete
        res.end();
    } catch (error) {
        console.error('Error in report controller:', error);
        // If headers haven't been sent yet, send an error response
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Failed to generate report',
                message: error.message 
            });
        } else {
            // If we're already streaming, send the error as an event
            res.write(`data: ${JSON.stringify({ 
                error: 'Failed to generate report',
                message: error.message 
            })}\n\n`);
            res.end();
        }
    }
}

// Keep the original non-streaming method for backward compatibility
export const generateReportNonStreaming = async (req, res) => {
    try {
        const { prompt, conversationHistory } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ 
                error: 'Prompt is required' 
            });
        }

        // Pass conversation history to the report service
        const report = await reportService.generateReport(prompt, conversationHistory || []);
        res.json(report);
    } catch (error) {
        console.error('Error in report controller:', error);
        res.status(500).json({ 
            error: 'Failed to generate report',
            message: error.message 
        });
    }
}

