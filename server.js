const express = require('express');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .usage('Usage: node server.js --ollama-host HOST --ollama-port PORT --openai-host HOST --openai-port PORT --openai-key KEY')
  .option('ollama-host', {
    alias: 'oh',
    describe: 'Ollama host to expose (accepts Ollama API requests)',
    type: 'string',
    default: 'localhost'
  })
  .option('ollama-port', {
    alias: 'op',
    describe: 'Ollama port to expose',
    type: 'number',
    default: 11434
  })
  .option('openai-host', {
    alias: 'oah',
    describe: 'OpenAI API host to forward requests to',
    type: 'string',
    default: 'https://api.openai.com'
  })
  .option('openai-port', {
    alias: 'oap',
    describe: 'OpenAI API port',
    type: 'number',
    default: 443
  })
  .option('openai-key', {
    alias: 'oak',
    describe: 'OpenAI API key',
    type: 'string',
    demandOption: true
  })
  .example('node server.js --oh 0.0.0.0 --op 11435 --oah 192.168.1.104 --oap 5000 --oak 123', 'Run with custom configuration')
  .example('node server.js --oh localhost --op 11434 --oah https://api.openai.com --oap 443 --oak sk-xxxxxxxx', 'Run with default settings')
  .argv;

// Create Express app
const app = express();
const ollamaPort = argv.ollamaPort;
const ollamaHost = argv.ollamaHost;

// Middleware
app.use(express.json({ limit: '100mb' }));

// OpenAI API client
const openaiClient = axios.create({
  baseURL: `${argv.openaiHost.startsWith('http') ? argv.openaiHost : `http://${argv.openaiHost}`}:${argv.openaiPort}`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${argv.openaiKey}`
  }
});

// Helper function to translate Ollama to OpenAI format
const translateOllamaToOpenAI = (request) => {
  const messages = [];

  // Handle messages array first (highest priority)
  if (request.messages && Array.isArray(request.messages)) {
    for (const item of request.messages) {
      if (item.role && item.content) {
        messages.push({
          role: item.role,
          content: item.content
        });
      }
    }
  }

  // Handle system message if provided (fallback)
  if (messages.length === 0 && request.system) {
    messages.push({ role: 'system', content: request.system });
  }

  // Handle prompt if provided (fallback)
  if (messages.length === 0 && request.prompt) {
    // If prompt is plain text (not using custom tags), add as user message
    if (!request.prompt.includes('<user>') && !request.prompt.includes('<assistant>')) {
      messages.push({ role: 'user', content: request.prompt });
    } else {
      // Parse custom tag format
      const promptLines = request.prompt.split('\n');
      let currentRole = null;
      let currentContent = '';

      for (const line of promptLines) {
        if (line.startsWith('<user>')) {
          if (currentRole && currentContent) {
            messages.push({ role: currentRole, content: currentContent.trim() });
            currentContent = '';
          }
          currentRole = 'user';
          currentContent = line.substring(6);
        } else if (line.startsWith('<assistant>')) {
          if (currentRole && currentContent) {
            messages.push({ role: currentRole, content: currentContent.trim() });
            currentContent = '';
          }
          currentRole = 'assistant';
          currentContent = line.substring(11);
        } else if (line === '</user>' || line === '</assistant>') {
          if (currentContent) {
            messages.push({ role: currentRole, content: currentContent.trim() });
            currentContent = '';
          }
        } else if (currentContent !== '') {
          currentContent += '\n' + line;
        }
      }

      if (currentRole && currentContent) {
        messages.push({ role: currentRole, content: currentContent.trim() });
      }
    }
  }

  // Handle history if provided (fallback)
  if (messages.length === 0 && request.history && Array.isArray(request.history)) {
    for (const item of request.history) {
      if (item.role === 'user' || item.role === 'assistant') {
        messages.push({
          role: item.role,
          content: item.content || ''
        });
      }
    }
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: '' });
  }

  const openaiRequest = {
    model: request.model || 'gpt-3.5-turbo',
    messages: messages,
    stream: request.stream || false,
    temperature: request.options?.temperature,
    max_tokens: request.options?.num_predict,
    top_p: request.options?.top_p,
    frequency_penalty: request.options?.repeat_penalty ? (request.options.repeat_penalty - 1) : undefined,
    presence_penalty: request.options?.presence_penalty || undefined,
    tools: request.tools || undefined,
    tool_choice: request.options?.tool_choice || undefined,
    response_format: request.options?.response_format || undefined
  };

  return openaiRequest;
};

// Helper function to translate OpenAI to Ollama format for chat endpoint
const translateOpenAIToOllamaChat = (response) => {
  return {
    model: response.model,
    created_at: new Date(response.created * 1000).toISOString(),
    message: {
      role: response.choices[0].message.role,
      content: response.choices[0].message.content
    },
    done: response.choices[0].finish_reason === 'stop',
    total_duration: 123456789,
    load_duration: 12345678,
    prompt_eval_count: response.usage?.prompt_tokens || 0,
    eval_count: response.usage?.completion_tokens || 0,
    eval_duration: 123456789
  };
};

// Helper function to translate OpenAI to Ollama format for generate endpoint
const translateOpenAIToOllamaGenerate = (response) => {
  return {
    model: response.model,
    created_at: new Date(response.created * 1000).toISOString(),
    response: response.choices[0].message.content,
    done: response.choices[0].finish_reason === 'stop',
    total_duration: 123456789,
    load_duration: 12345678,
    prompt_eval_count: response.usage?.prompt_tokens || 0,
    eval_count: response.usage?.completion_tokens || 0,
    eval_duration: 123456789
  };
};

// Helper function to translate OpenAI streaming response to Ollama format for chat endpoint
const translateOpenAIStreamToOllamaChat = (response) => {
  const delta = response.choices[0].delta || {};
  const message = {
    role: delta.role || 'assistant',
    content: delta.content || ''
  };

  // Include tool calls if present
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    message.tool_calls = delta.tool_calls;
  }

  return {
    model: response.model,
    created_at: new Date().toISOString(),
    message: message,
    done: response.choices[0].finish_reason ? true : false
  };
};

// Generate endpoint (Ollama API)
app.post('/api/generate', async (req, res) => {
  try {
    const ollamaRequest = req.body;
    const openaiRequest = translateOllamaToOpenAI(ollamaRequest);
    const openaiResponse = await openaiClient.post('/v1/chat/completions', openaiRequest, {
          timeout: 30000
        });

    const ollamaResponse = translateOpenAIToOllamaGenerate(openaiResponse.data);
    res.json(ollamaResponse);
  } catch (error) {
    console.error('Error in generate endpoint:', error);
    if (error.response) {
      console.error('[DEBUG] OpenAI API error response:', error.response.status, JSON.stringify(error.response.data, null, 2));
      res.status(error.response.status).json({
        error: error.response.data
      });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({
        error: {
          message: 'Request timeout - the OpenAI server took too long to respond',
          type: 'timeout_error'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  }
});

// Chat endpoint (Ollama API)
app.post('/api/chat', async (req, res) => {
  try {
    const ollamaRequest = req.body;
    const accept = req.headers.accept || '';
    let isStreaming = !!ollamaRequest.stream || accept.includes('text/event-stream');

    if (isStreaming && (!ollamaRequest.messages || ollamaRequest.messages.length === 0)) {
      isStreaming = false;
    }

    const openaiRequest = translateOllamaToOpenAI(ollamaRequest);

    // Ensure the OpenAI request is set to stream when we intend to stream
    if (isStreaming) {
      openaiRequest.stream = true;
    }

    if (isStreaming) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      try {
        const openaiResponse = await openaiClient.post('/v1/chat/completions', {
          ...openaiRequest,
          stream: true
        }, {
          timeout: 30000,
          responseType: 'stream'
        });

        let responseBuffer = '';
        let firstChunk = true;
        let streamEnded = false;

        // If the response is not a stream (e.g., due to misconfiguration), fallback to normal response
        if (typeof openaiResponse.data.on !== 'function') {
          const normalResponse = await openaiClient.post('/v1/chat/completions', openaiRequest, {
            timeout: 30000
          });
          const ollamaResponse = translateOpenAIToOllamaChat(normalResponse.data);
          res.json(ollamaResponse);
          res.end();
          return;
        }

        openaiResponse.data.on('data', (chunk) => {
          if (streamEnded) return;
          responseBuffer += chunk.toString();
          const lines = responseBuffer.split('\n');
          responseBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6);
              if (data === '[DONE]') {
                if (!streamEnded) {
                  res.write('[DONE]\n');
                  res.flush();
                  res.end();
                  streamEnded = true;
                }
                return;
              }
              try {
                const jsonData = JSON.parse(data);
                if (jsonData.error) {
                  const errorResponse = { error: jsonData.error };
                  res.write(JSON.stringify(errorResponse) + '\n');
                  res.write('[DONE]\n');
                  res.end();
                  streamEnded = true;
                  return;
                }
                const ollamaData = translateOpenAIStreamToOllamaChat(jsonData);
                if (firstChunk) {
                  const firstChunkData = {
                    model: ollamaData.model,
                    created_at: ollamaData.created_at,
                    message: { role: 'assistant', content: '' },
                    done: false
                  };
                  res.write(JSON.stringify(firstChunkData) + '\n');
                  firstChunk = false;
                }
                if (ollamaData.message.content || ollamaData.message.tool_calls || ollamaData.done) {
                  const responseChunk = {
                    model: ollamaData.model,
                    created_at: ollamaData.created_at,
                    message: ollamaData.message,
                    done: ollamaData.done
                  };
                  res.write(JSON.stringify(responseChunk) + '\n');
                }
                if (ollamaData.done) {
                  res.write('[DONE]\n');
                  res.flush();
                  res.end();
                  streamEnded = true;
                }
              } catch (parseError) {
                const errorResponse = { error: { message: 'Error parsing response', type: 'parse_error' } };
                res.write(JSON.stringify(errorResponse) + '\n');
                res.write('[DONE]\n');
                res.end();
                streamEnded = true;
              }
            }
          }
        });


        openaiResponse.data.on('end', () => {
          if (!streamEnded) {
            // Process any remaining data in the buffer
            if (responseBuffer.trim()) {
              const lines = responseBuffer.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.substring(6);

                  if (data === '[DONE]') {
                    if (!streamEnded) {
                      res.write('[DONE]\n');
                      res.flush();
                      res.end();
                      streamEnded = true;
                    }
                    return;
                  }

                  try {
                    const jsonData = JSON.parse(data);
                    // Check if this is an error response
                    if (jsonData.error) {
                      const errorResponse = {
                        error: jsonData.error
                      };
                      const errorJson = JSON.stringify(errorResponse);
                      res.write(errorJson + '\n');
                      res.write('[DONE]\n');
                      res.flush();
                      res.end();
                      streamEnded = true;
                      return;
                    }

                    const ollamaData = translateOpenAIStreamToOllamaChat(jsonData);

                    const responseChunk = {
                      model: ollamaData.model,
                      created_at: ollamaData.created_at,
                      message: ollamaData.message,
                      done: ollamaData.done
                    };
                    const chunkJson = JSON.stringify(responseChunk);
                    res.write(chunkJson + '\n');

                    if (ollamaData.done) {
                      res.write('[DONE]\n');
                      res.flush();
                      res.end();
                      streamEnded = true;
                    }
                  } catch (parseError) {
                    // Send error and complete stream
                    const errorResponse = {
                      error: {
                        message: 'Error parsing response',
                        type: 'parse_error'
                      }
                    };
                    const errorJson = JSON.stringify(errorResponse);
                    res.write(errorJson + '\n');
                    res.write('[DONE]\n');
                    res.flush();
                    res.end();
                    streamEnded = true;
                  }
                }
              }
            }

            // If we haven't ended yet, send DONE marker
            if (!streamEnded) {
              res.write('[DONE]\n');
              res.flush();
              res.end();
              streamEnded = true;
            }
          }
        });

        openaiResponse.data.on('close', () => {
          if (!streamEnded) {
            if (!streamEnded) {
              res.write('[DONE]\n');
              res.end();
              streamEnded = true;
            }
          }
        });

        openaiResponse.data.on('error', (error) => {
          if (!streamEnded) {
            const errorResponse = {
              error: {
                message: error.message || 'Stream error',
                type: 'stream_error'
              }
            };
            const errorJson = JSON.stringify(errorResponse);
            res.write(errorJson + '\n');
            res.write('[DONE]\n');
            res.end();
            streamEnded = true;
          }
        });
      } catch (error) {
        const errorResponse = {
          error: {
            message: error.message || 'Internal server error',
            type: 'server_error'
          }
        };
        res.write(`${JSON.stringify(errorResponse)}\n\n`);
        res.write('[DONE]\n\n');
        res.end();
      }
    } else {
      const openaiResponse = await openaiClient.post('/v1/chat/completions', openaiRequest, {
        timeout: 30000
      });
      const ollamaResponse = translateOpenAIToOllamaChat(openaiResponse.data);
      res.json(ollamaResponse);
    }
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    if (error.response) {
      res.status(error.response.status).json({
        error: error.response.data
      });
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({
        error: {
          message: 'Request timeout - the OpenAI server took too long to respond',
          type: 'timeout_error'
        }
      });
    } else {
      res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  }
});

// Pull endpoint (Ollama API - model download)
app.post('/api/pull', async (req, res) => {
  try {
    const { name } = req.body;
    res.json({
      status: 'success',
      model: name
    });
  } catch (error) {
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Tags endpoint (Ollama API - list models)
app.get('/api/tags', async (req, res) => {
  try {
    const response = await openaiClient.get('/v1/models');
    const models = response.data.data.map(model => ({
      name: model.id,
      modified_at: new Date().toISOString(),
      size: 0
    }));
    res.json({
      models: models
    });
  } catch (error) {
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    });
  }
});

// Show endpoint (Ollama API - model info)
app.post('/api/show', async (req, res) => {
  try {
    const { model } = req.body;
    const response = await openaiClient.get(`/v1/models/${model}`);
    res.json({
      model: model,
      details: {
        format: 'openai',
        family: 'gpt',
        families: ['gpt'],
        parameter_size: 'unknown',
        quantization_level: 'unknown'
      },
      modified_at: new Date(response.data.created * 1000).toISOString(),
      size: 0
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      res.status(404).json({
        error: `model not found: ${req.body.model}`
      });
    } else {
      res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Start server
app.listen(ollamaPort, () => {
  console.log(`Ollama-compatible API server running on ${ollamaHost}:${ollamaPort}`);
  console.log(`Forwarding requests to OpenAI at ${argv.openaiHost}:${argv.openaiPort}`);
  console.log(`OpenAI API key: ${argv.openaiKey ? 'configured' : 'NOT configured'}`);
});
