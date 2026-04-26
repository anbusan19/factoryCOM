// Groq API service - calls backend endpoint
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface GroqMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Send a message to Groq API via backend endpoint and get a response
 */
export async function sendMessageToGemini(
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversationHistory,
      }),
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response || '';
  } catch (error) {
    console.error('Groq API error:', error);
    throw error;
  }
}

/**
 * Send a message with factory context to Groq via backend endpoint
 */
export async function sendFactoryMessage(
  message: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  factoryContext?: {
    machines?: any[];
    workers?: any[];
    orders?: any[];
    alerts?: any[];
  }
): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        conversationHistory,
        factoryContext,
      }),
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response || '';
  } catch (error) {
    console.error('Groq API error:', error);
    throw error;
  }
}
