import { SchemaService } from "./SchemaService.js";
import pool from "../Config/Db.js";

export class SqlGenerationService {
  constructor(mistralService) {
    this.mistralService = mistralService;
    this.schemaService = new SchemaService();
    this.queryKnowledgeBase = this.loadQueryKnowledgeBase();
  }

  // Load existing knowledge base or create a new one
  loadQueryKnowledgeBase() {
    try {
      // Try to load from a file or database
      // For now, we'll start with an empty knowledge base
      return {
        successfulQueries: [],
        queryPatterns: {},
        tableUsageStats: {},
        lastUpdated: null,
      };
    } catch (error) {
      console.warn(
        "Could not load query knowledge base, creating new one:",
        error
      );
      return {
        successfulQueries: [],
        queryPatterns: {},
        tableUsageStats: {},
        lastUpdated: null,
      };
    }
  }

  // Save the knowledge base
  async saveQueryKnowledgeBase() {
    try {
      // In a real implementation, save to a file or database
      console.log("Knowledge base updated with new learnings");
      // For now, just log the size of the knowledge base
      console.log(
        `Knowledge base contains ${this.queryKnowledgeBase.successfulQueries.length} successful queries`
      );
    } catch (error) {
      console.error("Error saving query knowledge base:", error);
    }
  }

  // Learn from a successful query
  async learnFromSuccessfulQuery(query, schema, userPrompt, resultCount) {
    try {
      // Only learn from queries that returned results
      if (resultCount <= 0) return;

      // Extract tables used in the query
      const tableMatches = query.match(/from\s+([a-z_][a-z0-9_]*)/gi);
      const tables = tableMatches
        ? tableMatches.map((match) => match.replace(/from\s+/i, "").trim())
        : [];

      // Extract join patterns
      const joinMatches = query.match(/join\s+([a-z_][a-z0-9_]*)/gi);
      const joins = joinMatches
        ? joinMatches.map((match) => match.replace(/join\s+/i, "").trim())
        : [];

      // Extract where conditions
      const whereMatch = query.match(
        /where\s+(.*?)(?:group by|order by|limit|$)/is
      );
      const whereConditions = whereMatch ? whereMatch[1].trim() : "";

      // Create a query pattern object
      const queryPattern = {
        query,
        userPrompt,
        tables,
        joins,
        whereConditions,
        resultCount,
        timestamp: new Date().toISOString(),
      };

      // Add to successful queries
      this.queryKnowledgeBase.successfulQueries.push(queryPattern);

      // Update table usage statistics
      tables.forEach((table) => {
        if (!this.queryKnowledgeBase.tableUsageStats[table]) {
          this.queryKnowledgeBase.tableUsageStats[table] = 0;
        }
        this.queryKnowledgeBase.tableUsageStats[table]++;
      });

      // Update last updated timestamp
      this.queryKnowledgeBase.lastUpdated = new Date().toISOString();

      // Save the updated knowledge base
      await this.saveQueryKnowledgeBase();

      console.log(
        `Learned from successful query that returned ${resultCount} results`
      );
    } catch (error) {
      console.error("Error learning from successful query:", error);
    }
  }

  // Find similar queries in the knowledge base
  findSimilarQueries(userPrompt) {
    // Simple similarity based on word overlap for now
    const promptWords = new Set(
      userPrompt
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2)
    );

    return this.queryKnowledgeBase.successfulQueries
      .map((entry) => {
        const entryWords = new Set(
          entry.userPrompt
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 2)
        );
        let overlap = 0;

        promptWords.forEach((word) => {
          if (entryWords.has(word)) overlap++;
        });

        const similarity =
          overlap / Math.max(promptWords.size, entryWords.size);

        return {
          ...entry,
          similarity,
        };
      })
      .filter((entry) => entry.similarity > 0.3) // Only consider entries with some similarity
      .sort((a, b) => b.similarity - a.similarity) // Sort by similarity (descending)
      .slice(0, 3); // Take top 3 matches
  }

  // Calculate text similarity (word overlap method)
  calculateTextSimilarity(text1, text2) {
    const words1 = new Set(
      text1
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2)
    );
    const words2 = new Set(
      text2
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2)
    );

    let overlap = 0;
    words1.forEach((word) => {
      if (words2.has(word)) overlap++;
    });

    return overlap / Math.max(words1.size, words2.size);
  }

  // Use learned knowledge to enhance SQL generation
  async enhanceSqlGenerationWithKnowledge(userPrompt, schema) {
    try {
      // Check if this is an "all data" request
      const isAllDataRequest = this.detectAllDataRequest(userPrompt);

      // Find similar queries in our knowledge base
      const similarQueries = this.findSimilarQueries(userPrompt);

      if (similarQueries.length > 0) {
        // Use the most similar query as a template
        const bestMatch = similarQueries[0];

        // Check if the tables in the best match are in the current schema
        const tablesInQuery = this.extractTablesFromQuery(bestMatch.query);
        const tablesInSchema = Object.keys(schema.tables || {}).map((t) =>
          t.toLowerCase()
        );

        const allTablesExist = tablesInQuery.every((table) =>
          tablesInSchema.includes(table.toLowerCase())
        );

        if (!allTablesExist) {
          console.log(
            "Tables in best match query don't match current schema, generating new query"
          );
          return null;
        }

        // Modify the SQL based on the current request
        let modifiedSql = bestMatch.query;

        // If this is an "all data" request, remove any LIMIT clause
        if (isAllDataRequest && /LIMIT\s+\d+/i.test(modifiedSql)) {
          modifiedSql = modifiedSql.replace(/LIMIT\s+\d+/i, "");
        }
        // If this is NOT an "all data" request but there's no LIMIT, add one
        else if (!isAllDataRequest && !/LIMIT\s+\d+/i.test(modifiedSql)) {
          modifiedSql += " LIMIT 100";
        }

        return modifiedSql;
      }

      return null;
    } catch (error) {
      console.error("Error enhancing SQL with knowledge:", error);
      return null;
    }
  }

  // Helper to identify relevant tables from the query
  async identifyRelevantTables(userPrompt, schemas) {
    const tableIdentificationPrompt = `
            Given this user request: "${userPrompt}"
            And these table names: ${Object.keys(schemas).join(", ")}
            
            Analyze the request carefully to determine which tables are most relevant.
            Consider:
            1. Direct mentions of table names or their singular/plural forms
            2. References to data that would be stored in specific tables
            3. The relationships between tables that might be needed to fulfill the request
            
            Return only the names of tables that are relevant to this query, as a comma-separated list.
            Be thorough - include all tables that might be needed to properly answer the query.
            Do not include any additional text or formatting.
        `;

    const relevantTablesStr = await this.mistralService.generateMistralResponse(
      tableIdentificationPrompt
    );
    return relevantTablesStr
      .replace(/```.*?\n?/g, "") // Remove any markdown
      .split(",")
      .map((table) => table.trim().toLowerCase())
      .filter((table) => table && schemas[table]); // Only include tables that exist in the schema
  }

  // Helper to create a minimal schema representation
  createMinimalSchema(schemas, relationships, relevantTables) {
    const minimalSchema = {};

    // Only include relevant tables
    relevantTables.forEach((tableName) => {
      if (schemas[tableName]) {
        // Include only essential column information
        minimalSchema[tableName] = {
          columns: schemas[tableName].columns.map((col) => ({
            name: col.column_name,
            type: col.data_type,
          })),
        };
      }
    });

    // Only include relationships between relevant tables
    const relevantRelationships = relationships.filter(
      (rel) =>
        relevantTables.includes(rel.table_name.toLowerCase()) &&
        relevantTables.includes(rel.foreign_table_name.toLowerCase())
    );

    return {
      tables: minimalSchema,
      relationships: relevantRelationships,
    };
  }

  // Clean SQL response from markdown and other formatting
  cleanSQLResponse(response) {
    try {
      if (!response) return "";

      // Extract SQL from the response
      let sql = response;

      // Remove markdown code blocks if present
      sql = sql.replace(/```sql/g, "").replace(/```/g, "");

      // Remove any explanatory text before or after the SQL
      const sqlRegex = /(SELECT|WITH|INSERT|UPDATE|DELETE)[\s\S]*/i;
      const match = sql.match(sqlRegex);

      if (match) {
        sql = match[0];
      } else {
        // If no SQL statement found, check if this is a description or explanation
        // and return a default SELECT statement
        console.warn("No valid SQL found in response, using default query");
        return "SELECT * FROM users LIMIT 10";
      }

      // Clean up whitespace
      sql = sql.trim();

      return sql;
    } catch (error) {
      console.error("Error cleaning SQL response:", error);
      return "SELECT * FROM users LIMIT 10"; // Return a safe default
    }
  }

  // Add a SQL validation function to check for common issues before executing
  async validateSql(sql) {
    try {
      // Check for basic syntax issues first
      if (!sql || typeof sql !== "string" || sql.trim() === "") {
        console.error("Invalid SQL query provided for validation");
        return "SELECT 1"; // Return a safe default query
      }

      // Identify potential issues
      const issues = [];

      // Check for unqualified column names that might be ambiguous
      const potentialAmbiguousColumns = sql.match(
        /SELECT\s+(?:.*?,\s*)?(\w+)(?:\s*,|\s*FROM)/gi
      );
      if (potentialAmbiguousColumns) {
        issues.push("ambiguous_columns");
      }

      // Check for UNION queries with potential column mismatches
      if (sql.includes("UNION")) {
        const unionParts = sql.split(/UNION\s+(?:ALL\s+)?/i);
        if (unionParts.length > 1) {
          issues.push("union_mismatch");
        }
      }

      // Check for potential table alias issues
      const tableAliases = [];
      const aliasMatches = sql.match(
        /(?:FROM|JOIN)\s+(\w+)(?:\s+AS)?\s+(\w+)/gi
      );

      if (aliasMatches) {
        aliasMatches.forEach((match) => {
          const parts = match.split(/\s+/);
          // Extract table name and alias
          let tableName, alias;

          if (parts.length >= 4 && parts[2].toLowerCase() === "as") {
            // Format: FROM/JOIN table_name AS alias
            tableName = parts[1];
            alias = parts[3];
          } else if (parts.length >= 3) {
            // Format: FROM/JOIN table_name alias
            tableName = parts[1];
            alias = parts[2];
          }

          if (tableName && alias) {
            tableAliases.push({ table: tableName, alias: alias });
          }
        });
      }

      // Check for references to aliases that don't exist
      const columnRefs = sql.match(/(\w+)\.(\w+)/g);
      if (columnRefs) {
        columnRefs.forEach((ref) => {
          const [alias] = ref.split(".");
          if (
            !tableAliases.some(
              (a) => a.alias.toLowerCase() === alias.toLowerCase()
            )
          ) {
            issues.push(`invalid_alias:${alias}`);
          }
        });
      }

      // If we found issues, generate a fixed SQL query
      if (issues.length > 0) {
        console.log(`SQL validation found issues: ${issues.join(", ")}`);

        // Create a comprehensive fix prompt based on identified issues
        let fixPrompt = `
                    This SQL query has the following issues that need to be fixed:
                    
                    ${sql}
                    
                    ISSUES:
                `;

        if (issues.includes("ambiguous_columns")) {
          fixPrompt +=
            "\n- Ambiguous column references that need table aliases";
        }

        if (issues.includes("union_mismatch")) {
          fixPrompt +=
            "\n- UNION statements with potentially mismatched columns";
        }

        issues.forEach((issue) => {
          if (issue.startsWith("invalid_alias:")) {
            const alias = issue.split(":")[1];
            fixPrompt += `\n- Invalid table alias "${alias}" that doesn't match any defined table alias`;
          }
        });

        fixPrompt += `
                    
                    Please fix the query by:
                    1. Ensuring all table aliases are properly defined in FROM/JOIN clauses
                    2. Using only defined table aliases in column references
                    3. Adding table aliases to ALL column references to avoid ambiguity
                    4. Checking for typos in table and alias names
                    5. Making sure all tables referenced in column qualifiers (e.g., "oy.port_id") are properly defined
                    
                    Available table aliases from the query:
                    ${tableAliases
                      .map((a) => `${a.table} AS ${a.alias}`)
                      .join("\n")}
                    
                    Return ONLY the fixed SQL query without any explanations.
                `;

        // Generate fixed SQL
        const fixedSql = await this.mistralService.generateMistralResponse(fixPrompt);

        const cleanFixedSql = fixedSql
          .trim()
          .replace(/```sql|```/g, "")
          .trim();
        console.log("Original SQL:", sql);
        console.log("Fixed SQL:", cleanFixedSql);

        return cleanFixedSql;
      }

      // If no issues found, return the original SQL
      return sql;
    } catch (error) {
      console.error("Error validating SQL:", error);
      // Return the original SQL if validation fails
      return sql;
    }
  }

  // Add a method to detect if the user is requesting all data
  detectAllDataRequest(userPrompt) {
    const allDataPatterns = [
      /show\s+all\s+data/i,
      /fetch\s+all\s+data/i,
      /get\s+all\s+data/i,
      /retrieve\s+all\s+data/i,
      /return\s+all\s+data/i,
      /display\s+all\s+data/i,
      /all\s+records/i,
      /complete\s+dataset/i,
      /full\s+dataset/i,
      /entire\s+dataset/i,
      /no\s+limit/i,
      /without\s+limit/i,
    ];

    return allDataPatterns.some((pattern) => pattern.test(userPrompt));
  }

  // Helper method to extract tables from a SQL query
  extractTablesFromQuery(query) {
    if (!query) return [];

    const tableMatches = query.match(/from\s+([a-z_][a-z0-9_]*)/gi) || [];
    const joinMatches = query.match(/join\s+([a-z_][a-z0-9_]*)/gi) || [];

    const tables = tableMatches.map((match) =>
      match.replace(/from\s+/i, "").trim()
    );
    const joins = joinMatches.map((match) =>
      match.replace(/join\s+/i, "").trim()
    );

    return [...new Set([...tables, ...joins])];
  }

  // Add a new method to generate additional queries based on user requirements
  async generateAdditionalQueries(userPrompt, schema, queryDescription) {
    try {
      if (!queryDescription) {
        return [];
      }

      console.log("Generating additional queries based on:", queryDescription);

      const additionalQueriesPrompt = `
        Based on this user request: "${userPrompt}"
        
        We need additional data described as: "${queryDescription}"
        
        Using this schema: ${JSON.stringify(schema, null, 2)}
        
        Generate up to 3 SQL queries that would provide the additional data needed.
        Format each query as a JSON object with "description" and "sql" fields.
        Return an array of these objects.
        
        IMPORTANT: Each SQL query MUST start with SELECT or WITH.
      `;

      const response = await this.mistralService.generateMistralResponse(
        additionalQueriesPrompt
      );

      try {
        // Try to parse the response as JSON
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsedQueries = JSON.parse(jsonMatch[0]);
          
          // Validate each query
          const validQueries = parsedQueries.map(query => {
            if (!query.sql || !query.sql.trim().match(/^(SELECT|WITH)/i)) {
              // Fix invalid SQL
              return {
                description: query.description || queryDescription,
                sql: `SELECT * FROM users LIMIT 10 -- Placeholder for: ${query.description}`
              };
            }
            return query;
          });
          
          return validQueries;
        }

        // If not a valid JSON array, create a simple structure with a default query
        return [
          {
            description: queryDescription,
            sql: "SELECT * FROM users LIMIT 10"
          },
        ];
      } catch (error) {
        console.warn("Error parsing additional queries:", error);
        return [
          {
            description: queryDescription,
            sql: "SELECT * FROM users LIMIT 10"
          },
        ];
      }
    } catch (error) {
      console.error("Error generating additional queries:", error);
      return [];
    }
  }
} 