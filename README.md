# Ollama-OpenAI-Compatibl API Proxy

A Node.js service that provides an Ollama-compatible API and translates requests to OpenAI-compatible API.

**Note:** This project was developed with integration with llama-cpp in mind and has not been tested on the OpenAI website.

**Cline Provider Settings:** When using this with "Use compact prompt" in Cline's Ollama provider, it is recommended to leave the model name parameter in Cline settings empty due to possible bug in the Cline codebase that leads to incorrect behavior.

## Background

This project was created to address limitations found in existing Ollama-to-OpenAI API proxies. While there are similar solutions available (such as [github.com/xrip/ollama-api-proxy](https://github.com/xrip/ollama-api-proxy)), this implementation was specifically designed with llama-cpp integration in mind. The existing solutions primarily target online OpenAI providers and, although they allow specifying local URLs, they exhibit incorrect behavior when used with Cline-based agents.

Additionally, this software prioritizes simplicity and ease of use, eliminating complex configuration hurdles that often complicate similar projects. It provides a straightforward solution for bridging Ollama and OpenAI APIs with minimal setup requirements.

## Features

- Accepts Ollama API requests
- Forwards them to OpenAI's API
- Translates between Ollama and OpenAI formats
- Configurable hosts and ports via command line arguments

## Installation

```bash
npm install
```

## Usage

```bash
node server.js --ollama-host HOST --ollama-port PORT --openai-host HOST --openai-port PORT --openai-key KEY
```

### Required Arguments

- `--openai-key` or `-oak`: Your OpenAI API key (required)

### Optional Arguments

- `--ollama-host` or `-oh`: Ollama host to expose (default: `http://localhost`)
- `--ollama-port` or `-op`: Ollama port to expose (default: `11434`)
- `--openai-host` or `-oah`: OpenAI API host to forward to (default: `https://api.openai.com`)
- `--openai-port` or `-oap`: OpenAI API port (default: `443`)

## Example

```bash
node server.js --oh 0.0.0.0 --op 11435 --oah 192.168.1.104 --oap 5000 --oak 123
```

This example exposes the Ollama API on port 11435, forwards requests to OpenAI API at 192.168.1.104:5000, and uses the provided API key.

## API Endpoints

### Ollama API Endpoints (Accepted)

- `POST /api/generate` - Generate text
- `POST /api/chat` - Chat completions
- `POST /api/pull` - Pull model (returns success for OpenAI models)
- `GET /api/tags` - List available models
- `POST /api/show` - Show model information

### Utility Endpoints

- `GET /health` - Health check

## How It Works

1. The service listens on the specified Ollama port
2. When it receives an Ollama API request, it translates the request to OpenAI format
3. The request is forwarded to the OpenAI API
4. The response is translated back to Ollama format
5. The translated response is sent back to the client

## Testing

You can test the service using curl or any HTTP client:

```bash
curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "prompt": "Hello, how are you?",
    "options": {
      "temperature": 0.8
    }
  }'
```

## License

MIT