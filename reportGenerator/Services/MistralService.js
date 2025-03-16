export class MistralService {
  constructor(mistralClient) {
    this.mistral = mistralClient;
    this.maxRetries = 3; // Maximum number of retries
    this.baseDelay = 1000; // Base delay in milliseconds (1 second)
  }

  // Helper function to delay execution
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Retry wrapper with exponential backoff
  async retryWithBackoff(operation, retryCount = 0) {
    try {
      return await operation();
    } catch (error) {
      // Check for rate limit errors (429) from both direct API calls and client library
      const isRateLimit =
        error?.statusCode === 429 ||
        (error.message && error.message.includes("429")) ||
        (error.message && error.message.includes("rate limit"));

      if (isRateLimit && retryCount < this.maxRetries) {
        // Increase the delay for rate limit errors
        const delayTime =
          this.baseDelay * Math.pow(2, retryCount + 1) + Math.random() * 1000; // Add jitter
        console.log(
          `Rate limit hit. Retrying in ${delayTime}ms... (Attempt ${
            retryCount + 1
          }/${this.maxRetries})`
        );
        await this.delay(delayTime);
        return this.retryWithBackoff(operation, retryCount + 1);
      }

      // If we've exhausted retries or it's not a rate limit error
      if (retryCount >= this.maxRetries) {
        if (isRateLimit) {
          console.error(
            `Rate limit exceeded after ${this.maxRetries} retries.`
          );
          throw new Error(`API rate limit exceeded. Please try again later.`);
        } else {
          throw new Error(
            `Maximum retry attempts (${this.maxRetries}) exceeded: ${error.message}`
          );
        }
      }
      throw error;
    }
  }

  // Format conversation history for the AI
  formatConversationHistory(history) {
    if (!history || !Array.isArray(history) || history.length === 0) {
      return "";
    }

    // Format the conversation history into a readable format for the AI
    return history
      .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join("\n");
  }

  // Generate response from Mistral AI with retry capability
  async generateMistralResponse(prompt, conversationHistory = []) {
    return this.retryWithBackoff(async () => {
      try {
        // Prepare messages array
        const messages = [];

        // Add conversation history if available
        if (
          conversationHistory &&
          Array.isArray(conversationHistory) &&
          conversationHistory.length > 0
        ) {
          // Add previous messages from history
          conversationHistory.forEach((msg) => {
            messages.push({
              role: msg.role,
              content: msg.content,
            });
          });
        }

        // Add the current prompt as the latest user message
        messages.push({
          role: "user",
          content: prompt,
        });

        // Use a direct approach without relying on the client's chat.complete method
        const response = await fetch(
          "https://api.mistral.ai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
            },
            body: JSON.stringify({
              model: "mistral-small-latest",
              messages: messages,
            }),
          }
        );

        if (!response.ok) {
          if (response.status === 429) {
            // Special handling for rate limit errors
            console.log("Rate limit detected, will retry with backoff");
            const error = new Error("Requests rate limit exceeded");
            error.statusCode = 429;
            throw error;
          }

          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `Mistral API error: ${response.status} ${JSON.stringify(errorData)}`
          );
        }

        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        console.error("Error calling Mistral AI:", error);

        // Properly propagate rate limit errors for the retry mechanism
        if (
          error.statusCode === 429 ||
          (error.message && error.message.includes("rate limit"))
        ) {
          const rateError = new Error("Rate limit exceeded");
          rateError.statusCode = 429;
          throw rateError;
        }

        throw new Error(`AI Service Error: ${error.message}`);
      }
    });
  }
} 