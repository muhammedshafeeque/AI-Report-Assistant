import {
  mean,
  median,
  standardDeviation,
  sum,
  min,
  max,
  linearRegression,
  linearRegressionLine,
  sampleCorrelation,
  quantile,
  medianAbsoluteDeviation,
  mode,
} from "simple-statistics";
import pkg from "danfojs-node";
const { dfd } = pkg;
import * as math from "mathjs";

export class AnalyticsService {
  constructor() {
    this.dataUtils = this.setupDataProcessingUtils();
  }

  // Helper method to describe correlation strength
  getCorrelationStrength(correlation) {
    const absCorr = Math.abs(correlation);
    if (absCorr >= 0.9) return "Very strong";
    if (absCorr >= 0.7) return "Strong";
    if (absCorr >= 0.5) return "Moderate";
    if (absCorr >= 0.3) return "Weak";
    return "Very weak";
  }

  // Perform calculations based on data and requested calculation types
  async performCalculations(data, calculationsNeeded = []) {
    try {
      // Ensure calculationsNeeded is an array
      const calculations = Array.isArray(calculationsNeeded)
        ? calculationsNeeded
        : [];

      // Initialize results object
      const results = {
        aggregates: {},
        timeSeries: {},
        correlations: {},
        custom: {},
      };

      // If no data or no calculations needed, return empty results
      if (!data || data.length === 0 || calculations.length === 0) {
        return results;
      }

      // Get column names from the first row
      const columns = Object.keys(data[0] || {});

      // Perform basic statistical calculations for numeric columns
      if (
        calculations.some(
          (calc) => calc.includes("statistic") || calc.includes("basic")
        )
      ) {
        for (const column of columns) {
          // Extract values for this column, ensuring they are numbers
          const values = data
            .map((row) => row[column])
            .filter(
              (val) => val !== null && val !== undefined && !isNaN(Number(val))
            )
            .map((val) => Number(val));

          // Only calculate statistics if we have numeric values
          if (values.length > 0) {
            results.aggregates[column] = {
              mean: mean(values),
              median: median(values),
              min: min(values),
              max: max(values),
              sum: sum(values),
              count: values.length,
              stdDev: values.length > 1 ? standardDeviation(values) : 0,
            };
          }
        }
      }

      // Perform correlation analysis if requested
      if (calculations.some((calc) => calc.includes("correlation"))) {
        // Find numeric columns
        const numericColumns = columns.filter((column) => {
          const values = data.map((row) => row[column]);
          return values.some(
            (val) => val !== null && val !== undefined && !isNaN(Number(val))
          );
        });

        // Calculate correlations between all pairs of numeric columns
        for (let i = 0; i < numericColumns.length; i++) {
          for (let j = i + 1; j < numericColumns.length; j++) {
            const col1 = numericColumns[i];
            const col2 = numericColumns[j];

            // Get paired values (only where both are numbers)
            const pairs = data
              .map((row) => [row[col1], row[col2]])
              .filter(
                (pair) =>
                  pair[0] !== null &&
                  pair[0] !== undefined &&
                  !isNaN(Number(pair[0])) &&
                  pair[1] !== null &&
                  pair[1] !== undefined &&
                  !isNaN(Number(pair[1]))
              )
              .map((pair) => [Number(pair[0]), Number(pair[1])]);

            // Calculate correlation if we have enough pairs
            if (pairs.length > 2) {
              const x = pairs.map((pair) => pair[0]);
              const y = pairs.map((pair) => pair[1]);

              try {
                const correlation = sampleCorrelation(x, y);
                results.correlations[`${col1}_vs_${col2}`] = correlation;
              } catch (error) {
                console.warn(
                  `Could not calculate correlation between ${col1} and ${col2}:`,
                  error
                );
              }
            }
          }
        }
      }

      return results;
    } catch (error) {
      console.error("Error performing calculations:", error);
      return {
        aggregates: {},
        timeSeries: {},
        correlations: {},
        custom: {},
        error: error.message,
      };
    }
  }

  // Method to enrich data with calculation results
  enrichDataWithCalculations(data, calculationResults) {
    try {
      // If there are no calculation results or data, return the original data
      if (
        !calculationResults ||
        Object.keys(calculationResults).length === 0 ||
        !data ||
        data.length === 0
      ) {
        return data;
      }

      // Create a deep copy of the data to avoid modifying the original
      const enrichedData = JSON.parse(JSON.stringify(data));

      // Add calculation results as metadata to the enriched data
      enrichedData.calculationResults = calculationResults;

      // For aggregate calculations, we might want to add them as properties to each row
      if (calculationResults.aggregates) {
        for (const row of enrichedData) {
          for (const [field, value] of Object.entries(
            calculationResults.aggregates
          )) {
            if (row[field] !== undefined && typeof value.mean === "number") {
              // Add a comparison to the mean
              row[`${field}_vs_mean`] = row[field] - value.mean;

              // Add a percentile if standard deviation is available
              if (typeof value.stdDev === "number" && value.stdDev > 0) {
                row[`${field}_z_score`] =
                  (row[field] - value.mean) / value.stdDev;
              }
            }
          }
        }
      }

      return enrichedData;
    } catch (error) {
      console.error("Error enriching data with calculations:", error);
      // Return the original data if there's an error
      return data;
    }
  }

  // Data processing utilities for in-memory calculations
  setupDataProcessingUtils() {
    return {
      // Basic statistics
      calculateMean: function (data, field) {
        if (!data || !data.length) return null;
        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        return values.length ? mean(values) : null;
      },

      calculateMedian: function (data, field) {
        if (!data || !data.length) return null;
        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        return values.length ? median(values) : null;
      },

      calculateStdDev: function (data, field) {
        if (!data || !data.length) return null;
        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        return values.length > 1 ? standardDeviation(values) : null;
      },

      calculateSum: function (data, field) {
        if (!data || !data.length) return null;
        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        return values.length ? sum(values) : null;
      },

      calculateMin: function (data, field) {
        if (!data || !data.length) return null;
        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        return values.length ? min(values) : null;
      },

      calculateMax: function (data, field) {
        if (!data || !data.length) return null;
        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        return values.length ? max(values) : null;
      },

      // Calculate multiple statistics for multiple fields
      calculateMultipleStats: function (data, fields) {
        if (!data || !data.length || !fields || !fields.length) {
          return {};
        }

        const results = {};

        fields.forEach((field) => {
          const values = data
            .map((item) => parseFloat(item[field]))
            .filter((val) => !isNaN(val));

          if (values.length === 0) {
            results[field] = {
              mean: null,
              median: null,
              stdDev: null,
              min: null,
              max: null,
              sum: null,
              count: 0,
            };
            return;
          }

          results[field] = {
            mean: mean(values),
            median: median(values),
            stdDev: values.length > 1 ? standardDeviation(values) : null,
            min: min(values),
            max: max(values),
            sum: sum(values),
            count: values.length,
          };

          // Add additional statistics if we have enough data
          if (values.length >= 3) {
            // Calculate quartiles
            results[field].q1 = quantile(values, 0.25);
            results[field].q3 = quantile(values, 0.75);
            results[field].iqr = results[field].q3 - results[field].q1;

            // Calculate mode if available
            try {
              results[field].mode = mode(values);
            } catch (e) {
              // Mode might not exist or be unique
              results[field].mode = null;
            }
          }
        });

        return results;
      },

      // Detect anomalies in multiple fields
      detectAnomaliesMultipleFields: function (
        data,
        fields,
        method = "zscore",
        threshold = 2.5
      ) {
        if (!data || !data.length || !fields || !fields.length) {
          return {};
        }

        const results = {};

        fields.forEach((field) => {
          if (method === "zscore") {
            results[field] = this.detectAnomaliesZScore(data, field, threshold);
          } else if (method === "mad") {
            results[field] = this.detectAnomaliesMAD(data, field, threshold);
          } else {
            results[field] = this.detectOutliers(data, field);
          }
        });

        return results;
      },

      // Detect anomalies using Z-score method
      detectAnomaliesZScore: function (data, field, threshold = 2.5) {
        if (!data || !data.length) return { outliers: [], normalData: data };

        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        
        if (values.length < 2) return { outliers: [], normalData: data };

        const meanVal = mean(values);
        const stdDevVal = standardDeviation(values);

        if (stdDevVal === 0) return { outliers: [], normalData: data };

        const outliers = data.filter((item) => {
          const val = parseFloat(item[field]);
          if (isNaN(val)) return false;
          const zScore = Math.abs((val - meanVal) / stdDevVal);
          return zScore > threshold;
        });

        const normalData = data.filter((item) => {
          const val = parseFloat(item[field]);
          if (isNaN(val)) return true; // Keep non-numeric values in normal data
          const zScore = Math.abs((val - meanVal) / stdDevVal);
          return zScore <= threshold;
        });

        return {
          outliers,
          normalData,
          stats: {
            mean: meanVal,
            stdDev: stdDevVal,
            threshold,
          },
        };
      },

      // Detect anomalies using Median Absolute Deviation method
      detectAnomaliesMAD: function (data, field, threshold = 3.5) {
        if (!data || !data.length) return { outliers: [], normalData: data };

        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        
        if (values.length < 2) return { outliers: [], normalData: data };

        const medianVal = median(values);
        const mad = medianAbsoluteDeviation(values);

        if (mad === 0) return { outliers: [], normalData: data };

        const outliers = data.filter((item) => {
          const val = parseFloat(item[field]);
          if (isNaN(val)) return false;
          const madScore = Math.abs((val - medianVal) / mad);
          return madScore > threshold;
        });

        const normalData = data.filter((item) => {
          const val = parseFloat(item[field]);
          if (isNaN(val)) return true;
          const madScore = Math.abs((val - medianVal) / mad);
          return madScore <= threshold;
        });

        return {
          outliers,
          normalData,
          stats: {
            median: medianVal,
            mad,
            threshold,
          },
        };
      },

      // Calculate correlation matrix for multiple fields
      calculateCorrelationMatrix: function (data, fields) {
        if (!data || !data.length || !fields || fields.length < 2) {
          return { error: "Insufficient data for correlation matrix" };
        }

        const matrix = {};

        // Initialize matrix
        fields.forEach((field1) => {
          matrix[field1] = {};
          fields.forEach((field2) => {
            matrix[field1][field2] = field1 === field2 ? 1 : null;
          });
        });

        // Calculate correlations
        for (let i = 0; i < fields.length; i++) {
          for (let j = i + 1; j < fields.length; j++) {
            const field1 = fields[i];
            const field2 = fields[j];

            const correlation = this.calculateCorrelation(data, field1, field2);

            matrix[field1][field2] = correlation;
            matrix[field2][field1] = correlation; // Matrix is symmetric
          }
        }

        return {
          matrix,
        };
      },

      // Calculate correlation between two fields
      calculateCorrelation: function (data, fieldX, fieldY) {
        if (!data || data.length < 3) return null;

        const pairs = data
          .map((item) => [parseFloat(item[fieldX]), parseFloat(item[fieldY])])
          .filter((pair) => !isNaN(pair[0]) && !isNaN(pair[1]));

        if (pairs.length < 3) return null;

        const x = pairs.map((pair) => pair[0]);
        const y = pairs.map((pair) => pair[1]);

        try {
          return sampleCorrelation(x, y);
        } catch (e) {
          console.error("Error calculating correlation:", e);
          return null;
        }
      },

      // Detect trend in time series data
      detectTrend: function (data, valueField, timeField) {
        if (!data || data.length < 3) return { trend: "insufficient data" };

        // Sort data by time
        const sortedData = [...data].sort((a, b) => {
          const timeA = new Date(a[timeField]);
          const timeB = new Date(b[timeField]);
          return timeA - timeB;
        });

        // Extract values
        const values = sortedData
          .map((item) => parseFloat(item[valueField]))
          .filter((val) => !isNaN(val));
        if (values.length < 3) return { trend: "insufficient valid data" };

        // Simple linear regression
        const n = values.length;
        const indices = Array.from({ length: n }, (_, i) => i);

        const sumX = sum(indices);
        const sumY = sum(values);
        const sumXY = sum(indices.map((x, i) => x * values[i]));
        const sumXX = sum(indices.map((x) => x * x));

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

        // Determine trend direction and strength
        let trend;
        if (Math.abs(slope) < 0.01) {
          trend = "stable";
        } else if (slope > 0) {
          trend = slope > 0.1 ? "strong increase" : "slight increase";
        } else {
          trend = slope < -0.1 ? "strong decrease" : "slight decrease";
        }

        // Calculate percent change safely (avoid division by zero)
        let changePercent = 0;
        if (values[0] !== 0) {
          changePercent =
            ((values[values.length - 1] - values[0]) / values[0]) * 100;
        } else if (values[values.length - 1] !== 0) {
          // If starting from zero, we can't calculate percentage but can indicate it's an increase
          changePercent = 100; // Indicating a complete increase from zero
        }

        return {
          trend,
          slope,
          firstValue: values[0],
          lastValue: values[values.length - 1],
          changePercent,
        };
      },

      // Convert data to DataFrame
      toDataFrame: function (data) {
        if (!data || !data.length) return null;
        try {
          return new dfd.DataFrame(data);
        } catch (e) {
          console.error("Error creating DataFrame:", e);
          return null;
        }
      },

      // Outlier detection (using IQR method)
      detectOutliers: function (data, field) {
        if (!data || data.length < 4) return { outliers: [], normalData: data };

        const values = data
          .map((item) => parseFloat(item[field]))
          .filter((val) => !isNaN(val));
        if (values.length < 4) return { outliers: [], normalData: data };

        // Sort values
        values.sort((a, b) => a - b);

        // Calculate quartiles
        const q1Idx = Math.floor(values.length * 0.25);
        const q3Idx = Math.floor(values.length * 0.75);
        const q1 = values[q1Idx];
        const q3 = values[q3Idx];

        // Calculate IQR and bounds
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        // Identify outliers
        const outliers = data.filter((item) => {
          const val = parseFloat(item[field]);
          return !isNaN(val) && (val < lowerBound || val > upperBound);
        });

        const normalData = data.filter((item) => {
          const val = parseFloat(item[field]);
          return isNaN(val) || (val >= lowerBound && val <= upperBound);
        });

        return {
          outliers,
          normalData,
          bounds: { lower: lowerBound, upper: upperBound },
          quartiles: { q1, q3 },
        };
      }
    };
  }

  // Process decisions to get enhanced insights
  async processDecisions(decisions, data, userPrompt) {
    // Ensure decisions has all required properties with defaults
    const safeDecisions = {
      intentClassification: {
        type: "descriptive",
        confidence: 0.8,
        reasoning: "Default analysis",
      },
      dataAssessment: {
        availableFields: [],
        dataTypes: {},
        sufficiencyScore: 0.5,
        qualityIssues: [],
      },
      analysisStrategy: {
        recommendedTechniques: ["basic statistics"],
        visualizations: ["bar chart"],
      },
      dataRequirements: {
        needsAdditionalQuery: false,
        additionalQueryDescription: null,
      },
      calculationsNeeded: ["basic statistics"],
      analysisSteps: ["Analyze data", "Generate report"],
      ...(decisions || {}), // Safely merge with provided decisions
    };

    // Initialize results with empty arrays to prevent undefined references
    const results = {
      insights: [],
      recommendations: [],
      additionalAnalyses: [],
    };

    try {
      // Generate basic insights based on data
      results.insights.push({
        type: "summary",
        content: `Analysis of ${data.length} records shows key patterns in the data.`
      });

      // Add data quality recommendations if needed
      if (
        safeDecisions.dataAssessment.qualityIssues &&
        safeDecisions.dataAssessment.qualityIssues.length > 0
      ) {
        results.recommendations.push({
          type: "dataQuality",
          content: "Data quality issues were detected that may affect analysis results."
        });
      }

      return results;
    } catch (error) {
      console.error("Error in processDecisions:", error);
      // Return the initialized results instead of throwing
      return results;
    }
  }
} 