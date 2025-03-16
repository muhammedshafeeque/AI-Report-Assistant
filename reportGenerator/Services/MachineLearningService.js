import * as tf from "@tensorflow/tfjs";

export class MachineLearningService {
  constructor() {
    this.tfModelReady = false;
    this.setupTensorflowModel();
  }

  // Setup TensorFlow.js model
  async setupTensorflowModel() {
    try {
      // Create a simple model for text similarity
      this.tfModel = tf.sequential();
      this.tfModel.add(
        tf.layers.dense({
          units: 64,
          activation: "relu",
          inputShape: [100], // Input dimension for word embeddings
        })
      );
      this.tfModel.add(
        tf.layers.dense({
          units: 32,
          activation: "relu",
        })
      );
      this.tfModel.add(
        tf.layers.dense({
          units: 16,
          activation: "sigmoid",
        })
      );

      // Compile the model
      this.tfModel.compile({
        optimizer: "adam",
        loss: "binaryCrossentropy",
        metrics: ["accuracy"],
      });

      console.log("TensorFlow.js model initialized successfully");
      this.tfModelReady = true;
    } catch (error) {
      console.warn("Error initializing TensorFlow.js model:", error);
      this.tfModelReady = false;
    }
  }

  // Simple text to vector conversion (word frequency approach)
  textToVector(text, vocabSize = 100) {
    // Create a zero-filled vector
    const vector = new Array(vocabSize).fill(0);

    // Simple tokenization and counting
    const words = text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);

    // Count word frequencies (limited by vocabSize)
    words.forEach((word) => {
      // Simple hash function to map words to vector indices
      const index = Math.abs(this.simpleHash(word) % vocabSize);
      vector[index] += 1;
    });

    // Normalize the vector
    const sum = vector.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] = vector[i] / sum;
      }
    }

    return vector;
  }

  // Simple string hash function
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  // Train the TensorFlow model with accumulated knowledge
  async trainTensorflowModel(successfulQueries) {
    try {
      if (
        !this.tfModelReady ||
        !successfulQueries ||
        successfulQueries.length < 5
      ) {
        console.log("Not enough samples or model not ready to train");
        return;
      }

      console.log("Training TensorFlow model with accumulated knowledge...");

      // Prepare training data
      const trainingData = [];
      const trainingLabels = [];

      // Create positive examples (similar queries)
      successfulQueries.forEach((entry, i) => {
        // Convert query to vector
        const queryVector = this.textToVector(entry.userPrompt);

        // Add positive examples (similar queries should be close)
        for (let j = 0; j < successfulQueries.length; j++) {
          if (i !== j) {
            const otherQuery = successfulQueries[j];
            const similarity = this.calculateTextSimilarity(
              entry.userPrompt,
              otherQuery.userPrompt
            );

            if (similarity > 0.5) {
              trainingData.push(queryVector);
              trainingLabels.push([1]); // Similar
            } else if (similarity < 0.2) {
              trainingData.push(queryVector);
              trainingLabels.push([0]); // Not similar
            }
          }
        }
      });

      if (trainingData.length < 5) {
        console.log("Not enough training examples yet");
        return;
      }

      // Convert to tensors
      const xs = tf.tensor2d(trainingData);
      const ys = tf.tensor2d(trainingLabels);

      // Train the model
      await this.tfModel.fit(xs, ys, {
        epochs: 10,
        batchSize: 4,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(`Epoch ${epoch}: loss = ${logs.loss}`);
          },
        },
      });

      console.log("TensorFlow model training completed");

      // Clean up tensors
      xs.dispose();
      ys.dispose();
      
      return true;
    } catch (error) {
      console.error("Error training TensorFlow model:", error);
      return false;
    }
  }

  // Calculate text similarity using TensorFlow model if available
  async calculateModelSimilarity(text1, text2) {
    if (!this.tfModelReady) {
      // Fall back to simple similarity
      return this.calculateTextSimilarity(text1, text2);
    }

    try {
      const vec1 = this.textToVector(text1);
      const vec2 = this.textToVector(text2);

      // Use the model to predict similarity
      const input = tf.tensor2d([vec1]);
      const prediction = this.tfModel.predict(input);
      const similarityScore = await prediction.data();

      // Clean up tensors
      input.dispose();
      prediction.dispose();

      return similarityScore[0];
    } catch (error) {
      console.error("Error calculating model similarity:", error);
      return this.calculateTextSimilarity(text1, text2);
    }
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
} 