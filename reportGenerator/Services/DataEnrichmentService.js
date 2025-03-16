import pool from "../Config/Db.js";
import pkg from "danfojs-node";
const { dfd } = pkg;

export class DataEnrichmentService {
  constructor() {
    // Initialize any required properties
  }

  // Add a new method to perform multiple related queries
  async performRelatedQueries(primaryData, schema, relationships) {
    try {
      if (!primaryData || primaryData.length === 0) {
        return { primaryData, relatedData: {} };
      }

      console.log("Performing related queries to enrich data...");
      const relatedData = {};
      const processedRelationships = [];

      // Identify foreign keys in the primary data
      const foreignKeyColumns = this.identifyForeignKeys(
        primaryData[0],
        relationships
      );

      // For each foreign key, fetch the related data
      for (const fkInfo of foreignKeyColumns) {
        // Skip if we've already processed this relationship
        if (
          processedRelationships.includes(`${fkInfo.table}_${fkInfo.column}`)
        ) {
          continue;
        }

        // Get unique foreign key values from primary data
        const fkValues = [
          ...new Set(
            primaryData
              .map((row) => row[fkInfo.column])
              .filter((val) => val !== null && val !== undefined)
          ),
        ];

        if (fkValues.length === 0) continue;

        // Build query to fetch related data
        const relatedQuery = `
          SELECT * FROM ${fkInfo.referencedTable}
          WHERE ${fkInfo.referencedColumn} IN (${fkValues
          .map((v) => (typeof v === "string" ? `'${v}'` : v))
          .join(",")})
          LIMIT 1000
        `;

        try {
          const result = await pool.query(relatedQuery);
          if (result.rows.length > 0) {
            relatedData[fkInfo.referencedTable] = result.rows;
            processedRelationships.push(`${fkInfo.table}_${fkInfo.column}`);

            console.log(
              `Fetched ${result.rows.length} related records from ${fkInfo.referencedTable}`
            );
          }
        } catch (error) {
          console.warn(
            `Error fetching related data for ${fkInfo.referencedTable}:`,
            error
          );
        }
      }

      return { primaryData, relatedData };
    } catch (error) {
      console.error("Error performing related queries:", error);
      return { primaryData, relatedData: {} };
    }
  }

  // Helper method to identify foreign keys in data
  identifyForeignKeys(sampleRow, relationships) {
    if (!sampleRow || !relationships || !Array.isArray(relationships)) {
      return [];
    }

    const foreignKeys = [];
    const columns = Object.keys(sampleRow);

    // Look for columns that might be foreign keys based on naming convention
    const potentialFkColumns = columns.filter(
      (col) =>
        col.endsWith("_id") ||
        col.endsWith("Id") ||
        col === "id" ||
        relationships.some(
          (rel) => rel.column_name === col || rel.foreign_column_name === col
        )
    );

    // Match with relationship information
    for (const col of potentialFkColumns) {
      // Find matching relationship
      const matchingRel = relationships.find(
        (rel) => rel.column_name === col || rel.foreign_column_name === col
      );

      if (matchingRel) {
        foreignKeys.push({
          table: matchingRel.table_name,
          column: col,
          referencedTable: matchingRel.foreign_table_name,
          referencedColumn: matchingRel.foreign_column_name,
        });
      } else if (col.endsWith("_id") || col.endsWith("Id")) {
        // Make an educated guess for the referenced table
        const guessedTable = col.replace(/_id$/i, "").replace(/Id$/i, "");
        foreignKeys.push({
          table: "", // We don't know the current table name
          column: col,
          referencedTable: guessedTable,
          referencedColumn: "id", // Assume primary key is 'id'
        });
      }
    }

    return foreignKeys;
  }

  // Add a new method to replace IDs with meaningful values
  async enrichDataWithRelatedInfo(primaryData, relatedData) {
    if (
      !primaryData ||
      primaryData.length === 0 ||
      !relatedData ||
      Object.keys(relatedData).length === 0
    ) {
      return primaryData;
    }

    console.log("Enriching data by replacing IDs with meaningful values...");

    // Create a deep copy of the primary data
    const enrichedData = JSON.parse(JSON.stringify(primaryData));

    // For each row in the primary data
    for (let i = 0; i < enrichedData.length; i++) {
      const row = enrichedData[i];

      // Look for columns that might be foreign keys
      for (const column of Object.keys(row)) {
        if (column.endsWith("_id") || column.endsWith("Id")) {
          const fkValue = row[column];
          if (fkValue === null || fkValue === undefined) continue;

          // Determine the likely referenced table
          const baseColumnName = column
            .replace(/_id$/i, "")
            .replace(/Id$/i, "");
          const possibleTableNames = [
            baseColumnName,
            baseColumnName + "s",
            baseColumnName + "es",
            baseColumnName.replace(/y$/, "ies"),
          ];

          // Look for matching related data
          for (const tableName of Object.keys(relatedData)) {
            if (possibleTableNames.includes(tableName.toLowerCase())) {
              // Find the matching record
              const relatedRecord = relatedData[tableName].find(
                (r) => r.id === fkValue || r[column] === fkValue
              );

              if (relatedRecord) {
                // Find the best descriptive field in the related record
                const descriptiveField =
                  this.findDescriptiveField(relatedRecord);

                if (descriptiveField) {
                  // Add a new field with the descriptive value
                  const newFieldName = baseColumnName + "_name";
                  row[newFieldName] = relatedRecord[descriptiveField];
                }
              }
            }
          }
        }
      }
    }

    return enrichedData;
  }

  // Helper to find the most descriptive field in a record
  findDescriptiveField(record) {
    // Priority order for descriptive fields
    const priorityFields = [
      "name",
      "title",
      "label",
      "description",
      "code",
      "username",
      "email",
    ];

    for (const field of priorityFields) {
      if (
        record[field] &&
        typeof record[field] === "string" &&
        record[field].trim() !== ""
      ) {
        return field;
      }
    }

    // If no priority field found, look for any string field that's not an ID
    for (const [key, value] of Object.entries(record)) {
      if (
        !key.endsWith("_id") &&
        !key.endsWith("Id") &&
        key !== "id" &&
        typeof value === "string" &&
        value.trim() !== ""
      ) {
        return key;
      }
    }

    return null;
  }

  // Add a safe wrapper for Danfo.js operations
  async formatDataWithDanfo(data) {
    try {
      console.log("Formatting data with Danfo.js...");
      
      // Check if dfd is properly initialized
      if (!dfd || typeof dfd.DataFrame !== 'function') {
        console.warn("Danfo.js not properly initialized, using fallback formatting");
        return { 
          formattedData: data, 
          insights: [] 
        };
      }
      
      // Ensure data is valid for Danfo
      if (!Array.isArray(data) || data.length === 0) {
        return { 
          formattedData: data, 
          insights: [] 
        };
      }
      
      // Create DataFrame safely
      let df;
      try {
        df = new dfd.DataFrame(data);
      } catch (dfError) {
        console.warn("Error creating DataFrame:", dfError);
        return { 
          formattedData: data, 
          insights: [] 
        };
      }
      
      // Get summary statistics
      const summary = df.describe().toJSON();

      // Format date columns
      const columns = Object.keys(data[0]);
      const dateColumns = columns.filter((col) => {
        // Check if column might contain dates
        const sample = data[0][col];
        return (
          typeof sample === "string" &&
          (sample.match(/^\d{4}-\d{2}-\d{2}/) ||
            sample.match(/^\d{2}\/\d{2}\/\d{4}/))
        );
      });

      // Create a copy of the data for formatting
      const formattedData = JSON.parse(JSON.stringify(data));

      // Format date columns
      for (const row of formattedData) {
        for (const col of dateColumns) {
          if (row[col]) {
            try {
              const date = new Date(row[col]);
              if (!isNaN(date.getTime())) {
                row[col] = date.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                });
              }
            } catch (e) {
              // Keep original if formatting fails
            }
          }
        }
      }

      // Format numeric columns
      const numericColumns = columns.filter((col) => {
        return data.some((row) => {
          const val = row[col];
          return (
            typeof val === "number" ||
            (typeof val === "string" && !isNaN(parseFloat(val)))
          );
        });
      });

      for (const row of formattedData) {
        for (const col of numericColumns) {
          if (row[col] !== null && row[col] !== undefined) {
            const num = parseFloat(row[col]);
            if (!isNaN(num)) {
              // Format currency-like columns
              if (
                col.includes("price") ||
                col.includes("cost") ||
                col.includes("amount") ||
                col.includes("total")
              ) {
                row[col] = new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(num);
              }
              // Format percentage-like columns
              else if (col.includes("percent") || col.includes("rate")) {
                row[col] = new Intl.NumberFormat("en-US", {
                  style: "percent",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(num / 100);
              }
              // Format other numeric columns
              else if (Number.isInteger(num)) {
                row[col] = new Intl.NumberFormat("en-US").format(num);
              } else {
                row[col] = new Intl.NumberFormat("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(num);
              }
            }
          }
        }
      }

      // Generate additional insights using Danfo.js
      const insights = {};

      // Calculate correlations if we have numeric columns
      if (numericColumns.length >= 2) {
        try {
          insights.correlations = df.corr().toJSON();
        } catch (e) {
          console.warn("Error calculating correlations:", e);
        }
      }

      // Group by analysis for categorical columns
      const categoricalColumns = columns.filter(
        (col) =>
          !numericColumns.includes(col) &&
          !dateColumns.includes(col) &&
          data.some((row) => row[col] !== null && row[col] !== undefined)
      );

      insights.groupBy = {};
      for (const col of categoricalColumns) {
        try {
          const grouped = df.groupby([col]);
          const counts = grouped.count().toJSON();
          if (counts && Object.keys(counts).length > 0) {
            insights.groupBy[col] = counts;
          }
        } catch (e) {
          console.warn(`Error grouping by ${col}:`, e);
        }
      }

      return {
        formattedData: data,
        insights: { summary: summary },
      };
    } catch (error) {
      console.error("Error formatting data with Danfo.js:", error);
      // Return original data as fallback
      return {
        formattedData: data,
        insights: []
      };
    }
  }

  // Add a method to ensure data consistency and accuracy
  async ensureDataConsistency(data, schema) {
    try {
      if (!data || !Array.isArray(data) || data.length === 0) {
        console.warn("No data to ensure consistency for");
        return { data: [], metadata: {} };
      }

      console.log("Ensuring data consistency and accuracy...");

      // Create a deep copy of the data
      const consistentData = JSON.parse(JSON.stringify(data));

      // Get column names
      const columns = Object.keys(consistentData[0]);

      // Create a column type map to ensure consistent types
      const columnTypes = {};
      const columnFormats = {};

      // First pass: determine the most likely type for each column
      for (const column of columns) {
        // Skip columns that are already processed (like _name fields)
        if (column.endsWith("_name") || column.endsWith("Name")) continue;

        // Count occurrences of each type
        const typeCounts = {
          number: 0,
          string: 0,
          boolean: 0,
          date: 0,
          null: 0,
        };

        // Check if this might be a date column by name
        const mightBeDate =
          column.toLowerCase().includes("date") ||
          column.toLowerCase().includes("time") ||
          column.toLowerCase().includes("created") ||
          column.toLowerCase().includes("updated");

        // Sample values to determine type
        for (const row of consistentData) {
          const value = row[column];

          if (value === null || value === undefined) {
            typeCounts.null++;
          } else if (typeof value === "number") {
            typeCounts.number++;
          } else if (typeof value === "boolean") {
            typeCounts.boolean++;
          } else if (typeof value === "string") {
            // Check if string might be a date
            if (
              mightBeDate &&
              (value.match(/^\d{4}-\d{2}-\d{2}/) ||
                value.match(/^\d{2}\/\d{2}\/\d{4}/))
            ) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) {
                typeCounts.date++;
              } else {
                typeCounts.string++;
              }
            }
            // Check if string might be a number
            else if (!isNaN(parseFloat(value)) && value.trim() !== "") {
              typeCounts.number++;
            } else {
              typeCounts.string++;
            }
          }
        }

        // Determine the most common type (excluding nulls)
        let mostCommonType = "string"; // Default to string
        let maxCount = 0;

        for (const [type, count] of Object.entries(typeCounts)) {
          if (type !== "null" && count > maxCount) {
            maxCount = count;
            mostCommonType = type;
          }
        }

        // Store the determined type
        columnTypes[column] = mostCommonType;

        // Determine appropriate format for the column
        if (mostCommonType === "number") {
          // Check if it might be currency
          if (
            column.toLowerCase().includes("price") ||
            column.toLowerCase().includes("cost") ||
            column.toLowerCase().includes("amount") ||
            column.toLowerCase().includes("total")
          ) {
            columnFormats[column] = "currency";
          }
          // Check if it might be percentage
          else if (
            column.toLowerCase().includes("percent") ||
            column.toLowerCase().includes("rate")
          ) {
            columnFormats[column] = "percent";
          }
          // Check if it's likely an integer
          else {
            let isInteger = true;
            for (const row of consistentData) {
              const value = row[column];
              if (
                value !== null &&
                value !== undefined &&
                typeof value !== "string" &&
                !Number.isInteger(parseFloat(value))
              ) {
                isInteger = false;
                break;
              }
            }
            columnFormats[column] = isInteger ? "integer" : "decimal";
          }
        } else if (mostCommonType === "date") {
          columnFormats[column] = "date";
        }
      }

      // Add metadata about the columns for better reporting
      const columnMetadata = {};
      for (const column of columns) {
        columnMetadata[column] = {
          type: columnTypes[column] || "string",
          format: columnFormats[column] || "text",
          isId:
            column.endsWith("_id") || column.endsWith("Id") || column === "id",
          isName: column.endsWith("_name") || column.endsWith("Name"),
          displayName: column
            .replace(/_/g, " ")
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (str) => str.toUpperCase())
            .trim(),
        };
      }

      return {
        data: consistentData,
        metadata: columnMetadata,
      };
    } catch (error) {
      console.error("Error ensuring data consistency:", error);
      return {
        data: Array.isArray(data) ? data : [],
        metadata: {},
      };
    }
  }

  // Generate consistent table structure for reports
  generateConsistentTableStructure(data, metadata) {
    try {
      if (!data || data.length === 0) {
        return { tableData: [], tableStructure: {} };
      }

      // Create a table structure definition
      const tableStructure = {
        columns: [],
        primaryKey: null,
        displayColumns: [],
        summaryColumns: [],
        groupableColumns: [],
        sortableColumns: [],
      };

      // Identify the primary key (usually 'id')
      const idColumn = Object.keys(metadata).find((col) => col === "id");
      if (idColumn) {
        tableStructure.primaryKey = idColumn;
      }

      // Process each column
      for (const [column, info] of Object.entries(metadata)) {
        // Add to columns list
        tableStructure.columns.push({
          name: column,
          displayName: info.displayName,
          type: info.type,
          format: info.format,
        });

        // Skip ID columns for display unless they're the only columns
        if (!info.isId || Object.keys(metadata).length <= 3) {
          tableStructure.displayColumns.push(column);
        }

        // Add numeric columns to summary columns
        if (info.type === "number") {
          tableStructure.summaryColumns.push(column);
        }

        // Add categorical columns to groupable columns
        if (info.type === "string" || info.type === "boolean") {
          tableStructure.groupableColumns.push(column);
        }

        // All columns are sortable
        tableStructure.sortableColumns.push(column);
      }

      // Sort display columns to put names first, then other fields, then IDs last
      tableStructure.displayColumns.sort((a, b) => {
        const aInfo = metadata[a];
        const bInfo = metadata[b];

        // Names first
        if (aInfo.isName && !bInfo.isName) return -1;
        if (!aInfo.isName && bInfo.isName) return 1;

        // IDs last
        if (aInfo.isId && !bInfo.isId) return 1;
        if (!aInfo.isId && bInfo.isId) return -1;

        // Otherwise alphabetical
        return a.localeCompare(b);
      });

      // Limit display columns to a reasonable number (max 10)
      if (tableStructure.displayColumns.length > 10) {
        tableStructure.displayColumns = tableStructure.displayColumns.slice(
          0,
          10
        );
      }

      return {
        tableData: data,
        tableStructure,
      };
    } catch (error) {
      console.error("Error generating table structure:", error);
      return { tableData: data, tableStructure: {} };
    }
  }

  // Add an enhanced method for resolving nested foreign key relationships
  async resolveNestedForeignKeys(primaryData, schema, relationships) {
    try {
      if (
        !primaryData ||
        !Array.isArray(primaryData) ||
        primaryData.length === 0
      ) {
        console.warn("No primary data to resolve foreign keys for");
        return [];
      }

      console.log("Resolving nested foreign key relationships...");

      // Create a deep copy of the primary data
      const enrichedData = JSON.parse(JSON.stringify(primaryData));

      // Build a relationship map for faster lookups
      const relationshipMap = {};
      if (Array.isArray(relationships)) {
        relationships.forEach((rel) => {
          if (!relationshipMap[rel.table_name]) {
            relationshipMap[rel.table_name] = [];
          }
          relationshipMap[rel.table_name].push({
            sourceColumn: rel.column_name,
            targetTable: rel.foreign_table_name,
            targetColumn: rel.foreign_column_name,
          });
        });
      }

      // Identify all potential foreign key columns
      const sampleRow = enrichedData[0];
      const potentialFkColumns = Object.keys(sampleRow).filter(
        (col) =>
          col.endsWith("_id") ||
          col.endsWith("Id") ||
          col === "id" ||
          col.toLowerCase().includes("id")
      );

      // Process each potential foreign key
      for (const column of potentialFkColumns) {
        // Skip if column is empty in all rows
        const hasValues = enrichedData.some(
          (row) => row[column] !== null && row[column] !== undefined
        );

        if (!hasValues) continue;

        // Extract unique values for this column
        const uniqueValues = [
          ...new Set(
            enrichedData
              .map((row) => row[column])
              .filter((val) => val !== null && val !== undefined)
          ),
        ];

        if (uniqueValues.length === 0) continue;

        // Determine the likely referenced table
        let referencedTable = null;
        let referencedColumn = "id";

        // Try to find from relationship map first
        const tableNames = Object.keys(relationshipMap);
        for (const tableName of tableNames) {
          const tableRelationships = relationshipMap[tableName];
          const matchingRel = tableRelationships.find(
            (rel) => rel.sourceColumn === column
          );

          if (matchingRel) {
            referencedTable = matchingRel.targetTable;
            referencedColumn = matchingRel.targetColumn;
            break;
          }
        }

        // If not found in relationships, make an educated guess
        if (!referencedTable) {
          // Try to guess the table name from the column name
          const baseColumnName = column
            .replace(/_id$/i, "")
            .replace(/Id$/i, "")
            .replace(/([A-Z])/g, "_$1")
            .toLowerCase()
            .replace(/^_/, "");

          // Check for common plural forms
          const possibleTableNames = [
            baseColumnName,
            baseColumnName + "s",
            baseColumnName + "es",
            baseColumnName.replace(/y$/, "ies"),
            // Handle special cases like "lineId" -> "lines"
            baseColumnName === "line" ? "lines" : null,
          ].filter(Boolean);

          // Check if any of these tables exist in the schema
          if (schema && schema.tables) {
            for (const possibleName of possibleTableNames) {
              if (schema.tables[possibleName]) {
                referencedTable = possibleName;
                break;
              }
            }
          }
        }

        // If we found a referenced table, fetch the data
        if (referencedTable) {
          try {
            // Build query to fetch related data
            const query = `
              SELECT * FROM ${referencedTable}
              WHERE ${referencedColumn} IN (${uniqueValues
              .map((v) => (typeof v === "string" ? `'${v}'` : v))
              .join(",")})
              LIMIT 1000
            `;

            const result = await pool.query(query);

            if (result.rows.length > 0) {
              console.log(
                `Fetched ${result.rows.length} records from ${referencedTable} for column ${column}`
              );

              // Find the best descriptive field
              const descriptiveField = this.findDescriptiveField(
                result.rows[0]
              );

              if (descriptiveField) {
                // Create a lookup map for quick access
                const lookupMap = {};
                result.rows.forEach((row) => {
                  lookupMap[row[referencedColumn]] = row[descriptiveField];
                });

                // Add descriptive values to each row in the primary data
                const newFieldName = column
                  .replace(/_id$/i, "_name")
                  .replace(/Id$/i, "Name");

                enrichedData.forEach((row) => {
                  const fkValue = row[column];
                  if (
                    fkValue !== null &&
                    fkValue !== undefined &&
                    lookupMap[fkValue]
                  ) {
                    row[newFieldName] = lookupMap[fkValue];
                  }
                });
              }
            }
          } catch (error) {
            console.warn(
              `Error fetching related data for ${referencedTable}:`,
              error
            );
          }
        }
      }

      return enrichedData;
    } catch (error) {
      console.error("Error resolving nested foreign keys:", error);
      return primaryData;
    }
  }

  // Add this method to perform batch queries for better performance
  async performBatchQueries(queries) {
    try {
      if (!queries || queries.length === 0) {
        return [];
      }
      
      console.log(`Performing ${queries.length} batch queries...`);
      
      // Use Promise.all to execute queries in parallel
      const results = await Promise.all(
        queries.map(async (query) => {
          try {
            const result = await pool.query(query.sql);
            return {
              id: query.id,
              success: true,
              rows: result.rows,
              rowCount: result.rowCount
            };
          } catch (error) {
            console.warn(`Error executing batch query ${query.id}:`, error);
            return {
              id: query.id,
              success: false,
              error: error.message
            };
          }
        })
      );
      
      console.log(`Completed ${results.filter(r => r.success).length} of ${queries.length} batch queries`);
      return results;
    } catch (error) {
      console.error("Error performing batch queries:", error);
      return [];
    }
  }

  // Add this method to the DataEnrichmentService class
  async buildRelationshipGraph(schema, relationships) {
    try {
      console.log("Building relationship graph...");
      
      // Create a graph representation of table relationships
      const relationshipGraph = {
        tables: {},
        directRelationships: {},
        inverseRelationships: {},
        pathCache: {}
      };
      
      // Initialize tables
      if (schema && schema.tables) {
        Object.keys(schema.tables).forEach(tableName => {
          relationshipGraph.tables[tableName] = {
            name: tableName,
            columns: schema.tables[tableName].columns.map(col => col.column_name)
          };
          relationshipGraph.directRelationships[tableName] = [];
          relationshipGraph.inverseRelationships[tableName] = [];
        });
      }
      
      // Add relationships to the graph
      if (Array.isArray(relationships)) {
        relationships.forEach(rel => {
          // Add direct relationship (table -> foreign_table)
          if (!relationshipGraph.directRelationships[rel.table_name]) {
            relationshipGraph.directRelationships[rel.table_name] = [];
          }
          relationshipGraph.directRelationships[rel.table_name].push({
            sourceTable: rel.table_name,
            sourceColumn: rel.column_name,
            targetTable: rel.foreign_table_name,
            targetColumn: rel.foreign_column_name
          });
          
          // Add inverse relationship (foreign_table -> table)
          if (!relationshipGraph.inverseRelationships[rel.foreign_table_name]) {
            relationshipGraph.inverseRelationships[rel.foreign_table_name] = [];
          }
          relationshipGraph.inverseRelationships[rel.foreign_table_name].push({
            sourceTable: rel.foreign_table_name,
            sourceColumn: rel.foreign_column_name,
            targetTable: rel.table_name,
            targetColumn: rel.column_name
          });
        });
      }
      
      return relationshipGraph;
    } catch (error) {
      console.error("Error building relationship graph:", error);
      return {
        tables: {},
        directRelationships: {},
        inverseRelationships: {},
        pathCache: {}
      };
    }
  }

  // Add this method to find paths between tables
  findRelationshipPaths(graph, sourceTable, targetTable, maxDepth = 3) {
    // Check if we've already computed this path
    const cacheKey = `${sourceTable}-${targetTable}-${maxDepth}`;
    if (graph.pathCache[cacheKey]) {
      return graph.pathCache[cacheKey];
    }
    
    // Initialize paths
    const paths = [];
    
    // Helper function for DFS
    const dfs = (currentTable, targetTable, currentPath, visited, depth) => {
      // Base case: reached max depth
      if (depth > maxDepth) return;
      
      // Base case: found target
      if (currentTable === targetTable) {
        paths.push([...currentPath]);
        return;
      }
      
      // Mark as visited
      visited.add(currentTable);
      
      // Explore direct relationships
      const directRelationships = graph.directRelationships[currentTable] || [];
      for (const rel of directRelationships) {
        const nextTable = rel.targetTable;
        if (!visited.has(nextTable)) {
          currentPath.push({
            type: 'direct',
            sourceTable: rel.sourceTable,
            sourceColumn: rel.sourceColumn,
            targetTable: rel.targetTable,
            targetColumn: rel.targetColumn
          });
          dfs(nextTable, targetTable, currentPath, new Set(visited), depth + 1);
          currentPath.pop();
        }
      }
      
      // Explore inverse relationships
      const inverseRelationships = graph.inverseRelationships[currentTable] || [];
      for (const rel of inverseRelationships) {
        const nextTable = rel.targetTable;
        if (!visited.has(nextTable)) {
          currentPath.push({
            type: 'inverse',
            sourceTable: rel.sourceTable,
            sourceColumn: rel.sourceColumn,
            targetTable: rel.targetTable,
            targetColumn: rel.targetColumn
          });
          dfs(nextTable, targetTable, currentPath, new Set(visited), depth + 1);
          currentPath.pop();
        }
      }
    };
    
    // Start DFS
    dfs(sourceTable, targetTable, [], new Set(), 0);
    
    // Cache the result
    graph.pathCache[cacheKey] = paths;
    
    return paths;
  }

  // Add this method to resolve multi-level relationships
  async resolveMultiLevelRelationships(data, schema, relationships) {
    try {
      if (!data || data.length === 0) {
        return data;
      }
      
      console.log("Resolving multi-level relationships...");
      
      // For now, just return the original data to avoid errors
      // This can be enhanced later
      return data;
    } catch (error) {
      console.error("Error resolving multi-level relationships:", error);
      return data;
    }
  }

  // Fix the processDataWithDanfo method to handle Danfo.js errors
  async processDataWithDanfo(data) {
    try {
      if (!data || data.length === 0) {
        return { processedData: data, insights: {}, columnTypes: {} };
      }
      
      console.log("Processing data with Danfo.js...");
      
      // Check if dfd is properly imported
      if (!dfd || typeof dfd.DataFrame !== 'function') {
        console.error("Danfo.js DataFrame is not available");
        return { 
          processedData: data, 
          insights: {}, 
          columnTypes: {} 
        };
      }
      
      try {
        // Create DataFrame
        const df = new dfd.DataFrame(data);
        
        // Get basic statistics
        const stats = df.describe().toJSON();
        
        // Return processed data
        return {
          processedData: data,
          insights: { summary: stats },
          columnTypes: {}
        };
      } catch (dfError) {
        console.error("Error using Danfo.js:", dfError);
        return { 
          processedData: data, 
          insights: {}, 
          columnTypes: {} 
        };
      }
    } catch (error) {
      console.error("Error processing data with Danfo.js:", error);
      return { 
        processedData: data, 
        insights: {}, 
        columnTypes: {} 
      };
    }
  }

  // Add this method to filter and optimize data based on prompt analysis
  async filterDataBasedOnPromptAnalysis(data, promptAnalysis) {
    try {
      if (!data || data.length === 0 || !promptAnalysis) {
        return data;
      }
      
      console.log("Filtering data based on prompt analysis...");
      
      // Create a deep copy of the data
      const filteredData = JSON.parse(JSON.stringify(data));
      
      // Extract relevant information from prompt analysis
      const { 
        coreQuestion = {}, 
        intentClassification = {}, 
        entitiesAndRelationships = {}, 
        dataRequirements = {} 
      } = promptAnalysis;
      
      // Get relevant fields from the analysis
      const relevantFields = dataRequirements.relevantFields || [];
      
      // If no specific fields are mentioned, return all data
      if (relevantFields.length === 0) {
        return filteredData;
      }
      
      // Normalize field names (lowercase for comparison)
      const normalizedRelevantFields = relevantFields.map(field => 
        field.toLowerCase().replace(/\s+/g, '_')
      );
      
      // Get all available fields from the data
      const availableFields = Object.keys(filteredData[0] || {});
      
      // Find fields to keep based on relevance
      const fieldsToKeep = availableFields.filter(field => {
        const normalizedField = field.toLowerCase();
        
        // Always keep ID fields and name fields
        if (normalizedField === 'id' || normalizedField.endsWith('_id') || 
            normalizedField.endsWith('name') || normalizedField.includes('name_')) {
          return true;
        }
        
        // Keep fields that match or partially match relevant fields
        return normalizedRelevantFields.some(relevantField => 
          normalizedField.includes(relevantField) || 
          relevantField.includes(normalizedField)
        );
      });
      
      // If we couldn't find any matching fields, return all data
      if (fieldsToKeep.length === 0 || fieldsToKeep.length === availableFields.length) {
        return filteredData;
      }
      
      console.log(`Keeping ${fieldsToKeep.length} of ${availableFields.length} fields based on relevance`);
      
      // Filter the data to only include relevant fields
      return filteredData.map(row => {
        const filteredRow = {};
        fieldsToKeep.forEach(field => {
          filteredRow[field] = row[field];
        });
        return filteredRow;
      });
    } catch (error) {
      console.error("Error filtering data based on prompt analysis:", error);
      return data;
    }
  }

  // Add this method to analyze data and extract key insights
  async analyzeDataForInsights(data, promptAnalysis) {
    try {
      if (!data || data.length === 0) {
        return { insights: [] };
      }
      
      console.log("Analyzing data for key insights...");
      
      // Extract intent and focus from prompt analysis
      const intentType = promptAnalysis?.intentClassification?.type || 'descriptive';
      const metrics = promptAnalysis?.intentClassification?.metrics || [];
      const entities = promptAnalysis?.entitiesAndRelationships?.entities || [];
      
      // Initialize insights array
      const insights = [];
      
      // Get column names
      const columns = Object.keys(data[0]);
      
      // Identify numeric columns
      const numericColumns = columns.filter(col => {
        return data.some(row => {
          const val = row[col];
          return typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)));
        });
      });
      
      // Identify categorical columns
      const categoricalColumns = columns.filter(col => {
        if (numericColumns.includes(col)) return false;
        
        // Check if column has a limited set of values
        const values = new Set();
        for (const row of data) {
          if (row[col] !== null && row[col] !== undefined) {
            values.add(row[col]);
          }
          // If we find more than 20 unique values, it's probably not categorical
          if (values.size > 20) return false;
        }
        
        return values.size > 1 && values.size <= 20;
      });
      
      // Identify date columns
      const dateColumns = columns.filter(col => {
        return data.some(row => {
          const val = row[col];
          return typeof val === 'string' && !isNaN(Date.parse(val));
        });
      });
      
      // Basic statistics for numeric columns
      numericColumns.forEach(col => {
        const values = data
          .map(row => parseFloat(row[col]))
          .filter(val => !isNaN(val));
        
        if (values.length === 0) return;
        
        // Calculate basic statistics
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        
        // Sort values for median
        const sortedValues = [...values].sort((a, b) => a - b);
        const median = sortedValues[Math.floor(sortedValues.length / 2)];
        
        // Add insight
        insights.push({
          type: 'numeric_summary',
          field: col,
          statistics: {
            count: values.length,
            sum,
            average: avg,
            median,
            min,
            max,
            range: max - min
          }
        });
      });
      
      // Distribution analysis for categorical columns
      categoricalColumns.forEach(col => {
        const distribution = {};
        let totalCount = 0;
        
        data.forEach(row => {
          const val = row[col];
          if (val !== null && val !== undefined) {
            distribution[val] = (distribution[val] || 0) + 1;
            totalCount++;
          }
        });
        
        if (totalCount === 0) return;
        
        // Convert to array and sort by frequency
        const sortedDistribution = Object.entries(distribution)
          .map(([value, count]) => ({
            value,
            count,
            percentage: (count / totalCount * 100).toFixed(1) + '%'
          }))
          .sort((a, b) => b.count - a.count);
        
        insights.push({
          type: 'categorical_distribution',
          field: col,
          totalCount,
          topCategories: sortedDistribution.slice(0, 5),
          uniqueValues: sortedDistribution.length
        });
      });
      
      return { insights };
    } catch (error) {
      console.error("Error analyzing data for insights:", error);
      return { insights: [] };
    }
  }
} 