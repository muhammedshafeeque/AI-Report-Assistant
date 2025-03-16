import React, { useState, useEffect, useRef } from 'react'
import { ChatApi } from '../Api/ChatApi'
import './ChatBot.css'
import ReactMarkdown from 'react-markdown'
import * as XLSX from 'xlsx'

// Define TypeScript interfaces for better type safety
interface Message {
  text: string;
  sender: string;
  data?: any;
}

interface Insight {
  type: string;
  content: string;
}

export const ChatBot = () => {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [conversationHistory, setConversationHistory] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [expandedData, setExpandedData] = useState(false)
  const [dataRowCount, setDataRowCount] = useState(10)
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll to bottom whenever messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputMessage.trim()) return;
    
    // Add user message to the chat
    const userMessage: Message = { text: inputMessage, sender: 'user' };
    setMessages(prevMessages => [...prevMessages, userMessage]);
    
    // Update conversation history
    const updatedHistory = conversationHistory;
    setConversationHistory(updatedHistory);
    
    // Clear input field
    setInputMessage('');
    
    // Reset expanded state for new messages
    setExpandedData(false);
    setDataRowCount(10);
    setVisibleColumns([]);
    
    // Show loading state
    setIsLoading(true);
    
    // Add an initial AI message that will be updated
    const initialAiMessage: Message = { 
      text: "I'm processing your request...", 
      sender: 'ai',
      data: { processing: true, status: 'processing' }
    };
    
    setMessages(prevMessages => [...prevMessages, initialAiMessage]);
    
    try {
      // Call API with streaming
      const response = await ChatApi.generateReport(inputMessage, updatedHistory);
      
      // Create a reader from the response body
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to create stream reader');
      }
      
      // Read the stream
      let partialData: any = {};
      let lastMessageIndex = messages.length;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        // Convert the chunk to text
        const chunk = new TextDecoder().decode(value);
        
        // Process each event in the chunk
        const events = chunk.split('\n\n').filter(Boolean);
        
        for (const event of events) {
          if (event.startsWith('data: ')) {
            try {
              // Extract the JSON data part
              const jsonString = event.slice(6);
              
              // Handle potential incomplete JSON
              let jsonData;
              try {
                jsonData = JSON.parse(jsonString);
              } catch (jsonError) {
                // If parsing fails, it might be an incomplete chunk
                console.warn('Received incomplete JSON chunk, waiting for more data');
                continue; // Skip this chunk and wait for more data
              }
              
              // Merge with existing data
              partialData = { ...partialData, ...jsonData };
              
              // Update the AI message with the latest data
              setMessages(prevMessages => {
                const updatedMessages = [...prevMessages];
                
                // Find the last AI message
                const lastAiMessageIndex = updatedMessages.length - 1;
                
                if (lastAiMessageIndex >= 0 && updatedMessages[lastAiMessageIndex].sender === 'ai') {
                  // Update the message text based on status
                  let messageText = updatedMessages[lastAiMessageIndex].text;
                  
                  if (jsonData.status === 'processing' && jsonData.message) {
                    messageText = jsonData.message;
                  } else if (jsonData.status === 'complete' && jsonData.report) {
                    messageText = "I've analyzed your data and prepared a report.";
                  } else if (jsonData.status === 'error') {
                    messageText = `Error: ${jsonData.message || 'Something went wrong'}`;
                  }
                  
                  // Update the message
                  updatedMessages[lastAiMessageIndex] = {
                    ...updatedMessages[lastAiMessageIndex],
                    text: messageText,
                    data: { ...updatedMessages[lastAiMessageIndex].data, ...jsonData }
                  };
                }
                
                return updatedMessages;
              });
              
              // If we have received insights, set visible columns
              if (jsonData.rawData && jsonData.rawData.length > 0 && !visibleColumns.length) {
                // Get all column names
                const allColumns = Object.keys(jsonData.rawData[0] || {});
                
                // Select important columns or first 5 if we can't determine importance
                const importantColumns = selectImportantColumns(allColumns, jsonData.rawData);
                setVisibleColumns(importantColumns);
              }

              // Handle chunked raw data if present
              if (jsonData.rawDataChunk && Array.isArray(jsonData.rawDataChunk)) {
                setMessages(prevMessages => {
                  const updatedMessages = [...prevMessages];
                  const lastAiMessageIndex = updatedMessages.length - 1;
                  
                  if (lastAiMessageIndex >= 0 && updatedMessages[lastAiMessageIndex].sender === 'ai') {
                    // Initialize rawData array if it doesn't exist
                    if (!updatedMessages[lastAiMessageIndex].data.rawData) {
                      updatedMessages[lastAiMessageIndex].data.rawData = [];
                    }
                    
                    // Append the chunk to the existing data
                    updatedMessages[lastAiMessageIndex].data.rawData = [
                      ...updatedMessages[lastAiMessageIndex].data.rawData,
                      ...jsonData.rawDataChunk
                    ];
                    
                    // Update the message text to show progress
                    if (jsonData.totalChunks > 1) {
                      updatedMessages[lastAiMessageIndex].text = 
                        `Receiving data (chunk ${jsonData.chunkIndex + 1}/${jsonData.totalChunks})...`;
                    }
                  }
                  
                  return updatedMessages;
                });
              }

              // Handle raw data completion
              if (jsonData.rawDataComplete) {
                setMessages(prevMessages => {
                  const updatedMessages = [...prevMessages];
                  const lastAiMessageIndex = updatedMessages.length - 1;
                  
                  if (lastAiMessageIndex >= 0 && updatedMessages[lastAiMessageIndex].sender === 'ai') {
                    updatedMessages[lastAiMessageIndex].text = 
                      "I've analyzed your data and prepared a report.";
                  }
                  
                  return updatedMessages;
                });
              }
            } catch (parseError) {
              console.error('Error parsing SSE data:', parseError);
            }
          }
        }
      }
      
      // Final update when stream is complete
      if (partialData.status === 'complete') {
        setMessages(prevMessages => {
          const updatedMessages = [...prevMessages];
          const lastAiMessageIndex = updatedMessages.length - 1;
          
          if (lastAiMessageIndex >= 0 && updatedMessages[lastAiMessageIndex].sender === 'ai') {
            updatedMessages[lastAiMessageIndex] = {
              text: "I've analyzed your data and prepared a report.",
              sender: 'ai',
              data: partialData
            };
          }
          
          return updatedMessages;
        });
      }
    } catch (error) {
      console.error('Error generating response:', error);
      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages];
        const lastAiMessageIndex = updatedMessages.length - 1;
        
        if (lastAiMessageIndex >= 0 && updatedMessages[lastAiMessageIndex].sender === 'ai') {
          updatedMessages[lastAiMessageIndex] = {
            text: 'Sorry, I encountered an error. Please try again.',
            sender: 'ai'
          };
        } else {
          updatedMessages.push({
            text: 'Sorry, I encountered an error. Please try again.',
            sender: 'ai'
          });
        }
        
        return updatedMessages;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to select important columns
  const selectImportantColumns = (allColumns: string[], data: any[]): string[] => {
    // If there are 5 or fewer columns, show all of them
    if (allColumns.length <= 5) return allColumns;
    
    // Try to find important columns based on naming patterns
    const importantPatterns = [
      /id$/i, /name$/i, /title/i, /date/i, /time/i, 
      /status/i, /type/i, /category/i, /amount/i, /price/i
    ];
    
    const importantColumns = allColumns.filter(col => 
      importantPatterns.some(pattern => pattern.test(col))
    );
    
    // If we found at least 3 important columns, use those
    if (importantColumns.length >= 3) {
      return importantColumns.slice(0, 5); // Limit to 5 columns
    }
    
    // Otherwise, just use the first 5 columns
    return allColumns.slice(0, 5);
  }

  const toggleDataExpansion = () => {
    setExpandedData(!expandedData);
  }

  const loadMoreData = () => {
    setDataRowCount(prev => prev + 20);
  }

  const toggleColumnVisibility = (column: string) => {
    setVisibleColumns(prev => {
      if (prev.includes(column)) {
        return prev.filter(col => col !== column);
      } else {
        return [...prev, column];
      }
    });
  }

  // Modified exportToExcel function to only export selected columns
  const exportToExcel = (data: any[], columns: string[], filename: string = 'report_data') => {
    // Create a new workbook
    const wb = XLSX.utils.book_new();
    
    // If no columns are selected, use all columns
    if (columns.length === 0) {
      // Export all data
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
    } else {
      // Filter data to only include selected columns
      const filteredData = data.map(row => {
        const newRow: Record<string, any> = {};
        columns.forEach(col => {
          newRow[col] = row[col];
        });
        return newRow;
      });
      
      // Convert filtered data to worksheet
      const ws = XLSX.utils.json_to_sheet(filteredData);
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
    }
    
    // Generate Excel file and trigger download
    XLSX.writeFile(wb, `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  const formatDateValue = (value: any): string => {
    if (value === null || value === undefined) return '';
    
    // If it's already a string, check if it looks like a date
    if (typeof value === 'string') {
      // Try to parse as date
      const datePatterns = [
        /^\d{4}-\d{2}-\d{2}/, // ISO date: 2023-01-15
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO datetime: 2023-01-15T14:30
        /^\d{2}\/\d{2}\/\d{4}/, // MM/DD/YYYY
        /^\d{4}\/\d{2}\/\d{2}/, // YYYY/MM/DD
        /^\d{2}-\d{2}-\d{4}/ // MM-DD-YYYY
      ];
      
      if (datePatterns.some(pattern => pattern.test(value))) {
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            // Format date as "Month Day, Year" or with time if it has non-zero time
            if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
              return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              });
            } else {
              return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });
            }
          }
        } catch (e) {
          // If date parsing fails, return the original value
          return value;
        }
      }
    }
    
    // For non-date values, just convert to string
    return String(value);
  }

  const renderMessageContent = (message: Message) => {
    if (message.sender === 'ai' && message.data) {
      return (
        <div className="ai-data-content">
          <p className="message-text">{message.text}</p>
          
          {/* Display report if available */}
          {message.data.report && (
            <div className="report-section">
              <h3>Report</h3>
              <div className="markdown-report">
                <ReactMarkdown>{message.data.report}</ReactMarkdown>
              </div>
            </div>
          )}
          
          {/* Display calculations if available */}
          {message.data.calculations && Object.keys(message.data.calculations).some(key => 
            message.data.calculations[key] && Object.keys(message.data.calculations[key]).length > 0
          ) && (
            <div className="calculations-section">
              <h3>Calculations</h3>
              <div className="calculations-container">
                {message.data.calculations.aggregates && Object.keys(message.data.calculations.aggregates).length > 0 && (
                  <div className="calculation-group">
                    <h4>Aggregates</h4>
                    <ul>
                      {Object.entries(message.data.calculations.aggregates).map(([key, value], idx) => (
                        <li key={idx}>
                          <strong>{key}:</strong> {String(value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {message.data.calculations.timeSeries && Object.keys(message.data.calculations.timeSeries).length > 0 && (
                  <div className="calculation-group">
                    <h4>Time Series</h4>
                    <ul>
                      {Object.entries(message.data.calculations.timeSeries).map(([key, value], idx) => (
                        <li key={idx}>
                          <strong>{key}:</strong> {String(value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {message.data.calculations.correlations && Object.keys(message.data.calculations.correlations).length > 0 && (
                  <div className="calculation-group">
                    <h4>Correlations</h4>
                    <ul>
                      {Object.entries(message.data.calculations.correlations).map(([key, value], idx) => (
                        <li key={idx}>
                          <strong>{key}:</strong> {String(value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Display insights if available */}
          {message.data.enhancedResults && message.data.enhancedResults.insights && message.data.enhancedResults.insights.length > 0 && (
            <div className="insights-section">
              <h3>Insights</h3>
              <ul>
                {message.data.enhancedResults.insights.map((insight: Insight, idx: number) => (
                  <li key={idx}>
                    <strong>{insight.type}:</strong> {insight.content}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Display raw data if available */}
          {message.data.rawData && message.data.rawData.length > 0 && (
            <div className="data-section">
              <div className="data-header">
                <h3>Data</h3>
                <div className="data-actions">
                  <button 
                    className="export-excel-btn"
                    onClick={() => exportToExcel(
                      message.data.rawData, 
                      visibleColumns,
                      'report_data'
                    )}
                  >
                    Export to Excel
                  </button>
                  <button 
                    className="toggle-data-btn"
                    onClick={toggleDataExpansion}
                  >
                    {expandedData ? 'Collapse Data' : 'Expand Data'}
                  </button>
                </div>
              </div>
              
              {expandedData && (
                <div className="data-table-wrapper">
                  <div className="column-selector">
                    <span className="column-selector-label">Select columns:</span>
                    <div className="column-selector-buttons">
                      {Object.keys(message.data.rawData[0] || {}).map((column, idx) => (
                        <button 
                          key={idx} 
                          className={`column-toggle-btn ${visibleColumns.includes(column) ? 'active' : ''}`}
                          onClick={() => toggleColumnVisibility(column)}
                        >
                          {column}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="data-table-container expanded">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {visibleColumns.length > 0 ? (
                            visibleColumns.map((column, idx) => (
                              <th key={idx}>{column}</th>
                            ))
                          ) : (
                            Object.keys(message.data.rawData[0] || {}).map((key, idx) => (
                              <th key={idx}>{key}</th>
                            ))
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {message.data.rawData.slice(0, dataRowCount).map((row: any, rowIdx: number) => (
                          <tr key={rowIdx}>
                            {visibleColumns.length > 0 ? (
                              visibleColumns.map((column, cellIdx) => (
                                <td key={cellIdx}>
                                  {formatDateValue(row[column])}
                                </td>
                              ))
                            ) : (
                              Object.values(row).map((value: any, cellIdx: number) => (
                                <td key={cellIdx}>
                                  {formatDateValue(value)}
                                </td>
                              ))
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    {dataRowCount < message.data.rawData.length && (
                      <div className="load-more-container">
                        <button className="load-more-btn" onClick={loadMoreData}>
                          Load More Rows
                        </button>
                        <span className="data-count">
                          Showing {dataRowCount} of {message.data.rawData.length} rows
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {!expandedData && (
                <div className="data-preview">
                  <p>This dataset contains {message.data.rawData.length} rows of data.</p>
                  <p>Click "Expand Data" to view the full dataset or "Export to Excel" to download all rows.</p>
                </div>
              )}
            </div>
          )}
          
          {/* Display additional queries if available */}
          {message.data.additionalQueries && message.data.additionalQueries.length > 0 && (
            <div className="additional-queries-section">
              <h3>Suggested Follow-up Questions</h3>
              <ul className="query-list">
                {message.data.additionalQueries.map((query: any, idx: number) => (
                  <li 
                    key={idx} 
                    className="query-item" 
                    onClick={() => setInputMessage(
                      typeof query === 'string' 
                        ? query 
                        : query.description || JSON.stringify(query)
                    )}
                  >
                    {typeof query === 'string' 
                      ? query 
                      : query.description || JSON.stringify(query)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Display AI insights if available */}
          {message.data.aiInsights && message.data.aiInsights.length > 0 && (
            <div className="ai-insights-section">
              <h3>Key Insights</h3>
              <ul className="insights-list">
                {message.data.aiInsights.map((insight: any, idx: number) => (
                  <li key={idx} className="insight-item">
                    {insight.type === 'numeric_summary' && (
                      <div className="numeric-insight">
                        <strong>{insight.field}:</strong> Avg: {insight.statistics.average.toFixed(2)}, 
                        Min: {insight.statistics.min}, Max: {insight.statistics.max}
                      </div>
                    )}
                    
                    {insight.type === 'categorical_distribution' && (
                      <div className="categorical-insight">
                        <strong>{insight.field} Distribution:</strong>
                        <ul className="distribution-list">
                          {insight.topCategories.map((category: any, catIdx: number) => (
                            <li key={catIdx}>
                              {category.value}: {category.percentage}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {insight.type === 'correlations' && (
                      <div className="correlation-insight">
                        <strong>Correlations:</strong>
                        <ul className="correlation-list">
                          {insight.correlations.slice(0, 3).map((corr: any, corrIdx: number) => (
                            <li key={corrIdx}>
                              {corr.fields[0]} and {corr.fields[1]}: {corr.strength} {corr.direction} correlation ({corr.correlation})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {insight.type === 'outliers' && (
                      <div className="outlier-insight">
                        <strong>{insight.field} Outliers:</strong> {insight.count} values ({insight.percentage})
                      </div>
                    )}
                    
                    {insight.type === 'dominant_category' && (
                      <div className="dominant-category-insight">
                        <strong>{insight.field}:</strong> {insight.category} is dominant ({insight.percentage})
                      </div>
                    )}
                    
                    {insight.type === 'time_range' && (
                      <div className="time-range-insight">
                        <strong>{insight.field}:</strong> From {insight.earliest} to {insight.latest} ({insight.timespan})
                      </div>
                    )}
                    
                    {insight.type === 'data_completeness' && (
                      <div className="completeness-insight">
                        <strong>Data Completeness Issues:</strong>
                        <ul className="completeness-list">
                          {Object.entries(insight.fields).map(([field, info]: [string, any], compIdx: number) => (
                            <li key={compIdx}>
                              {field}: {info.completeness} complete ({info.missingCount} missing)
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }
    
    return <p>{message.text}</p>;
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1>AI Report Assistant</h1>
      </div>
      
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="welcome-message">
            <h2>Welcome to AI Report Assistant</h2>
            <p>Ask me to analyze your data or generate reports.</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div 
              key={index} 
              className={`message ${message.sender === 'user' ? 'user-message' : 'ai-message'} ${message.data ? 'data-message' : ''}`}
            >
              <div className={`message-bubble ${message.data ? 'data-bubble' : ''}`}>
                {renderMessageContent(message)}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="message ai-message">
            <div className="message-bubble loading">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form className="input-container" onSubmit={handleSendMessage}>
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Ask for a report or analysis..."
          className="message-input"
        />
        <button 
          type="submit" 
          className="send-button"
          disabled={isLoading || !inputMessage.trim()}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    </div>
  )
}

export default ChatBot