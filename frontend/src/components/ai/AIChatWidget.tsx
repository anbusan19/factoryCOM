import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, X, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { sendFactoryMessage } from '@/lib/geminiApi';
import { useApiStore } from '@/store/useApiStore';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const suggestedQueries = [
  "What's the current risk level?",
  "Show all delayed suppliers",
  "Simulate Machine A failure",
  "Current production efficiency",
];

export const AIChatWidget = () => {
  const { machines, workers, factoryOrders, procurementOrders, safetyAlerts } = useApiStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m the FactoryCOM Cognitive Core. How can I help you manage your factory today?',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    const userInput = inputValue;
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);
    setError(null);

    try {
      // Prepare conversation history (excluding the initial greeting)
      const conversationHistory = messages
        .filter((msg) => msg.id !== '1')
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Prepare factory context
      const factoryContext = {
        machines,
        workers,
        orders: [...factoryOrders, ...procurementOrders],
        alerts: safetyAlerts,
      };

      // Call Gemini API
      const response = await sendFactoryMessage(
        userInput,
        conversationHistory,
        factoryContext
      );

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      setError('Failed to get response. Please try again.');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I apologize, but I encountered an error processing your request. Please try again or rephrase your question.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMessage]);
      toast.error('Failed to get AI response');
    } finally {
      setIsTyping(false);
    }
  };

  const handleSuggestedQuery = (query: string) => {
    setInputValue(query);
  };

  if (!isOpen) {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="fixed bottom-6 right-6 z-50"
      >
        <Button
          onClick={() => setIsOpen(true)}
          size="lg"
          className="w-14 h-14 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-lg glow-amber"
        >
          <MessageSquare className="w-6 h-6" />
        </Button>
      </motion.div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 20 }}
        className={`fixed ${isMinimized ? 'bottom-6 right-6' : 'bottom-6 right-6'} z-50 ${
          isMinimized ? 'w-80' : 'w-96'
        }`}
      >
        <Card className="glass-strong shadow-2xl border-primary/20">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">AI Assistant</h3>
                <p className="text-xs text-muted-foreground">Cognitive Core</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMinimized(!isMinimized)}
                className="h-8 w-8"
              >
                <Minimize2 className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="h-8"
                >
                  Close
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  className="h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Suggested Queries */}
              <div className="p-4 border-b border-sidebar-border">
                <p className="text-xs text-muted-foreground mb-2">Suggested queries:</p>
                <div className="flex flex-wrap gap-2">
                  {suggestedQueries.map((query) => (
                    <Button
                      key={query}
                      variant="outline"
                      size="sm"
                      onClick={() => handleSuggestedQuery(query)}
                      className="text-xs"
                    >
                      {query}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Messages */}
              <ScrollArea className="h-96 p-4">
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ))}
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg p-3">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" />
                          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce delay-100" />
                          <div className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce delay-200" />
                        </div>
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="flex justify-start">
                      <div className="bg-destructive/10 text-destructive rounded-lg p-3 max-w-[80%]">
                        <p className="text-sm">{error}</p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="p-4 border-t border-sidebar-border">
                <div className="flex items-center gap-2">
                  <Input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask me anything..."
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleSendMessage} 
                    size="icon" 
                    aria-label="Send message"
                    disabled={isTyping || !inputValue.trim()}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" onClick={() => setIsOpen(false)} aria-label="Close chat">
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </motion.div>
    </AnimatePresence>
  );
};
