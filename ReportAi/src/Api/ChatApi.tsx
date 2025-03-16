import { api } from './intercpter'

export const ChatApi = {
  generateReport: async (prompt: string, conversationHistory?: string[]) => {
    try {
      // Extract auth token as a string
      const authHeader = api.defaults.headers.common?.['Authorization'] as string | undefined;
      
      // Use fetch directly for streaming support
      const response = await fetch(`${api.defaults.baseURL}/ai/generate-report-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {})
        },
        body: JSON.stringify({ prompt, conversationHistory })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate report');
      }

      return response;
    } catch (error) {
      console.error('Error in API call:', error);
      throw error;
    }
  },
  
  // Keep the original method for backward compatibility
  generateReportNonStreaming: async (prompt: string, conversationHistory?: string[]) => {
    const response = await api.post('/ai/generate-report', { prompt, conversationHistory });
    return response.data;
  }
}
