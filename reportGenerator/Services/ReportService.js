import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import mistral from "../Config/MistralAi.js";
import { SchemaService } from "./SchemaService.js";
import { SqlGenerationService } from "./SqlGenerationService.js";
import { DataEnrichmentService } from "./DataEnrichmentService.js";
import { AnalyticsService } from "./AnalyticsService.js";
import { MachineLearningService } from "./MachineLearningService.js";
import { MistralService } from "./MistralService.js";
import pool from "../Config/Db.js";

export class ReportService {
  constructor() {
    // Initialize services
    this.mistralService = new MistralService(mistral);
    this.schemaService = new SchemaService();
    this.sqlGenerationService = new SqlGenerationService(this.mistralService);
    this.dataEnrichmentService = new DataEnrichmentService();
    this.analyticsService = new AnalyticsService();
    this.mlService = new MachineLearningService();
    
    // Cache for schema information
    this.#schemaCache = null;
    this.#schemaCacheExpiry = null;
    this.#cacheDuration = 5 * 60 * 1000; // 5 minutes
  }

  // Cache for schema information
  #schemaCache = null;
  #schemaCacheExpiry = null;
  #cacheDuration = 5 * 60 * 1000; // 5 minutes

  // Get schema with caching
  async getSchemaWithCache() {
    if (
      this.#schemaCache &&
      this.#schemaCacheExpiry &&
      Date.now() < this.#schemaCacheExpiry
    ) {
      return this.#schemaCache;
    }

    const schemas = await this.schemaService.getAllTableSchemas();
    const relationships = await this.schemaService.getTableRelationships();

    this.#schemaCache = { schemas, relationships };
    this.#schemaCacheExpiry = Date.now() + this.#cacheDuration;

    return this.#schemaCache;
  }

  // Simple token estimator - approximates token count based on text length
  estimateTokenCount(text) {
    if (!text) return 0;
    // A rough approximation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  // Modify the truncateData method to respect "all data" requests
  truncateData(data, maxTokens = 5000, forceIncludeAll = false) {
    if (!data || data.length === 0) return [];

    // If we're forcing inclusion of all data, return the full dataset
    if (forceIncludeAll) {
      console.log(`Including all ${data.length} rows as requested by user`);
      return data;
    }

    const fullDataStr = JSON.stringify(data);
    const estimatedTokens = this.estimateTokenCount(fullDataStr);

    // If data is already small enough, return it as is
    if (estimatedTokens <= maxTokens) {
      return data;
    }

    console.log(
      `Data too large (est. ${estimatedTokens} tokens). Truncating...`
    );

    // Calculate how many rows we can include
    const singleRowTokens = this.estimateTokenCount(JSON.stringify(data[0]));
    const maxRows = Math.floor(maxTokens / singleRowTokens);

    // Ensure we have at least one row
    const rowsToKeep = Math.max(1, maxRows);

    // If we have more rows than we can keep, sample them
    if (data.length > rowsToKeep) {
      // Take first, last, and some samples from the middle
      const truncatedData = [];
      
      // Always include the first row
      truncatedData.push(data[0]);
      
      // If we can keep more than 2 rows, include some from the middle and the end
      if (rowsToKeep > 2) {
        // Calculate how many middle rows to include
        const middleRowsCount = rowsToKeep - 2;
        const step = Math.max(1, Math.floor((data.length - 2) / middleRowsCount));
        
        // Add middle rows
        for (let i = 1; i < data.length - 1 && truncatedData.length < rowsToKeep - 1; i += step) {
          truncatedData.push(data[i]);
        }
        
        // Add the last row
        truncatedData.push(data[data.length - 1]);
      } else if (rowsToKeep > 1) {
        // If we can only keep 2 rows, include the last one
        truncatedData.push(data[data.length - 1]);
      }
      
      return truncatedData;
    }
    
    return data;
  }

  // Add this method to the ReportService class
  async analyzeUserPrompt(userPrompt, conversationHistory = []) {
    try {
      console.log("Performing deep prompt analysis...");
      
      // Get schema information with caching
      const { schemas, relationships } = await this.getSchemaWithCache();
      
      // Create a comprehensive prompt analysis request
      const analysisPrompt = `
        You are an expert data analyst tasked with understanding a user's request in depth.
        
        USER REQUEST: "${userPrompt}"
        
        ${conversationHistory.length > 0 ? `CONVERSATION CONTEXT: 
        ${this.mistralService.formatConversationHistory(conversationHistory)}` : ''}
        
        AVAILABLE DATABASE TABLES: ${Object.keys(schemas).join(", ")}
        
        Perform a detailed analysis of this request by answering the following:
        
        1. CORE QUESTION: What is the fundamental question or need the user is expressing?
        
        2. INTENT CLASSIFICATION: 
           - Is this descriptive (what happened), diagnostic (why it happened), predictive (what will happen), or prescriptive (what should be done)?
           - What specific metrics or KPIs is the user interested in?
        
        3. ENTITIES AND RELATIONSHIPS:
           - What specific entities (e.g., products, customers, transactions) is the user asking about?
           - What relationships between entities need to be explored?
           - What time periods or date ranges are relevant?
        
        4. DATA REQUIREMENTS:
           - Which database tables are most likely to contain the required information?
           - What specific fields would be most relevant?
           - What aggregations or calculations will be needed?
           - Are there any filters or conditions that should be applied?
        
        5. COMPLEXITY ASSESSMENT:
           - How complex is this request (simple, moderate, complex)?
           - Does it require multiple queries or just one?
           - Does it need advanced statistical analysis?
        
        Return your analysis as a structured JSON object with these sections.
        IMPORTANT: Format your response as valid JSON only, with no additional text.
      `;
      
      // Get the analysis from the AI
      const analysisResponse = await this.mistralService.retryWithBackoff(async () => {
        return this.mistralService.generateMistralResponse(analysisPrompt);
      });
      
      // Parse the JSON response
      let promptAnalysis;
      try {
        const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          promptAnalysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not extract JSON from analysis response");
        }
      } catch (parseError) {
        console.warn("Failed to parse prompt analysis as JSON:", parseError);
        // Create a basic fallback analysis
        promptAnalysis = {
          coreQuestion: userPrompt,
          intentClassification: {
            type: "descriptive",
            metrics: []
          },
          entitiesAndRelationships: {
            entities: [],
            relationships: [],
            timePeriods: []
          },
          dataRequirements: {
            relevantTables: [],
            relevantFields: [],
            aggregations: [],
            filters: []
          },
          complexityAssessment: {
            level: "moderate",
            requiresMultipleQueries: false,
            requiresAdvancedAnalysis: false
          }
        };
      }
      
      console.log("Prompt analysis completed:", JSON.stringify(promptAnalysis, null, 2));
      return promptAnalysis;
    } catch (error) {
      console.error("Error analyzing user prompt:", error);
      throw error;
    }
  }

  // Modify the generateReport method to use the prompt analysis
  async generateReport(userPrompt, conversationHistory = []) {
    try {
      // Initialize variables that might be referenced later
      let enhancedResults = {
        insights: [],
        recommendations: [],
        additionalAnalyses: [],
      };

      // Perform deep prompt analysis first
      let promptAnalysis;
      try {
        promptAnalysis = await this.analyzeUserPrompt(userPrompt, conversationHistory);
      } catch (analysisError) {
        console.warn("Error in prompt analysis:", analysisError);
        promptAnalysis = {
          coreQuestion: userPrompt,
          intentClassification: { type: "descriptive", metrics: [] },
          entitiesAndRelationships: { entities: [], relationships: [], timePeriods: [] },
          dataRequirements: { relevantTables: [], relevantFields: [], aggregations: [], filters: [] },
          complexityAssessment: { level: "moderate", requiresMultipleQueries: false, requiresAdvancedAnalysis: false }
        };
      }
      
      // Get schema information with caching
      const { schemas, relationships } = await this.getSchemaWithCache();

      // Use the prompt analysis to identify relevant tables with retry
      let relevantTables;
      try {
        relevantTables = await this.mistralService.retryWithBackoff(async () => {
          // First try to use tables from the prompt analysis
          if (promptAnalysis.dataRequirements && 
              promptAnalysis.dataRequirements.relevantTables && 
              promptAnalysis.dataRequirements.relevantTables.length > 0) {
            
            // Filter to ensure we only include tables that actually exist in the schema
            const suggestedTables = promptAnalysis.dataRequirements.relevantTables
              .map(table => typeof table === 'string' ? table.toLowerCase() : '')
              .filter(table => schemas[table]);
              
            if (suggestedTables.length > 0) {
              console.log("Using tables from prompt analysis:", suggestedTables);
              return suggestedTables;
            }
          }
          
          // Fall back to the original method if prompt analysis didn't yield usable tables
          const tables = await this.sqlGenerationService.identifyRelevantTables(userPrompt, schemas);
          if (tables.length === 0) {
            // If no tables found, use a default table if available
            const defaultTable = Object.keys(schemas)[0];
            if (defaultTable) {
              console.log("No relevant tables found, using default table:", defaultTable);
              return [defaultTable];
            }
            throw new Error("No relevant tables identified for this query");
          }
          return tables;
        });
      } catch (tableError) {
        console.error("Error identifying relevant tables:", tableError);
        // Use first available table as fallback
        relevantTables = Object.keys(schemas).slice(0, 1);
        if (relevantTables.length === 0) {
          throw new Error("No tables available in the database");
        }
      }

      // Create minimal schema with only relevant tables
      const minimalSchema = this.sqlGenerationService.createMinimalSchema(
        schemas,
        relationships,
        relevantTables
      );

      // Try to use learned knowledge to generate SQL, now enhanced with prompt analysis
      const knowledgeBasedSql = await this.sqlGenerationService.enhanceSqlGenerationWithKnowledge(
        userPrompt,
        minimalSchema
      );

      let cleanSQL;
      let sqlSource = "generated";

      if (knowledgeBasedSql) {
        // Use knowledge-based SQL if available
        cleanSQL = knowledgeBasedSql;
        sqlSource = "knowledge-based";
        console.log("Using knowledge-based SQL:", cleanSQL);
      } else {
        // Generate SQL query with retry, now enhanced with prompt analysis
        const sqlResponse = await this.mistralService.retryWithBackoff(async () => {
          // Include conversation history context in the SQL generation
          const historyContext =
            this.mistralService.formatConversationHistory(conversationHistory);
          const contextPrefix = historyContext
            ? `CONVERSATION HISTORY:\n${historyContext}\n\n`
            : "";

          // Include prompt analysis in the SQL generation
          const promptAnalysisStr = JSON.stringify(promptAnalysis, null, 2);

          const sqlPromptText = `
            ${contextPrefix}You are a SQL expert. Generate a PostgreSQL query based on the following information:

            RELEVANT SCHEMA:
            ${JSON.stringify(minimalSchema, null, 2)}

            USER REQUEST: ${userPrompt}
            
            DETAILED REQUEST ANALYSIS:
            ${promptAnalysisStr}

            IMPORTANT GUIDELINES:
            1. Use only the tables provided in the schema
            2. Use appropriate JOINs based on the relationships provided
            3. Include error handling for NULL values
            4. Use appropriate aggregation functions when needed
            5. Return ONLY the SQL query without any markdown formatting, explanations, or backticks
            6. The query must start with SELECT or WITH
            7. ALWAYS qualify column names with table aliases to avoid ambiguity (e.g., use "t1.country_id" instead of just "country_id")
            8. When using UNION, ensure all SELECT statements have the same number of columns with matching data types
            9. For complex queries, use CTEs (WITH clause) to improve readability and maintainability
            10. Use table aliases for all tables (e.g., "FROM countries AS c")
            11. Pay special attention to the core question and intent identified in the request analysis
            12. Apply any filters or conditions identified in the request analysis
            13. Include the specific fields identified as relevant in the request analysis
          `;

          return this.mistralService.generateMistralResponse(
            sqlPromptText,
            conversationHistory
          );
        });

        cleanSQL = this.sqlGenerationService.cleanSQLResponse(sqlResponse);
        console.log("Generated SQL:", cleanSQL);
      }

      // Validate and potentially fix the SQL
      const validatedSQL = await this.sqlGenerationService.validateSql(cleanSQL);

      // Execute SQL query
      const result = await pool.query(validatedSQL);

      // Learn from this successful query
      await this.sqlGenerationService.learnFromSuccessfulQuery(
        validatedSQL,
        minimalSchema,
        userPrompt,
        result.rows.length
      );

      // Process the primary data
      let data = result.rows;

      // Build relationship graph for more effective relationship handling
      const relationshipGraph = await this.dataEnrichmentService.buildRelationshipGraph(
        minimalSchema,
        relationships
      );

      // Perform multi-level relationship resolution (new enhanced method)
      data = await this.dataEnrichmentService.resolveMultiLevelRelationships(
        data,
        minimalSchema,
        relationships
      );

      // Process data with enhanced Danfo.js processing
      let insights = {}, columnTypes = {};
      try {
        if (this.dataEnrichmentService.processDataWithDanfo) {
          const result = await this.dataEnrichmentService.processDataWithDanfo(data);
          if (result) {
            data = result.processedData || data;
            insights = result.insights || {};
            columnTypes = result.columnTypes || {};
          }
        }
      } catch (danfoError) {
        console.error("Error processing data with Danfo.js:", danfoError);
      }
      
      // Safely filter data based on prompt analysis
      try {
        if (this.dataEnrichmentService.filterDataBasedOnPromptAnalysis) {
          data = await this.dataEnrichmentService.filterDataBasedOnPromptAnalysis(
            data,
            promptAnalysis
          );
        }
      } catch (filterError) {
        console.error("Error filtering data:", filterError);
      }
      
      // Safely analyze data for insights
      let dataInsights = [];
      try {
        if (this.dataEnrichmentService.analyzeDataForInsights) {
          const result = await this.dataEnrichmentService.analyzeDataForInsights(
            data,
            promptAnalysis
          );
          dataInsights = result.insights || [];
        }
      } catch (insightError) {
        console.error("Error analyzing data for insights:", insightError);
      }
      
      // Add insights to enhanced results
      enhancedResults.dataFrameInsights = insights;
      enhancedResults.columnTypes = columnTypes;
      enhancedResults.aiInsights = dataInsights;
      
      // Perform related queries to enrich the data
      const { primaryData, relatedData } = await this.dataEnrichmentService.performRelatedQueries(
        data,
        minimalSchema,
        relationships
      );

      // Resolve nested foreign key relationships (new step)
      data = await this.dataEnrichmentService.resolveNestedForeignKeys(
        primaryData,
        minimalSchema,
        relationships
      );

      // Enrich data by replacing IDs with meaningful values
      data = await this.dataEnrichmentService.enrichDataWithRelatedInfo(data, relatedData);

      // Format data using Danfo.js
      const { formattedData, insights: danfoInsights } =
        await this.dataEnrichmentService.formatDataWithDanfo(data);
      data = formattedData;

      // Ensure data consistency and accuracy (new step)
      const { data: consistentData, metadata: columnMetadata } =
        await this.dataEnrichmentService.ensureDataConsistency(data, minimalSchema);
      data = consistentData;

      // Generate consistent table structure (new step)
      const { tableData, tableStructure } =
        this.dataEnrichmentService.generateConsistentTableStructure(data, columnMetadata);

      // Make analysis decisions with error handling
      const decisions = await this.mistralService.retryWithBackoff(async () => {
        // Create a simple decision chain
        const prompt = `
          Analyze this request: ${userPrompt}
          
          Data sample: ${JSON.stringify(data.slice(0, 3))}
          
          Return a JSON with analysis decisions. The JSON should include:
          - intentClassification (with type, confidence, reasoning)
          - dataAssessment (with availableFields, dataTypes, sufficiencyScore, qualityIssues)
          - analysisStrategy (with recommendedTechniques, visualizations)
          - dataRequirements (with needsAdditionalQuery, additionalQueryDescription)
          - calculationsNeeded (array of calculations)
          - analysisSteps (array of steps)
          
          IMPORTANT: Format your response as valid JSON only, with no additional text.
        `;

        const response = await this.mistralService.generateMistralResponse(prompt);

        // Try to parse the response as JSON
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
          
          // Fallback to default decisions
          return {
            needsAdditionalQuery: false,
            additionalQueryDescription: null,
            calculationsNeeded: ["basic statistics"],
            analysisSteps: ["Basic data analysis"],
          };
        } catch (parseError) {
          console.warn(
            "Failed to parse decision chain response as JSON:",
            parseError
          );
          // Provide a fallback response if parsing fails
          return {
            needsAdditionalQuery: false,
            additionalQueryDescription: null,
            calculationsNeeded: ["basic statistics"],
            analysisSteps: ["Basic data analysis"],
          };
        }
      });

      // Perform calculations based on decisions
      const additionalCalculations = await this.mistralService.retryWithBackoff(async () => {
        return await this.analyticsService.performCalculations(
          data,
          decisions.calculationsNeeded
        );
      });

      // Enrich data with calculation results
      const finalEnrichedData = this.analyticsService.enrichDataWithCalculations(
        data,
        additionalCalculations
      );

      // Check if additional queries are needed
      let additionalQueries = [];
      if (
        decisions.dataRequirements &&
        decisions.dataRequirements.needsAdditionalQuery
      ) {
        additionalQueries = await this.mistralService.retryWithBackoff(async () => {
          return await this.sqlGenerationService.generateAdditionalQueries(
            userPrompt,
            minimalSchema,
            decisions.dataRequirements.additionalQueryDescription
          );
        });
      }

      // After processing the data, try to enhance the results
      try {
        // Process decisions to get enhanced insights
        enhancedResults = await this.analyticsService.processDecisions(
          decisions,
          finalEnrichedData,
          userPrompt
        );

        // Add Danfo.js insights
        enhancedResults.danfoInsights = danfoInsights;

        console.log("Enhanced results generated successfully");
      } catch (enhancementError) {
        console.warn("Error generating enhanced results:", enhancementError);
        // Keep the default empty structure instead of failing
      }

      // Include the enhanced insights in the final response
      enhancedResults.dataFrameInsights = insights;
      enhancedResults.columnTypes = columnTypes;

      // Filter data based on prompt analysis to remove irrelevant fields
      data = await this.dataEnrichmentService.filterDataBasedOnPromptAnalysis(
        data,
        promptAnalysis
      );
      
      // Analyze data to extract key insights based on prompt analysis
      const { insights: aiInsights } = await this.dataEnrichmentService.analyzeDataForInsights(
        data,
        promptAnalysis
      );
      
      // Add AI-generated insights to enhanced results
      enhancedResults.aiInsights = aiInsights;
      
      // Include AI insights in the report prompt
      const reportPrompt = `
        Generate a comprehensive report based on the following data and analysis:
        
        USER REQUEST: ${userPrompt}
        
        DATA SUMMARY: ${JSON.stringify(
          Array.isArray(finalEnrichedData) && finalEnrichedData.length > 0
            ? finalEnrichedData.slice(0, 5)
            : []
        )}
        ROW COUNT: ${
          Array.isArray(finalEnrichedData) ? finalEnrichedData.length : 0
        }
        ${
          enhancedResults?.insights
            ? `ENHANCED INSIGHTS: ${JSON.stringify(
                enhancedResults.insights
              )}`
            : ""
        }
        ${
          enhancedResults?.recommendations
            ? `RECOMMENDATIONS: ${JSON.stringify(
                enhancedResults.recommendations
              )}`
            : ""
        }
        ${
          enhancedResults?.danfoInsights
            ? `STATISTICAL INSIGHTS: ${JSON.stringify(
                enhancedResults.danfoInsights
              )}`
            : ""
        }
        ${
          enhancedResults?.aiInsights && enhancedResults.aiInsights.length > 0
            ? `AI INSIGHTS: ${JSON.stringify(
                enhancedResults.aiInsights
              )}`
            : ""
        }
        
        REPORT GUIDELINES:
        1. Focus specifically on answering the user's request: "${userPrompt}"
        2. Start with an executive summary that directly addresses what the user asked for
        3. Include key findings and insights that are relevant to the user's question
        4. Support conclusions with data from the analysis
        5. Use bullet points for clarity where appropriate
        6. Highlight any anomalies or unexpected patterns
        7. Format numbers and dates appropriately
        8. Structure the report in a clear, readable format
        9. If AI insights are available, incorporate them into the narrative
        10. If recommendations are available, include them in a dedicated section
        11. IMPORTANT: Use the actual names of entities rather than IDs (e.g., use "Product Name" instead of "product_id")
        12. If statistical insights are available, interpret correlations and group analysis in business terms
        13. DO NOT make assumptions about the data being about bookings or any specific domain - respond directly to what the data shows
      `;

      // Generate the report
      const report = await this.mistralService.retryWithBackoff(async () => {
        return this.mistralService.generateMistralResponse(reportPrompt, conversationHistory);
      });

      // When returning the final response, include the AI insights
      return {
        report,
        rawData: finalEnrichedData || [],
        generatedSQL: cleanSQL,
        additionalQueries,
        calculations: additionalCalculations || {},
        rowCount: Array.isArray(finalEnrichedData) ? finalEnrichedData.length : 0,
        tablesUsed: relevantTables || [],
        analysisSteps: decisions?.analysisSteps || [],
        enhancedResults: enhancedResults || {},
        relatedData: relatedData || {},
        tableStructure: tableStructure || {},
        columnMetadata: columnMetadata || {},
        aiInsights: dataInsights || [],
        processing: false,
      };
    } catch (error) {
      console.error("Error in report generation:", error);
      throw error;
    }
  }

  // Add this method to the ReportService class
  async generateReportStream(userPrompt, conversationHistory = [], sendUpdate) {
    try {
      // Send initial update to client
      sendUpdate({ 
        status: 'processing',
        message: 'Starting report generation...'
      });

      // Initialize variables that might be referenced later
      let initialResults = {
        insights: [],
        recommendations: [],
        additionalAnalyses: [],
      };

      // Perform deep prompt analysis first
      sendUpdate({ 
        status: 'processing',
        message: 'Analyzing your request...'
      });

      let promptAnalysis;
      try {
        promptAnalysis = await this.analyzeUserPrompt(userPrompt, conversationHistory);
        sendUpdate({ 
          status: 'processing',
          message: 'Request analysis complete',
          promptAnalysis: promptAnalysis
        });
      } catch (analysisError) {
        console.warn("Error in prompt analysis:", analysisError);
        promptAnalysis = {
          coreQuestion: userPrompt,
          intentClassification: { type: "descriptive", metrics: [] },
          entitiesAndRelationships: { entities: [], relationships: [], timePeriods: [] },
          dataRequirements: { relevantTables: [], relevantFields: [], aggregations: [], filters: [] },
          complexityAssessment: { level: "moderate", requiresMultipleQueries: false, requiresAdvancedAnalysis: false }
        };
      }
      
      // Get schema information with caching
      sendUpdate({ 
        status: 'processing',
        message: 'Retrieving database schema...'
      });

      const { schemas, relationships } = await this.getSchemaWithCache();

      // Use the prompt analysis to identify relevant tables with retry
      sendUpdate({ 
        status: 'processing',
        message: 'Identifying relevant data tables...'
      });

      let relevantTables;
      try {
        // Use the parallel approach for better performance
        relevantTables = await this.identifyRelevantTablesParallel(userPrompt, schemas, promptAnalysis);
        
        sendUpdate({ 
          status: 'processing',
          message: 'Identified relevant tables',
          tables: relevantTables
        });
      } catch (tableError) {
        console.error("Error identifying relevant tables:", tableError);
        // Use first available table as fallback
        relevantTables = Object.keys(schemas).slice(0, 1);
        if (relevantTables.length === 0) {
          throw new Error("No tables available in the database");
        }
      }

      // Create minimal schema with only relevant tables
      const minimalSchema = this.sqlGenerationService.createMinimalSchema(
        schemas,
        relationships,
        relevantTables
      );

      // Check if this is a complex analytical query
      let isComplexAnalytical = false;
      let analyticalQueryResult = null;

      if (promptAnalysis.complexityAssessment && 
          (promptAnalysis.complexityAssessment.level === "high" || 
           promptAnalysis.complexityAssessment.requiresAdvancedAnalysis)) {
        
        sendUpdate({ 
          status: 'processing',
          message: 'Detected complex analytical query, performing specialized analysis...'
        });
        
        analyticalQueryResult = await this.handleComplexAnalyticalQuery(
          userPrompt, 
          promptAnalysis, 
          schemas, 
          relationships
        );
        
        if (analyticalQueryResult && analyticalQueryResult.analyticalSQL) {
          isComplexAnalytical = true;
          sendUpdate({ 
            status: 'processing',
            message: 'Generated specialized analytical query',
            analyticalConcepts: analyticalQueryResult.extractedConcepts
          });
        }
      }

      // Then, when generating SQL, use the analytical SQL if available:
      let sql, cleanSQL;

      if (isComplexAnalytical && analyticalQueryResult.analyticalSQL) {
        sql = analyticalQueryResult.analyticalSQL;
        cleanSQL = sql; // Analytical SQL is already clean
        
        sendUpdate({ 
          status: 'processing',
          message: 'Using specialized analytical SQL',
          sql: cleanSQL
        });
      } else {
        // Generate SQL query with retry, now enhanced with prompt analysis
        const sqlResponse = await this.mistralService.retryWithBackoff(async () => {
          // Include conversation history context in the SQL generation
          const historyContext =
            this.mistralService.formatConversationHistory(conversationHistory);
          const contextPrefix = historyContext
            ? `CONVERSATION HISTORY:\n${historyContext}\n\n`
            : "";

          // Include prompt analysis in the SQL generation
          const promptAnalysisStr = JSON.stringify(promptAnalysis, null, 2);

          const sqlPromptText = `
            ${contextPrefix}You are a SQL expert. Generate a PostgreSQL query based on the following information:

            RELEVANT SCHEMA:
            ${JSON.stringify(minimalSchema, null, 2)}

            USER REQUEST: ${userPrompt}
            
            DETAILED REQUEST ANALYSIS:
            ${promptAnalysisStr}

            IMPORTANT GUIDELINES:
            1. Use only the tables provided in the schema
            2. Use appropriate JOINs based on the relationships provided
            3. Include error handling for NULL values
            4. Use appropriate aggregation functions when needed
            5. Return ONLY the SQL query without any markdown formatting, explanations, or backticks
            6. The query must start with SELECT or WITH
            7. ALWAYS qualify column names with table aliases to avoid ambiguity (e.g., use "t1.country_id" instead of just "country_id")
            8. When using UNION, ensure all SELECT statements have the same number of columns with matching data types
            9. For complex queries, use CTEs (WITH clause) to improve readability and maintainability
            10. Use table aliases for all tables (e.g., "FROM countries AS c")
            11. Pay special attention to the core question and intent identified in the request analysis
            12. Apply any filters or conditions identified in the request analysis
            13. Include the specific fields identified as relevant in the request analysis
          `;

          return this.mistralService.generateMistralResponse(
            sqlPromptText,
            conversationHistory
          );
        });

        cleanSQL = this.sqlGenerationService.cleanSQLResponse(sqlResponse);
        console.log("Generated SQL:", cleanSQL);
      }

      // Execute the SQL query with fallback mechanism
      sendUpdate({ 
        status: 'processing',
        message: 'Executing SQL query...'
      });

      const queryResult = await this.executeSqlWithFallback(cleanSQL, userPrompt, minimalSchema, sendUpdate);

      // Extract data and handle fallback messages
      const data = queryResult.data || [];
      if (queryResult.fallbackUsed) {
        cleanSQL = queryResult.sql;
        sendUpdate({ 
          status: 'processing',
          message: queryResult.message || 'Using simplified query due to errors with original query'
        });
      }

      // If we still have no data, provide a clear message
      if (data.length === 0) {
        sendUpdate({ 
          status: 'processing',
          message: 'No data found. The query may be incorrect or the table might be empty.'
        });
      }

      // Learn from this successful query
      await this.sqlGenerationService.learnFromSuccessfulQuery(
        cleanSQL,
        minimalSchema,
        userPrompt,
        data.length
      );

      // Process the primary data
      let processedData = data;

      // Build relationship graph for more effective relationship handling
      const relationshipGraph = await this.dataEnrichmentService.buildRelationshipGraph(
        minimalSchema,
        relationships
      );

      // Perform multi-level relationship resolution (new enhanced method)
      processedData = await this.dataEnrichmentService.resolveMultiLevelRelationships(
        processedData,
        minimalSchema,
        relationships
      );

      // Process data with enhanced Danfo.js processing
      sendUpdate({ 
        status: 'processing',
        message: 'Processing data...'
      });
      
      // Use parallel processing for better performance
      const {
        enrichedData,
        relatedData,
        insights: dataInsights,
        calculations: additionalCalculations,
        enhancedResults: parallelResults,
        columnTypes
      } = await this.processDataInParallel(processedData, promptAnalysis, schemas, relationships);

      // Merge the results
      const enhancedResults = {
        ...initialResults,
        ...parallelResults,
        columnTypes
      };

      // Format data using Danfo.js
      const { formattedData, insights: danfoInsights } =
        await this.dataEnrichmentService.formatDataWithDanfo(enrichedData);
      processedData = formattedData;

      // Ensure data consistency and accuracy (new step)
      const { data: consistentData, metadata: columnMetadata } =
        await this.dataEnrichmentService.ensureDataConsistency(processedData, minimalSchema);
      processedData = consistentData;

      // Generate consistent table structure (new step)
      const { tableData, tableStructure } =
        this.dataEnrichmentService.generateConsistentTableStructure(processedData, columnMetadata);

      // Make analysis decisions with error handling
      sendUpdate({ 
        status: 'processing',
        message: 'Determining analysis approach...'
      });
      
      const decisions = await this.mistralService.retryWithBackoff(async () => {
        // Create a simple decision chain
        const prompt = `
          Analyze this request: ${userPrompt}
          
          Data sample: ${JSON.stringify(processedData.slice(0, 3))}
          
          Return a JSON with analysis decisions. The JSON should include:
          - intentClassification (with type, confidence, reasoning)
          - dataAssessment (with availableFields, dataTypes, sufficiencyScore, qualityIssues)
          - analysisStrategy (with recommendedTechniques, visualizations)
          - dataRequirements (with needsAdditionalQuery, additionalQueryDescription)
          - calculationsNeeded (array of calculations)
          - analysisSteps (array of steps)
          
          IMPORTANT: Format your response as valid JSON only, with no additional text.
        `;

        const response = await this.mistralService.generateMistralResponse(prompt);

        // Try to parse the response as JSON
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
          
          // Fallback to default decisions
          return {
            needsAdditionalQuery: false,
            additionalQueryDescription: null,
            calculationsNeeded: ["basic statistics"],
            analysisSteps: ["Basic data analysis"],
          };
        } catch (parseError) {
          console.warn(
            "Failed to parse decision chain response as JSON:",
            parseError
          );
          // Provide a fallback response if parsing fails
          return {
            needsAdditionalQuery: false,
            additionalQueryDescription: null,
            calculationsNeeded: ["basic statistics"],
            analysisSteps: ["Basic data analysis"],
          };
        }
      });

      // Perform calculations based on decisions
      sendUpdate({ 
        status: 'processing',
        message: 'Performing calculations...'
      });
      
      const calculationResults = await this.mistralService.retryWithBackoff(async () => {
        return await this.analyticsService.performCalculations(
          processedData,
          decisions.calculationsNeeded
        );
      });

      // Enrich data with calculation results
      const finalEnrichedData = this.analyticsService.enrichDataWithCalculations(
        processedData,
        additionalCalculations
      );

      // Check if additional queries are needed
      let additionalQueries = [];
      if (
        decisions.dataRequirements &&
        decisions.dataRequirements.needsAdditionalQuery
      ) {
        sendUpdate({ 
          status: 'processing',
          message: 'Generating follow-up questions...'
        });
        
        additionalQueries = await this.mistralService.retryWithBackoff(async () => {
          return await this.sqlGenerationService.generateAdditionalQueries(
            userPrompt,
            minimalSchema,
            decisions.dataRequirements.additionalQueryDescription
          );
        });
      }

      // After processing the data, try to enhance the results
      sendUpdate({ 
        status: 'processing',
        message: 'Enhancing analysis results...'
      });
      
      try {
        // Process decisions to get enhanced insights
        initialResults = await this.analyticsService.processDecisions(
          decisions,
          finalEnrichedData,
          userPrompt
        );

        // Add Danfo.js insights
        initialResults.danfoInsights = danfoInsights;

        console.log("Enhanced results generated successfully");
      } catch (enhancementError) {
        console.warn("Error generating enhanced results:", enhancementError);
        // Keep the default empty structure instead of failing
      }

      // Include the enhanced insights in the final response
      initialResults.dataFrameInsights = dataInsights;
      initialResults.columnTypes = columnTypes;

      // Filter data based on prompt analysis to remove irrelevant fields
      processedData = await this.dataEnrichmentService.filterDataBasedOnPromptAnalysis(
        processedData,
        promptAnalysis
      );
      
      // Analyze data to extract key insights based on prompt analysis
      const { insights: aiInsights } = await this.dataEnrichmentService.analyzeDataForInsights(
        processedData,
        promptAnalysis
      );
      
      // Add AI-generated insights to enhanced results
      initialResults.aiInsights = aiInsights;
      
      // Include AI insights in the report prompt
      sendUpdate({ 
        status: 'processing',
        message: 'Generating final report...'
      });
      
      const reportPrompt = `
        Generate a comprehensive report based on the following data and analysis:
        
        USER REQUEST: ${userPrompt}
        
        DATA SUMMARY: ${JSON.stringify(
          Array.isArray(finalEnrichedData) && finalEnrichedData.length > 0
            ? finalEnrichedData.slice(0, 5)
            : []
        )}
        ROW COUNT: ${
          Array.isArray(finalEnrichedData) ? finalEnrichedData.length : 0
        }
        ${
          initialResults?.insights
            ? `ENHANCED INSIGHTS: ${JSON.stringify(
                initialResults.insights
              )}`
            : ""
        }
        ${
          initialResults?.recommendations
            ? `RECOMMENDATIONS: ${JSON.stringify(
                initialResults.recommendations
              )}`
            : ""
        }
        ${
          initialResults?.danfoInsights
            ? `STATISTICAL INSIGHTS: ${JSON.stringify(
                initialResults.danfoInsights
              )}`
            : ""
        }
        ${
          initialResults?.aiInsights && initialResults.aiInsights.length > 0
            ? `AI INSIGHTS: ${JSON.stringify(
                initialResults.aiInsights
              )}`
            : ""
        }
        
        REPORT GUIDELINES:
        1. Focus specifically on answering the user's request: "${userPrompt}"
        2. Start with an executive summary that directly addresses what the user asked for
        3. Include key findings and insights that are relevant to the user's question (Optional if not relevant)
        4. Support conclusions with data from the analysis (Optional if not relevant)
        5. Use bullet points for clarity where appropriate (Optional if not relevant)
        6. Highlight any anomalies or unexpected patterns (Optional if not relevant)
        7. Format numbers and dates appropriately 
        8. Structure the report in a clear, readable format
        9. If AI insights are available, incorporate them into the narrative
        10. If recommendations are available, include them in a dedicated section
        11. IMPORTANT: Use the actual names of entities rather than IDs (e.g., use "Product Name" instead of "product_id")
        12. If statistical insights are available, interpret correlations and group analysis in business terms (Optional if not relevant)
        13. DO NOT make assumptions about the data being about  any specific domain - respond directly to what the data shows
      `;

      // Generate the report
      const report = await this.mistralService.retryWithBackoff(async () => {
        return this.mistralService.generateMistralResponse(reportPrompt, conversationHistory);
      });

      // Send the final complete response in chunks if needed
      const finalResponse = {
        status: 'complete',
        report,
        rawData: finalEnrichedData || [],
        generatedSQL: cleanSQL,
        additionalQueries,
        calculations: additionalCalculations || {},
        rowCount: Array.isArray(finalEnrichedData) ? finalEnrichedData.length : 0,
        tablesUsed: relevantTables || [],
        analysisSteps: decisions?.analysisSteps || [],
        enhancedResults: enhancedResults || {},
        relatedData: relatedData || {},
        tableStructure: tableStructure || {},
        columnMetadata: columnMetadata || {},
        aiInsights: dataInsights || [],
        processing: false,
      };

      // Use the chunking method to send the response
      this.chunkJsonData(finalResponse, sendUpdate);
      
      return finalResponse;
    } catch (error) {
      console.error("Error in report generation:", error);
      
      // Send error update to client
      sendUpdate({
        status: 'error',
        message: `Error generating report: ${error.message}`,
        error: error.message
      });
      
      // Return a graceful error response
      return {
        status: 'error',
        error: error.message,
        errorDetails: error.stack,
        partialData: {
          report: "An error occurred while generating your report. Please try again or refine your query.",
          rawData: [],
          generatedSQL: "",
          additionalQueries: [],
          calculations: {},
          rowCount: 0,
          tablesUsed: [],
          analysisSteps: ["Error occurred during analysis"],
          enhancedResults: {},
          relatedData: {},
          tableStructure: {},
          columnMetadata: {},
          aiInsights: [],
          processing: false
        }
      };
    }
  }

  // Optimized SQL execution that doesn't block the event loop
  async executeSqlNonBlocking(sql) {
    return new Promise((resolve, reject) => {
      // Use setImmediate to avoid blocking the event loop
      setImmediate(async () => {
        try {
          const result = await pool.query(sql);
          resolve({ data: this.formatDatesInData(result.rows), sql });
        } catch (error) {
          console.error("SQL execution error:", error);
          reject(error);
        }
      });
    });
  }

  // Update the executeSqlWithFallback method to use non-blocking execution
  async executeSqlWithFallback(sql, userPrompt, minimalSchema, sendUpdate) {
    try {
      // First attempt: Try the original SQL
      sendUpdate({ 
        status: 'processing',
        message: 'Executing SQL query...'
      });
      
      return await this.executeSqlNonBlocking(sql);
    } catch (error) {
      console.error("SQL execution error:", error);
      
      sendUpdate({ 
        status: 'processing',
        message: 'Initial query failed. Attempting simplified query...'
      });
      
      // Extract table names from the failed query
      const tableMatches = sql.match(/from\s+([a-z_][a-z0-9_]*)/gi) || [];
      const joinMatches = sql.match(/join\s+([a-z_][a-z0-9_]*)/gi) || [];
      
      const tables = [
        ...tableMatches.map(match => match.replace(/from\s+/i, "").trim()),
        ...joinMatches.map(match => match.replace(/join\s+/i, "").trim())
      ];
      
      // If we found tables, try querying them individually
      if (tables.length > 0) {
        try {
          // Get primary table (first one in the FROM clause)
          const primaryTable = tables[0];
          
          // Create a simple query for the primary table
          const simpleSql = `SELECT * FROM ${primaryTable} LIMIT 1000`;
          
          sendUpdate({ 
            status: 'processing',
            message: `Querying primary table: ${primaryTable}`
          });
          
          // Execute the simple query
          const result = await pool.query(simpleSql);
          
          if (result.rows.length > 0) {
            // If we have more than one table, try to fetch related data
            if (tables.length > 1) {
              sendUpdate({ 
                status: 'processing',
                message: 'Fetching related data separately...'
              });
              
              // Get data from other tables
              const relatedData = {};
              for (let i = 1; i < tables.length; i++) {
                try {
                  const tableSql = `SELECT * FROM ${tables[i]} LIMIT 1000`;
                  const tableResult = await pool.query(tableSql);
                  relatedData[tables[i]] = tableResult.rows;
                } catch (tableError) {
                  console.warn(`Error fetching data from ${tables[i]}:`, tableError);
                }
              }
              
              // Perform in-memory join if possible
              if (Object.keys(relatedData).length > 0) {
                sendUpdate({ 
                  status: 'processing',
                  message: 'Performing in-memory data processing...'
                });
                
                // Use the DataEnrichmentService to combine the data
                const enrichedResult = await this.dataEnrichmentService.performRelatedQueries(
                  result.rows, 
                  minimalSchema.tables, 
                  minimalSchema.relationships
                );
                
                const formattedData = this.formatDatesInData(enrichedResult.primaryData);
                return { 
                  data: formattedData, 
                  relatedData: enrichedResult.relatedData,
                  sql: simpleSql,
                  fallbackUsed: true
                };
              }
            }
            
            const formattedData = this.formatDatesInData(result.rows);
            return { 
              data: formattedData, 
              sql: simpleSql,
              fallbackUsed: true
            };
          }
        } catch (fallbackError) {
          console.error("Fallback query error:", fallbackError);
        }
      }
      
      // Last resort: Get some sample data from any available table
      sendUpdate({ 
        status: 'processing',
        message: 'Attempting to retrieve sample data...'
      });
      
      try {
        // Get list of all tables
        const tablesQuery = `
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
          LIMIT 10
        `;
        
        const tablesResult = await pool.query(tablesQuery);
        
        if (tablesResult.rows.length > 0) {
          // Try each table until we get some data
          for (const tableRow of tablesResult.rows) {
            try {
              const tableName = tableRow.table_name;
              const sampleSql = `SELECT * FROM ${tableName} LIMIT 100`;
              const sampleResult = await pool.query(sampleSql);
              
              if (sampleResult.rows.length > 0) {
                const formattedData = this.formatDatesInData(sampleResult.rows);
                return { 
                  data: formattedData, 
                  sql: sampleSql,
                  fallbackUsed: true,
                  message: `Could not execute original query. Showing sample data from ${tableName} instead.`
                };
              }
            } catch (sampleError) {
              // Continue to the next table
              console.warn("Error with sample table:", sampleError);
            }
          }
        }
      } catch (lastResortError) {
        console.error("Last resort query error:", lastResortError);
      }
      
      // If all else fails, return empty data with error message
      return { 
        data: [], 
        sql: sql,
        error: error.message,
        fallbackUsed: true,
        message: "Could not retrieve data. Please try a different query."
      };
    }
  }

  // Add this helper method to the ReportService class
  chunkJsonData(data, sendUpdate) {
    try {
      // For large objects, break them into smaller chunks
      const jsonString = JSON.stringify(data);
      
      // If the data is small enough, send it directly
      if (jsonString.length < 50000) {
        sendUpdate(data);
        return;
      }
      
      // For large data, send it in chunks
      console.log(`Large data detected (${jsonString.length} chars), sending in chunks`);
      
      // First send a message without the large arrays
      const metadataOnly = { ...data };
      
      // Remove large arrays that will be sent separately
      if (metadataOnly.rawData && metadataOnly.rawData.length > 0) {
        metadataOnly.rawData = [];
        metadataOnly.rawDataPending = true;
      }
      
      // Send the metadata first
      sendUpdate(metadataOnly);
      
      // If we have raw data, send it in chunks
      if (data.rawData && data.rawData.length > 0) {
        // Send raw data in chunks of 100 rows
        const chunkSize = 100;
        for (let i = 0; i < data.rawData.length; i += chunkSize) {
          const chunk = data.rawData.slice(i, i + chunkSize);
          sendUpdate({
            rawDataChunk: chunk,
            chunkIndex: i / chunkSize,
            totalChunks: Math.ceil(data.rawData.length / chunkSize)
          });
        }
        
        // Send completion message
        sendUpdate({
          rawDataComplete: true,
          rowCount: data.rawData.length
        });
      }
    } catch (error) {
      console.error("Error chunking JSON data:", error);
      // Fall back to sending a simplified version
      sendUpdate({
        status: data.status,
        message: data.message || "Data processed but too large to display completely",
        error: error.message
      });
    }
  }

  // Add this helper method to the ReportService class
  formatDatesInData(data) {
    if (!Array.isArray(data) || data.length === 0) return data;
    
    return data.map(row => {
      const formattedRow = { ...row };
      
      // Check each field for potential date values
      Object.keys(formattedRow).forEach(key => {
        const value = formattedRow[key];
        
        // Skip null or undefined values
        if (value === null || value === undefined) return;
        
        // Check if the value is a date string (ISO format or similar)
        if (typeof value === 'string' && this.isLikelyDate(value)) {
          try {
            const date = new Date(value);
            
            // Only format if it's a valid date
            if (!isNaN(date.getTime())) {
              // Format date as "Month Day, Year" or with time if it has non-zero time
              if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
                formattedRow[key] = date.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                });
              } else {
                formattedRow[key] = date.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
              }
            }
          } catch (e) {
            // If date parsing fails, keep the original value
            console.warn(`Failed to format date: ${value}`);
          }
        }
      });
      
      return formattedRow;
    });
  }

  // Helper to detect if a string is likely a date
  isLikelyDate(str) {
    // Common date formats
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}/, // ISO date: 2023-01-15
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO datetime: 2023-01-15T14:30
      /^\d{2}\/\d{2}\/\d{4}/, // MM/DD/YYYY
      /^\d{4}\/\d{2}\/\d{2}/, // YYYY/MM/DD
      /^\d{2}-\d{2}-\d{4}/, // MM-DD-YYYY
      /^\w{3}\s\d{2},\s\d{4}/ // Jan 15, 2023
    ];
    
    return datePatterns.some(pattern => pattern.test(str));
  }

  // Add this method to the ReportService class
  async analyzeSchemaAndMakeDecisions(userPrompt, promptAnalysis, relevantTables, schemas, relationships) {
    try {
      console.log("Analyzing schema structure and making decisions...");
      
      // Extract relevant schema information for the identified tables
      const relevantSchemas = {};
      const tableRelationships = [];
      
      // Build schema information for relevant tables
      relevantTables.forEach(table => {
        if (schemas[table]) {
          relevantSchemas[table] = schemas[table];
        }
      });
      
      // Find relationships between the relevant tables
      relationships.forEach(rel => {
        if (relevantTables.includes(rel.table_name) && 
            relevantTables.includes(rel.foreign_table_name)) {
          tableRelationships.push(rel);
        }
      });
      
      // Identify parent-child relationships
      const parentChildMap = {};
      const childParentMap = {};
      
      tableRelationships.forEach(rel => {
        // Parent table has foreign keys pointing to it
        if (!parentChildMap[rel.foreign_table_name]) {
          parentChildMap[rel.foreign_table_name] = [];
        }
        parentChildMap[rel.foreign_table_name].push({
          childTable: rel.table_name,
          childColumn: rel.column_name,
          parentColumn: rel.foreign_column_name
        });
        
        // Child table points to parent tables
        if (!childParentMap[rel.table_name]) {
          childParentMap[rel.table_name] = [];
        }
        childParentMap[rel.table_name].push({
          parentTable: rel.foreign_table_name,
          parentColumn: rel.foreign_column_name,
          childColumn: rel.column_name
        });
      });
      
      // Create a minimal schema representation for the AI
      const minimalSchema = {
        tables: Object.entries(relevantSchemas).map(([tableName, schema]) => ({
          name: tableName,
          columns: schema.columns.map(col => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES'
          }))
        })),
        relationships: tableRelationships.map(rel => ({
          fromTable: rel.table_name,
          fromColumn: rel.column_name,
          toTable: rel.foreign_table_name,
          toColumn: rel.foreign_column_name
        })),
        parentChildRelationships: Object.entries(parentChildMap).map(([parent, children]) => ({
          parentTable: parent,
          childTables: children.map(c => c.childTable)
        }))
      };
      
      // Use AI to make decisions about the query approach
      const decisionPrompt = `
        I need to analyze a database schema and make decisions about how to approach a user's query.
        
        User's request: "${userPrompt}"
        
        Prompt analysis: ${JSON.stringify(promptAnalysis, null, 2)}
        
        Database schema information:
        ${JSON.stringify(minimalSchema, null, 2)}
        
        Based on this information, please:
        1. Identify the primary table that should be the focus of the query
        2. Determine which related tables need to be joined
        3. Identify key columns that should be included in the results
        4. Determine if aggregations are needed (COUNT, SUM, AVG, etc.)
        5. Identify any time-based analysis requirements
        6. Determine if filtering is needed and on which columns
        7. Assess if the query requires complex calculations that might be better done in application code
        8. Recommend the most efficient query approach
        
        Return your analysis as a JSON object with the following structure:
        {
          "primaryTable": "table_name",
          "joinTables": ["table1", "table2"],
          "keyColumns": ["col1", "col2"],
          "aggregations": [{"function": "COUNT", "column": "col", "alias": "count_alias"}],
          "timeAnalysis": {"column": "date_column", "groupBy": "MONTH"},
          "filters": [{"column": "status", "operator": "=", "value": "active"}],
          "complexCalculations": boolean,
          "queryApproach": "description of approach",
          "potentialIssues": ["issue1", "issue2"]
        }
      `;
      
      // Get AI recommendations
      const aiDecisionResponse = await this.mistralService.generateMistralResponse(decisionPrompt);
      
      // Parse the JSON response
      let aiDecisions;
      try {
        // Extract JSON from the response
        const jsonMatch = aiDecisionResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiDecisions = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not extract JSON from AI response");
        }
      } catch (parseError) {
        console.warn("Error parsing AI decisions:", parseError);
        // Provide default decisions
        aiDecisions = {
          primaryTable: relevantTables[0],
          joinTables: relevantTables.slice(1),
          keyColumns: [],
          aggregations: [],
          timeAnalysis: null,
          filters: [],
          complexCalculations: false,
          queryApproach: "simple query",
          potentialIssues: ["AI could not provide structured recommendations"]
        };
      }
      
      // Combine AI decisions with schema information
      return {
        aiDecisions,
        minimalSchema,
        parentChildMap,
        childParentMap,
        relevantSchemas
      };
    } catch (error) {
      console.error("Error in schema analysis and decision making:", error);
      // Return basic decisions as fallback
      return {
        aiDecisions: {
          primaryTable: relevantTables[0],
          joinTables: [],
          keyColumns: [],
          aggregations: [],
          timeAnalysis: null,
          filters: [],
          complexCalculations: false,
          queryApproach: "simple query",
          potentialIssues: ["Error in analysis"]
        },
        minimalSchema: {
          tables: relevantTables.map(table => ({
            name: table,
            columns: schemas[table]?.columns.map(col => ({
              name: col.column_name,
              type: col.data_type
            })) || []
          })),
          relationships: [],
          parentChildRelationships: []
        },
        parentChildMap: {},
        childParentMap: {},
        relevantSchemas
      };
    }
  }

  // Add this method to handle complex analytical queries
  async handleComplexAnalyticalQuery(userPrompt, promptAnalysis, schemas, relationships) {
    try {
      console.log("Handling complex analytical query...");
      
      // Extract key analytical concepts from the prompt
      const extractedConcepts = await this.extractAnalyticalConcepts(userPrompt);
      
      // Identify business metrics and calculations needed
      const metrics = this.identifyBusinessMetrics(extractedConcepts, promptAnalysis);
      
      // Map business metrics to database fields and calculations
      const metricMappings = await this.mapMetricsToFields(metrics, schemas, relationships);
      
      // Generate specialized SQL for complex analytical queries
      const analyticalSQL = await this.generateAnalyticalSQL(metricMappings, promptAnalysis, schemas, relationships);
      
      return {
        extractedConcepts,
        metrics,
        metricMappings,
        analyticalSQL
      };
    } catch (error) {
      console.error("Error handling complex analytical query:", error);
      return null;
    }
  }

  // Extract analytical concepts from user prompt
  async extractAnalyticalConcepts(userPrompt) {
    try {
      const conceptExtractionPrompt = `
        Analyze this business query and extract key analytical concepts:
        "${userPrompt}"
        
        Please identify:
        1. Business metrics mentioned (e.g., profit, revenue, count, average)
        2. Time periods (e.g., this month, last year, Q1)
        3. Filtering conditions (e.g., for a specific office, by product category)
        4. Grouping dimensions (e.g., by office, by student, by product)
        5. Sorting requirements (e.g., top performers, lowest values)
        6. Comparison requests (e.g., compare to previous period, benchmark against target)
        
        Return as JSON with these categories.
      `;
      
      const response = await this.mistralService.generateMistralResponse(conceptExtractionPrompt);
      
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fallback if JSON extraction fails
      return {
        businessMetrics: [],
        timePeriods: [],
        filterConditions: [],
        groupingDimensions: [],
        sortingRequirements: [],
        comparisonRequests: []
      };
    } catch (error) {
      console.error("Error extracting analytical concepts:", error);
      return {
        businessMetrics: [],
        timePeriods: [],
        filterConditions: [],
        groupingDimensions: [],
        sortingRequirements: [],
        comparisonRequests: []
      };
    }
  }

  // Identify business metrics from concepts
  identifyBusinessMetrics(extractedConcepts, promptAnalysis) {
    // Common business metric patterns
    const metricPatterns = {
      profit: ['profit', 'net income', 'earnings', 'margin'],
      revenue: ['revenue', 'sales', 'income', 'turnover'],
      count: ['count', 'number of', 'how many', 'total number'],
      average: ['average', 'mean', 'avg'],
      maximum: ['maximum', 'highest', 'top', 'best'],
      minimum: ['minimum', 'lowest', 'worst', 'bottom'],
      sum: ['sum', 'total', 'overall'],
      growth: ['growth', 'increase', 'change', 'difference']
    };
    
    const metrics = [];
    
    // Extract metrics from concepts
    if (extractedConcepts.businessMetrics) {
      extractedConcepts.businessMetrics.forEach(concept => {
        const lowerConcept = concept.toLowerCase();
        
        // Check against patterns
        for (const [metricType, patterns] of Object.entries(metricPatterns)) {
          if (patterns.some(pattern => lowerConcept.includes(pattern))) {
            metrics.push({
              type: metricType,
              rawText: concept,
              confidence: 0.9
            });
            break;
          }
        }
      });
    }
    
    // Also check the original prompt analysis
    if (promptAnalysis.intentClassification && promptAnalysis.intentClassification.metrics) {
      promptAnalysis.intentClassification.metrics.forEach(metric => {
        // Only add if not already included
        if (!metrics.some(m => m.rawText.toLowerCase() === metric.toLowerCase())) {
          metrics.push({
            type: 'unknown',
            rawText: metric,
            confidence: 0.7
          });
        }
      });
    }
    
    return metrics;
  }

  // Map business metrics to database fields
  async mapMetricsToFields(metrics, schemas, relationships) {
    if (!metrics || metrics.length === 0) {
      return [];
    }
    
    // Create a simplified schema representation for the AI
    const simplifiedSchema = Object.entries(schemas).map(([tableName, schema]) => ({
      table: tableName,
      columns: schema.columns.map(col => col.column_name)
    }));
    
    // Create mapping prompt for AI
    const mappingPrompt = `
      I need to map these business metrics to database fields:
      ${JSON.stringify(metrics)}
      
      Database schema:
      ${JSON.stringify(simplifiedSchema)}
      
      For each metric, determine:
      1. Which table(s) contain the relevant data
      2. Which column(s) are needed for the calculation
      3. What SQL function or calculation is needed (SUM, AVG, COUNT, custom formula, etc.)
      
      Return a JSON array with mappings for each metric.
    `;
    
    try {
      const response = await this.mistralService.generateMistralResponse(mappingPrompt);
      
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return [];
    } catch (error) {
      console.error("Error mapping metrics to fields:", error);
      return [];
    }
  }

  // Generate specialized SQL for analytical queries
  async generateAnalyticalSQL(metricMappings, promptAnalysis, schemas, relationships) {
    if (!metricMappings || metricMappings.length === 0) {
      return null;
    }
    
    // Extract relevant tables from metric mappings
    const relevantTables = new Set();
    metricMappings.forEach(mapping => {
      if (mapping.tables) {
        mapping.tables.forEach(table => relevantTables.add(table));
      }
    });
    
    // Create a simplified schema with only relevant tables
    const relevantSchema = {};
    relevantTables.forEach(table => {
      if (schemas[table]) {
        relevantSchema[table] = schemas[table];
      }
    });
    
    // Find relationships between relevant tables
    const relevantRelationships = relationships.filter(rel => 
      relevantTables.has(rel.table_name) && relevantTables.has(rel.foreign_table_name)
    );
    
    // Create SQL generation prompt
    const sqlGenerationPrompt = `
      Generate SQL for this analytical query:
      
      Metrics needed: ${JSON.stringify(metricMappings)}
      
      User's original request: "${promptAnalysis.coreQuestion}"
      
      Relevant schema: ${JSON.stringify(relevantSchema)}
      
      Table relationships: ${JSON.stringify(relevantRelationships)}
      
      Additional requirements:
      - Time filters: ${JSON.stringify(promptAnalysis.entitiesAndRelationships?.timePeriods || [])}
      - Filtering conditions: ${JSON.stringify(promptAnalysis.dataRequirements?.filters || [])}
      - Grouping: ${JSON.stringify(promptAnalysis.dataRequirements?.groupBy || [])}
      
      Generate a single SQL query that calculates all required metrics.
      The SQL should be valid PostgreSQL syntax.
      Include comments explaining complex parts of the query.
    `;
    
    try {
      const response = await this.mistralService.generateMistralResponse(sqlGenerationPrompt);
      
      // Extract SQL from response
      const sqlMatch = response.match(/```sql\n([\s\S]*?)```/);
      if (sqlMatch && sqlMatch[1]) {
        return sqlMatch[1].trim();
      }
      
      // If no SQL block found, try to extract any SQL-like content
      const fallbackMatch = response.match(/SELECT[\s\S]*?FROM[\s\S]*/i);
      if (fallbackMatch) {
        return fallbackMatch[0].trim();
      }
      
      return null;
    } catch (error) {
      console.error("Error generating analytical SQL:", error);
      return null;
    }
  }

  // Add this optimized method to identify relevant tables in parallel
  async identifyRelevantTablesParallel(userPrompt, schemas, promptAnalysis) {
    console.log("Identifying relevant tables in parallel...");
    
    try {
      // First check if we have tables from prompt analysis
      if (promptAnalysis?.dataRequirements?.relevantTables?.length > 0) {
        const suggestedTables = promptAnalysis.dataRequirements.relevantTables
          .map(table => typeof table === 'string' ? table.toLowerCase() : '')
          .filter(table => schemas[table]);
          
        if (suggestedTables.length > 0) {
          console.log("Using tables from prompt analysis:", suggestedTables);
          return suggestedTables;
        }
      }
      
      // If no tables from analysis, use multiple approaches in parallel
      const approaches = [
        // Approach 1: Use SqlGenerationService
        this.sqlGenerationService.identifyRelevantTables(userPrompt, schemas),
        
        // Approach 2: Direct AI query for tables
        this.identifyTablesWithAI(userPrompt, schemas),
        
        // Approach 3: Extract table names from the prompt
        this.extractTableNamesFromPrompt(userPrompt, schemas)
      ];
      
      // Run all approaches in parallel
      const results = await Promise.all(approaches);
      
      // Combine and deduplicate results
      const allTables = [...new Set(results.flat())];
      
      if (allTables.length > 0) {
        console.log("Identified tables using parallel approaches:", allTables);
        return allTables;
      }
      
      // Fallback to default table if nothing found
      const defaultTable = Object.keys(schemas)[0];
      if (defaultTable) {
        console.log("No relevant tables found, using default table:", defaultTable);
        return [defaultTable];
      }
      
      throw new Error("No relevant tables identified for this query");
    } catch (error) {
      console.error("Error in parallel table identification:", error);
      // Use first available table as fallback
      const fallbackTable = Object.keys(schemas)[0];
      return fallbackTable ? [fallbackTable] : [];
    }
  }

  // Helper method to identify tables directly with AI
  async identifyTablesWithAI(userPrompt, schemas) {
    try {
      const tableNames = Object.keys(schemas);
      
      const prompt = `
        Given this user query: "${userPrompt}"
        
        And these available database tables: ${tableNames.join(', ')}
        
        Which tables are most relevant to answer this query?
        Return only the table names as a JSON array, nothing else.
      `;
      
      const response = await this.mistralService.generateMistralResponse(prompt);
      
      // Extract JSON array from response
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const tables = JSON.parse(match[0]);
        return tables.filter(table => tableNames.includes(table));
      }
      
      return [];
    } catch (error) {
      console.error("Error identifying tables with AI:", error);
      return [];
    }
  }

  // Helper method to extract table names directly from the prompt
  extractTableNamesFromPrompt(userPrompt, schemas) {
    const tableNames = Object.keys(schemas);
    const lowerPrompt = userPrompt.toLowerCase();
    
    // Find table names mentioned in the prompt
    return tableNames.filter(table => 
      lowerPrompt.includes(table.toLowerCase()) ||
      lowerPrompt.includes(table.toLowerCase().replace('_', ' '))
    );
  }

  // Optimized method to process data in parallel
  async processDataInParallel(data, promptAnalysis, schemas, relationships) {
    if (!data || data.length === 0) {
      return {
        enrichedData: [],
        relatedData: {},
        insights: [],
        calculations: {},
        enhancedResults: {},
        columnTypes: {}
      };
    }
    
    console.log("Processing data with parallel operations...");
    
    // Define all processing tasks
    const tasks = [
      // Task 1: Enrich data with related information
      this.dataEnrichmentService.performRelatedQueries(data, schemas, relationships),
      
      // Task 2: Generate data insights
      this.dataEnrichmentService.analyzeDataForInsights(data),
      
      // Task 3: Perform calculations if needed
      promptAnalysis.intentClassification?.type === "analytical" ? 
        this.analyticsService.performCalculations(data, promptAnalysis.dataRequirements?.calculations) : 
        Promise.resolve({}),
      
      // Task 4: Process decisions for enhanced results
      this.analyticsService.processDecisions(promptAnalysis, data, promptAnalysis.coreQuestion),
      
      // Task 5: Get column types
      this.getColumnTypes(data)
    ];
    
    // Execute all tasks in parallel
    const [enrichmentResult, insightsResult, calculations, enhancedResults, columnTypes] = await Promise.all(tasks);
    
    return {
      enrichedData: enrichmentResult.primaryData || data,
      relatedData: enrichmentResult.relatedData || {},
      insights: insightsResult.insights || [],
      calculations,
      enhancedResults,
      columnTypes: columnTypes || {}
    };
  }

  // Add this helper method to get column types
  async getColumnTypes(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return {};
    }
    
    try {
      const columnTypes = {};
      const sampleRow = data[0];
      
      Object.keys(sampleRow).forEach(key => {
        const value = sampleRow[key];
        if (value === null || value === undefined) {
          columnTypes[key] = 'unknown';
        } else if (typeof value === 'number') {
          columnTypes[key] = 'numeric';
        } else if (typeof value === 'boolean') {
          columnTypes[key] = 'boolean';
        } else if (typeof value === 'string') {
          // Check if it's a date
          if (this.isLikelyDate(value)) {
            columnTypes[key] = 'date';
          } else {
            columnTypes[key] = 'string';
          }
        } else if (Array.isArray(value)) {
          columnTypes[key] = 'array';
        } else if (typeof value === 'object') {
          columnTypes[key] = 'object';
        } else {
          columnTypes[key] = 'unknown';
        }
      });
      
      return columnTypes;
    } catch (error) {
      console.error("Error determining column types:", error);
      return {};
    }
  }
}